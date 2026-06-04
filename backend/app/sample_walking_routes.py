from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import select

from .amap_client import GeocodeLocation, get_walking_route
from .config import DATA_DIR
from .database import SessionLocal
from .metrics import BASIC_DAILY_SUBTYPES, CITY_RESOURCE_SUBTYPES, DAILY_COMPLETE_SUBTYPES, LIFE_CIRCLE_CONFIGS, minmax_series, subtype_diversity
from .models import HouseListing, PoiPoint, StreetMetric

LIFE_SUBTYPES = tuple(dict.fromkeys((*BASIC_DAILY_SUBTYPES, *DAILY_COMPLETE_SUBTYPES, *CITY_RESOURCE_SUBTYPES)))
REUSABLE_CACHE_STATUSES = {"ok", "route_not_found"}
TRANSIENT_CACHE_STATUSES = {"api_quota_exceeded", "api_error", "network_error", "invalid_response"}
STOP_STATUSES = {"api_quota_exceeded"}


@dataclass(frozen=True)
class RouteCacheResult:
    record: dict[str, Any] | None
    reusable: bool


class WalkingRouteCache:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.records: dict[str, dict[str, Any]] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            self._load()

    def _load(self) -> None:
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cache_key = str(record.get("cache_key") or "")
                if cache_key:
                    self.records[cache_key] = record

    def get(self, cache_key: str) -> RouteCacheResult:
        record = self.records.get(cache_key)
        if not record:
            return RouteCacheResult(record=None, reusable=False)
        status = str(record.get("status") or "")
        return RouteCacheResult(record=record, reusable=status in REUSABLE_CACHE_STATUSES)

    def append(self, record: dict[str, Any]) -> None:
        cache_key = str(record.get("cache_key") or "")
        if not cache_key:
            return
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.records[cache_key] = record


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_area_name(value: object) -> str:
    text = str(value or "").strip().replace(" ", "")
    for suffix in ("街道办事处", "街道", "镇", "乡", "地区", "办事处", "区", "县"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text


def _district_candidates(district: str) -> set[str]:
    raw = str(district or "").strip()
    normalized = _normalize_area_name(raw)
    candidates = {raw, normalized}
    if normalized:
        candidates.add(f"{normalized}区")
    return {candidate for candidate in candidates if candidate}


def _stable_seed(base_seed: int, value: object) -> int:
    digest = hashlib.md5(str(value or "").encode("utf-8")).hexdigest()
    return base_seed + int(digest[:8], 16)


def _cache_key(origin: GeocodeLocation, destination: GeocodeLocation) -> str:
    return f"{origin[0]:.6f},{origin[1]:.6f}|{destination[0]:.6f},{destination[1]:.6f}|walking"


def _haversine_m(origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float) -> float:
    radius_m = 6_371_000.0
    lon1 = math.radians(origin_lng)
    lat1 = math.radians(origin_lat)
    lon2 = math.radians(dest_lng)
    lat2 = math.radians(dest_lat)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius_m * math.asin(math.sqrt(value))


def _haversine_m_array(origin_lng: float, origin_lat: float, dest_lng: np.ndarray, dest_lat: np.ndarray) -> np.ndarray:
    radius_m = 6_371_000.0
    lon1 = math.radians(origin_lng)
    lat1 = math.radians(origin_lat)
    lon2 = np.radians(dest_lng)
    lat2 = np.radians(dest_lat)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    values = np.sin(dlat / 2) ** 2 + math.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * radius_m * np.arcsin(np.sqrt(np.clip(values, 0.0, 1.0)))


def _valid_coord(lng: object, lat: object) -> bool:
    try:
        lng_value = float(lng)
        lat_value = float(lat)
    except (TypeError, ValueError):
        return False
    return 120.5 <= lng_value <= 122.2 and 30.5 <= lat_value <= 31.9


def _records_to_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame.from_records(records) if records else pd.DataFrame()


def _route_access_norm(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce").fillna(0.0)
    if numeric.empty:
        return numeric.astype(float)
    if float(numeric.max()) <= 0:
        return pd.Series(0.0, index=numeric.index, dtype=float)
    return minmax_series(numeric)


def _load_houses(district: str, street: str | None, all_streets: bool) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    with SessionLocal() as db:
        statement = select(
            HouseListing.id,
            HouseListing.house_id,
            HouseListing.district,
            HouseListing.street,
            HouseListing.gcj02_lng,
            HouseListing.gcj02_lat,
            HouseListing.unit_price,
        ).where(HouseListing.district.in_(_district_candidates(district)))
        for house in db.execute(statement):
            if not _valid_coord(house.gcj02_lng, house.gcj02_lat):
                continue
            rows.append(
                {
                    "house_db_id": house.id,
                    "house_id": house.house_id or str(house.id),
                    "district": house.district,
                    "street": house.street,
                    "gcj02_lng": float(house.gcj02_lng),
                    "gcj02_lat": float(house.gcj02_lat),
                    "unit_price": float(house.unit_price or 0.0),
                }
            )
    if not all_streets and street:
        exact_rows = [row for row in rows if str(row.get("street") or "") == street]
        if exact_rows:
            rows = exact_rows
        else:
            street_key = _normalize_area_name(street)
            rows = [row for row in rows if _normalize_area_name(row.get("street")) == street_key]
    return _records_to_frame(rows)


def _load_pois(district: str) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    with SessionLocal() as db:
        statement = (
            select(
                PoiPoint.id,
                PoiPoint.uid,
                PoiPoint.name,
                PoiPoint.category,
                PoiPoint.street,
                PoiPoint.poi_subtype,
                PoiPoint.gcj02_lng,
                PoiPoint.gcj02_lat,
                PoiPoint.supply_weight,
            )
            .where(PoiPoint.is_life_service == 1)
            .where(PoiPoint.district.in_(_district_candidates(district)))
            .where(PoiPoint.poi_subtype.in_(LIFE_SUBTYPES))
        )
        for poi in db.execute(statement):
            if not _valid_coord(poi.gcj02_lng, poi.gcj02_lat):
                continue
            rows.append(
                {
                    "poi_id": poi.uid or str(poi.id),
                    "poi_db_id": poi.id,
                    "poi_name": poi.name,
                    "category": poi.category,
                    "street": poi.street,
                    "poi_subtype": poi.poi_subtype,
                    "gcj02_lng": float(poi.gcj02_lng),
                    "gcj02_lat": float(poi.gcj02_lat),
                    "supply_weight": float(poi.supply_weight or 0.0),
                }
            )
    return _records_to_frame(rows)


def _load_street_metrics(district: str, streets: set[str]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    with SessionLocal() as db:
        statement = select(
            StreetMetric.district,
            StreetMetric.street,
            StreetMetric.house_count,
            StreetMetric.sample_reliability_score,
            StreetMetric.livability_score_v2,
            StreetMetric.e2sfca_access_score,
            StreetMetric.value_score,
            StreetMetric.life_circle_5min_coverage,
            StreetMetric.life_circle_10min_coverage,
            StreetMetric.life_circle_15min_coverage,
            StreetMetric.life_circle_5min_score,
            StreetMetric.life_circle_10min_score,
            StreetMetric.life_circle_15min_score,
            StreetMetric.life_circle_score,
            StreetMetric.calibrated_score_life_circle,
        ).where(StreetMetric.district.in_(_district_candidates(district)))
        if streets:
            statement = statement.where(StreetMetric.street.in_(streets))
        for metric in db.execute(statement):
            rows.append(
                {
                    "district": metric.district,
                    "street": metric.street,
                    "house_count": metric.house_count,
                    "sample_reliability_score": metric.sample_reliability_score,
                    "livability_score_v2": metric.livability_score_v2,
                    "e2sfca_access_score": metric.e2sfca_access_score,
                    "value_score": metric.value_score,
                    "life_circle_5min_coverage": metric.life_circle_5min_coverage,
                    "life_circle_10min_coverage": metric.life_circle_10min_coverage,
                    "life_circle_15min_coverage": metric.life_circle_15min_coverage,
                    "life_circle_5min_score": metric.life_circle_5min_score,
                    "life_circle_10min_score": metric.life_circle_10min_score,
                    "life_circle_15min_score": metric.life_circle_15min_score,
                    "life_circle_score": metric.life_circle_score,
                    "calibrated_score_life_circle": metric.calibrated_score_life_circle,
                }
            )
    return _records_to_frame(rows)


def _select_sample_houses(houses: pd.DataFrame, houses_per_street: int, sample_seed: int, limit_streets: int | None) -> pd.DataFrame:
    if houses.empty:
        return houses.copy()
    houses = houses.copy()
    houses["coord_lng_key"] = pd.to_numeric(houses["gcj02_lng"], errors="coerce").round(6)
    houses["coord_lat_key"] = pd.to_numeric(houses["gcj02_lat"], errors="coerce").round(6)
    houses = (
        houses.sort_values(["district", "street", "coord_lng_key", "coord_lat_key", "house_id"])
        .drop_duplicates(subset=["district", "street", "coord_lng_key", "coord_lat_key"], keep="first")
        .drop(columns=["coord_lng_key", "coord_lat_key"])
        .reset_index(drop=True)
    )
    selected_frames: list[pd.DataFrame] = []
    grouped = houses.dropna(subset=["street"]).groupby(["district", "street"], sort=True)
    street_items = list(grouped)
    if limit_streets is not None:
        street_items = street_items[: max(limit_streets, 0)]
    for (_, street), group in street_items:
        sample_size = min(houses_per_street, len(group))
        if sample_size <= 0:
            continue
        random_state = _stable_seed(sample_seed, street)
        selected_frames.append(group.sample(n=sample_size, random_state=random_state).copy())
    return pd.concat(selected_frames, ignore_index=True) if selected_frames else pd.DataFrame(columns=houses.columns)


def _select_houses(
    houses: pd.DataFrame,
    houses_per_street: int,
    sample_seed: int,
    limit_streets: int | None,
    all_houses: bool,
) -> pd.DataFrame:
    if not all_houses:
        return _select_sample_houses(houses, houses_per_street, sample_seed, limit_streets)
    if houses.empty:
        return houses.copy()
    result = houses.sort_values(["district", "street", "house_id", "gcj02_lng", "gcj02_lat"]).reset_index(drop=True)
    if limit_streets is not None:
        street_keys = (
            result[["district", "street"]]
            .drop_duplicates()
            .sort_values(["district", "street"])
            .head(max(limit_streets, 0))
        )
        result = result.merge(street_keys, on=["district", "street"], how="inner")
    return result.reset_index(drop=True)


def _prepare_pois_by_subtype(pois: pd.DataFrame) -> dict[str, dict[str, Any]]:
    prepared: dict[str, dict[str, Any]] = {}
    if pois.empty:
        return prepared
    columns = ["poi_id", "poi_name", "category", "gcj02_lng", "gcj02_lat", "supply_weight"]
    for subtype, frame in pois.groupby("poi_subtype", sort=False):
        prepared[str(subtype)] = {
            "records": frame[columns].to_dict(orient="records"),
            "lng": frame["gcj02_lng"].to_numpy(dtype=float),
            "lat": frame["gcj02_lat"].to_numpy(dtype=float),
        }
    return prepared


def _candidate_rows_for_house(
    house: pd.Series,
    pois_by_subtype: dict[str, dict[str, Any]],
    pois_per_subtype: int,
    candidate_radius_m: float,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for subtype in LIFE_SUBTYPES:
        subtype_pois = pois_by_subtype.get(subtype)
        if subtype_pois is None or len(subtype_pois["records"]) == 0:
            for rank in range(1, pois_per_subtype + 1):
                rows.append(_missing_candidate_row(house, subtype, rank, "no_candidate_poi"))
            continue

        distances = _haversine_m_array(
            float(house.gcj02_lng),
            float(house.gcj02_lat),
            subtype_pois["lng"],
            subtype_pois["lat"],
        )
        candidate_indexes = np.flatnonzero(distances <= candidate_radius_m)
        if len(candidate_indexes) == 0:
            for rank in range(1, pois_per_subtype + 1):
                rows.append(_missing_candidate_row(house, subtype, rank, "no_candidate_poi"))
            continue

        if len(candidate_indexes) > pois_per_subtype:
            nearest_partition = np.argpartition(distances[candidate_indexes], pois_per_subtype - 1)[:pois_per_subtype]
            candidate_indexes = candidate_indexes[nearest_partition]
        candidate_indexes = candidate_indexes[np.argsort(distances[candidate_indexes])]

        for rank, poi_index in enumerate(candidate_indexes, start=1):
            poi = subtype_pois["records"][int(poi_index)]
            rows.append(
                {
                    "district": house.district,
                    "street": house.street,
                    "house_id": house.house_id,
                    "house_gcj02_lng": house.gcj02_lng,
                    "house_gcj02_lat": house.gcj02_lat,
                    "poi_subtype": subtype,
                    "poi_rank": rank,
                    "poi_id": poi["poi_id"],
                    "poi_name": poi["poi_name"],
                    "poi_category": poi["category"],
                    "poi_gcj02_lng": poi["gcj02_lng"],
                    "poi_gcj02_lat": poi["gcj02_lat"],
                    "supply_weight": poi["supply_weight"],
                    "straight_distance_m": float(distances[poi_index]),
                    "walking_distance_m": None,
                    "walking_duration_min": None,
                    "within_5min": False,
                    "within_10min": False,
                    "within_15min": False,
                    "api_status": "pending",
                    "error_message": None,
                }
            )
        for rank in range(len(candidate_indexes) + 1, pois_per_subtype + 1):
            rows.append(_missing_candidate_row(house, subtype, rank, "no_candidate_poi"))
    return rows


def _missing_candidate_row(house: pd.Series, subtype: str, rank: int, status: str) -> dict[str, Any]:
    return {
        "district": house.district,
        "street": house.street,
        "house_id": house.house_id,
        "house_gcj02_lng": house.gcj02_lng,
        "house_gcj02_lat": house.gcj02_lat,
        "poi_subtype": subtype,
        "poi_rank": rank,
        "poi_id": None,
        "poi_name": None,
        "poi_category": None,
        "poi_gcj02_lng": None,
        "poi_gcj02_lat": None,
        "supply_weight": 0.0,
        "straight_distance_m": None,
        "walking_distance_m": None,
        "walking_duration_min": None,
        "within_5min": False,
        "within_10min": False,
        "within_15min": False,
        "api_status": status,
        "error_message": status,
    }


def _route_row(
    row: dict[str, Any],
    cache: WalkingRouteCache,
    dry_run: bool,
    api_state: dict[str, int],
    max_api_calls: int,
    qps: float,
) -> dict[str, Any]:
    result = dict(row)
    result.update({"cache_key": None, "cache_hit": False, "route_source": "local_missing", "created_at": _now_iso()})
    if result["api_status"] == "no_candidate_poi":
        return result

    origin = (float(result["house_gcj02_lng"]), float(result["house_gcj02_lat"]))
    destination = (float(result["poi_gcj02_lng"]), float(result["poi_gcj02_lat"]))
    cache_key = _cache_key(origin, destination)
    result["cache_key"] = cache_key

    cached = cache.get(cache_key)
    if cached.reusable and cached.record:
        record = cached.record
        result["cache_hit"] = True
        result["route_source"] = "amap_cache"
        result["api_status"] = str(record.get("status") or "api_error")
        result["walking_duration_min"] = record.get("duration_minutes")
        result["walking_distance_m"] = record.get("distance_meters")
        result["error_message"] = record.get("error_message")
        return _attach_thresholds(result)

    if dry_run:
        result["api_status"] = "dry_run"
        result["route_source"] = "dry_run"
        result["error_message"] = "dry_run"
        return result

    if api_state.get("stop"):
        result["api_status"] = "skipped_after_stop"
        result["route_source"] = "api_skipped"
        result["error_message"] = str(api_state.get("stop_reason") or "stopped")
        return result

    if api_state["calls"] >= max_api_calls:
        result["api_status"] = "skipped_max_api_calls"
        result["route_source"] = "api_skipped"
        result["error_message"] = "max_api_calls reached"
        api_state["stop"] = 1
        api_state["stop_reason"] = "max_api_calls reached"
        return result

    walking = get_walking_route(origin, destination)
    api_state["calls"] += 1
    result["route_source"] = "amap_api"
    result["api_status"] = walking.status
    result["walking_duration_min"] = walking.duration_minutes
    result["walking_distance_m"] = walking.distance_meters
    result["error_message"] = walking.error
    cache.append(
        {
            "cache_key": cache_key,
            "origin_lng": origin[0],
            "origin_lat": origin[1],
            "destination_lng": destination[0],
            "destination_lat": destination[1],
            "mode": "walking",
            "duration_minutes": walking.duration_minutes,
            "distance_meters": walking.distance_meters,
            "status": walking.status,
            "source": "amap",
            "error_message": walking.error,
            "created_at": _now_iso(),
        }
    )
    if walking.status in STOP_STATUSES:
        api_state["stop"] = 1
        api_state["stop_reason"] = walking.status
    if qps > 0:
        time.sleep(1.0 / qps)
    return _attach_thresholds(result)


def _attach_thresholds(row: dict[str, Any]) -> dict[str, Any]:
    duration = row.get("walking_duration_min")
    try:
        value = float(duration)
    except (TypeError, ValueError):
        value = math.inf
    row["within_5min"] = value <= 5
    row["within_10min"] = value <= 10
    row["within_15min"] = value <= 15
    return row


def _print_progress(
    processed: int,
    total: int,
    routed_rows: list[dict[str, Any]],
    api_calls: int,
    stop_reason: object | None = None,
) -> None:
    total = max(total, 1)
    ratio = min(max(processed / total, 0.0), 1.0)
    bar_width = 28
    filled = int(round(ratio * bar_width))
    bar = "#" * filled + "-" * (bar_width - filled)
    cache_hits = sum(1 for row in routed_rows if bool(row.get("cache_hit")))
    success_count = sum(1 for row in routed_rows if row.get("api_status") == "ok")
    no_candidate_count = sum(1 for row in routed_rows if row.get("api_status") == "no_candidate_poi")
    skipped_count = sum(1 for row in routed_rows if str(row.get("api_status") or "").startswith("skipped"))
    message = (
        f"[{_now_iso()}] progress [{bar}] {processed}/{total} ({ratio:.1%}) "
        f"api_calls={api_calls} cache_hits={cache_hits} ok={success_count} "
        f"no_candidate={no_candidate_count} skipped={skipped_count}"
    )
    if stop_reason:
        message += f" stop_reason={stop_reason}"
    print(message, flush=True)


def _build_route_samples(
    sample_houses: pd.DataFrame,
    pois: pd.DataFrame,
    cache: WalkingRouteCache,
    args: argparse.Namespace,
) -> pd.DataFrame:
    if sample_houses.empty:
        return pd.DataFrame()
    pois_by_subtype = _prepare_pois_by_subtype(pois)
    api_state = {"calls": 0, "stop": 0, "stop_reason": None}
    routed_rows: list[dict[str, Any]] = []
    total_expected = len(sample_houses) * len(LIFE_SUBTYPES) * args.pois_per_subtype
    processed = 0
    progress_interval = max(float(args.progress_interval_sec), 0.0)
    next_progress_at = time.monotonic() + progress_interval if progress_interval > 0 else math.inf
    _print_progress(processed, total_expected, routed_rows, api_state["calls"])
    for house in sample_houses.itertuples(index=False):
        candidate_rows = _candidate_rows_for_house(pd.Series(house._asdict()), pois_by_subtype, args.pois_per_subtype, args.candidate_radius_m)
        for row in candidate_rows:
            routed = _route_row(row, cache, args.dry_run, api_state, args.max_api_calls, args.qps)
            routed["sample_seed"] = args.sample_seed
            routed_rows.append(routed)
            processed += 1
            if progress_interval > 0 and time.monotonic() >= next_progress_at:
                _print_progress(processed, total_expected, routed_rows, api_state["calls"], api_state.get("stop_reason"))
                next_progress_at = time.monotonic() + progress_interval
    _print_progress(processed, total_expected, routed_rows, api_state["calls"], api_state.get("stop_reason"))
    samples = pd.DataFrame(routed_rows)
    samples.attrs["api_calls"] = api_state["calls"]
    samples.attrs["stop_reason"] = api_state.get("stop_reason")
    return samples


def _compute_route_life_circle(
    samples: pd.DataFrame,
    sample_houses: pd.DataFrame,
    street_metrics: pd.DataFrame,
    houses_per_street: int,
) -> pd.DataFrame:
    if sample_houses.empty:
        return pd.DataFrame()

    ok_samples = samples[samples["api_status"] == "ok"].copy() if not samples.empty else pd.DataFrame()
    best_by_house_subtype: dict[tuple[str, str], pd.Series] = {}
    if not ok_samples.empty:
        ok_samples["walking_duration_min"] = pd.to_numeric(ok_samples["walking_duration_min"], errors="coerce")
        ok_samples = ok_samples.dropna(subset=["walking_duration_min"])
        for key, group in ok_samples.groupby(["house_id", "poi_subtype"]):
            best_by_house_subtype[key] = group.sort_values("walking_duration_min").iloc[0]

    house_rows: list[dict[str, Any]] = []
    for house in sample_houses.itertuples(index=False):
        house_result: dict[str, Any] = {"district": house.district, "street": house.street, "house_id": house.house_id}
        for config in LIFE_CIRCLE_CONFIGS:
            required = tuple(config.required_subtypes)
            beta_minutes = max(config.minutes / 2.0, 0.1)
            access_by_subtype: dict[str, float] = {subtype: 0.0 for subtype in required}
            covered = 0
            for subtype in required:
                best = best_by_house_subtype.get((house.house_id, subtype))
                if best is None:
                    continue
                duration = float(best["walking_duration_min"])
                if duration <= config.minutes:
                    covered += 1
                weight = float(best.get("supply_weight") or 0.0)
                access_by_subtype[subtype] = weight * math.exp(-duration / beta_minutes)
            house_result[config.coverage_field] = covered / len(required) if required else 0.0
            house_result[config.access_field] = sum(access_by_subtype.values())
            house_result[config.diversity_field] = subtype_diversity(access_by_subtype)
        house_rows.append(house_result)

    house_features = pd.DataFrame(house_rows)
    for config in LIFE_CIRCLE_CONFIGS:
        house_features[config.score_field] = (
            config.coverage_weight * pd.to_numeric(house_features[config.coverage_field], errors="coerce").fillna(0.0)
            + config.access_weight * _route_access_norm(house_features[config.access_field])
            + config.diversity_weight * pd.to_numeric(house_features[config.diversity_field], errors="coerce").fillna(0.0)
        ).clip(0.0, 1.0)

    house_features["life_circle_score_route"] = (
        0.40 * house_features["life_circle_5min_score"]
        + 0.35 * house_features["life_circle_10min_score"]
        + 0.25 * house_features["life_circle_15min_score"]
    ).clip(0.0, 1.0)

    grouped = house_features.groupby(["district", "street"], dropna=False).agg(
        sample_house_count=("house_id", "nunique"),
        life_circle_5min_coverage_route=("life_circle_5min_coverage", "mean"),
        life_circle_10min_coverage_route=("life_circle_10min_coverage", "mean"),
        life_circle_15min_coverage_route=("life_circle_15min_coverage", "mean"),
        life_circle_5min_score_route=("life_circle_5min_score", "mean"),
        life_circle_10min_score_route=("life_circle_10min_score", "mean"),
        life_circle_15min_score_route=("life_circle_15min_score", "mean"),
        life_circle_score_route=("life_circle_score_route", "mean"),
    )
    route_metrics = grouped.reset_index()
    route_counts = samples.groupby(["district", "street"], dropna=False).agg(
        route_expected_count=("api_status", "size"),
        route_success_count=("api_status", lambda values: int((values == "ok").sum())),
        route_cache_hit_count=("cache_hit", lambda values: int(pd.Series(values).fillna(False).astype(bool).sum())),
    )
    route_metrics = route_metrics.merge(route_counts.reset_index(), on=["district", "street"], how="left")
    route_metrics["route_success_rate"] = (
        pd.to_numeric(route_metrics["route_success_count"], errors="coerce").fillna(0.0)
        / pd.to_numeric(route_metrics["route_expected_count"], errors="coerce").replace(0, pd.NA)
    ).fillna(0.0)
    route_metrics = route_metrics.merge(
        street_metrics[["district", "street", "house_count"]],
        on=["district", "street"],
        how="left",
    )
    house_sample_target = pd.to_numeric(route_metrics["house_count"], errors="coerce").fillna(0.0).clip(upper=houses_per_street)
    house_sample_rate = (
        pd.to_numeric(route_metrics["sample_house_count"], errors="coerce").fillna(0.0) / house_sample_target.replace(0, pd.NA)
    ).fillna(0.0)
    route_metrics["route_sample_reliability_score"] = (0.7 * route_metrics["route_success_rate"] + 0.3 * house_sample_rate).clip(0.0, 1.0)
    return route_metrics


def _build_compare(route_metrics: pd.DataFrame, street_metrics: pd.DataFrame) -> pd.DataFrame:
    if route_metrics.empty or street_metrics.empty:
        return pd.DataFrame()
    compare = street_metrics.merge(route_metrics, on=["district", "street"], how="inner", suffixes=("", "_route_meta"))
    compare["base_score_route"] = (
        0.30 * pd.to_numeric(compare["livability_score_v2"], errors="coerce").fillna(0.0)
        + 0.30 * pd.to_numeric(compare["e2sfca_access_score"], errors="coerce").fillna(0.0)
        + 0.30 * pd.to_numeric(compare["life_circle_score_route"], errors="coerce").fillna(0.0)
        + 0.10 * pd.to_numeric(compare["value_score"], errors="coerce").fillna(0.0)
    )
    compare["calibrated_score_life_circle_route"] = (
        compare["base_score_route"]
        * pd.to_numeric(compare["sample_reliability_score"], errors="coerce").fillna(0.0)
        * (0.6 + 0.4 * pd.to_numeric(compare["life_circle_score_route"], errors="coerce").fillna(0.0))
    ).clip(0.0, 1.0)
    compare["life_circle_score_delta"] = compare["life_circle_score_route"] - compare["life_circle_score"]
    compare["calibrated_score_delta"] = compare["calibrated_score_life_circle_route"] - compare["calibrated_score_life_circle"]
    compare["old_rank"] = compare["calibrated_score_life_circle"].rank(ascending=False, method="min").astype(int)
    compare["route_rank"] = compare["calibrated_score_life_circle_route"].rank(ascending=False, method="min").astype(int)
    compare["rank_delta"] = compare["old_rank"] - compare["route_rank"]
    columns = [
        "district",
        "street",
        "house_count",
        "sample_house_count",
        "route_expected_count",
        "route_success_count",
        "route_cache_hit_count",
        "route_success_rate",
        "route_sample_reliability_score",
        "life_circle_5min_coverage",
        "life_circle_5min_coverage_route",
        "life_circle_10min_coverage",
        "life_circle_10min_coverage_route",
        "life_circle_15min_coverage",
        "life_circle_15min_coverage_route",
        "life_circle_score",
        "life_circle_score_route",
        "life_circle_score_delta",
        "calibrated_score_life_circle",
        "calibrated_score_life_circle_route",
        "calibrated_score_delta",
        "old_rank",
        "route_rank",
        "rank_delta",
    ]
    return compare[columns].sort_values(["route_rank", "street"]).reset_index(drop=True)


def _write_outputs(samples: pd.DataFrame, route_metrics: pd.DataFrame, compare: pd.DataFrame, output_prefix: str) -> None:
    derived_dir = DATA_DIR / "derived"
    derived_dir.mkdir(parents=True, exist_ok=True)
    samples_csv = derived_dir / f"amap_walk_route_samples_{output_prefix}.csv"
    samples.to_csv(samples_csv, index=False)
    try:
        samples.to_parquet(derived_dir / f"amap_walk_route_samples_{output_prefix}.parquet", index=False)
    except Exception as exc:  # noqa: BLE001
        print(f"warning: could not write samples parquet: {exc}")

    route_metrics.to_csv(derived_dir / f"amap_walk_life_circle_street_metrics_{output_prefix}.csv", index=False)
    try:
        route_metrics.to_parquet(derived_dir / f"amap_walk_life_circle_street_metrics_{output_prefix}.parquet", index=False)
    except Exception as exc:  # noqa: BLE001
        print(f"warning: could not write route metrics parquet: {exc}")

    compare_csv = derived_dir / f"amap_walk_compare_{output_prefix}.csv"
    compare_json = derived_dir / f"amap_walk_compare_{output_prefix}.json"
    compare.to_csv(compare_csv, index=False)
    summary = _build_summary(samples, compare)
    summary["stop_reason"] = samples.attrs.get("stop_reason")
    with compare_json.open("w", encoding="utf-8") as handle:
        json.dump({"summary": summary, "records": compare.to_dict(orient="records")}, handle, ensure_ascii=False, indent=2)
    progress_json = derived_dir / f"amap_walk_progress_{output_prefix}.json"
    with progress_json.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    print(f"wrote samples: {samples_csv}")
    print(f"wrote route metrics: {derived_dir / f'amap_walk_life_circle_street_metrics_{output_prefix}.csv'}")
    print(f"wrote comparison: {compare_csv}")
    print(f"wrote progress: {progress_json}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def _build_summary(samples: pd.DataFrame, compare: pd.DataFrame) -> dict[str, Any]:
    if samples.empty:
        return {}
    route_expected_count = int(len(samples))
    route_success_count = int((samples["api_status"] == "ok").sum())
    api_call_count = int((samples["route_source"] == "amap_api").sum()) if "route_source" in samples else 0
    cache_hit_count = int(samples["cache_hit"].fillna(False).astype(bool).sum()) if "cache_hit" in samples else 0
    no_candidate_count = int((samples["api_status"] == "no_candidate_poi").sum())
    pending_count = int(samples["api_status"].isin(["dry_run", "skipped_max_api_calls", "skipped_after_stop"]).sum())
    actionable_count = max(route_expected_count - no_candidate_count, 0)
    completed_count = route_success_count + int((samples["api_status"] == "route_not_found").sum())
    summary: dict[str, Any] = {
        "street_count": int(samples[["district", "street"]].drop_duplicates().shape[0]),
        "sample_house_count": int(samples["house_id"].nunique()),
        "route_expected_count": route_expected_count,
        "route_actionable_count": actionable_count,
        "route_success_count": route_success_count,
        "no_candidate_poi_count": no_candidate_count,
        "pending_or_skipped_count": pending_count,
        "route_completed_count": completed_count,
        "route_success_rate": round(route_success_count / route_expected_count, 4) if route_expected_count else 0.0,
        "route_actionable_completion_rate": round(completed_count / actionable_count, 4) if actionable_count else 0.0,
        "api_call_count": api_call_count,
        "cache_hit_count": cache_hit_count,
        "status_counts": samples["api_status"].value_counts(dropna=False).to_dict(),
    }
    if not compare.empty:
        summary.update(
            {
                "old_life_circle_mean": round(float(compare["life_circle_score"].mean()), 6),
                "route_life_circle_mean": round(float(compare["life_circle_score_route"].mean()), 6),
                "avg_life_circle_delta": round(float(compare["life_circle_score_delta"].mean()), 6),
                "max_score_up_street": str(compare.sort_values("life_circle_score_delta", ascending=False).iloc[0]["street"]),
                "max_score_down_street": str(compare.sort_values("life_circle_score_delta", ascending=True).iloc[0]["street"]),
            }
        )
    return summary


def _resolve_output_prefix(args: argparse.Namespace) -> str:
    if args.output_prefix:
        return args.output_prefix
    if not args.all_streets and args.street and "五角场" in args.street:
        return "wujiaochang"
    if _normalize_area_name(args.district) == "杨浦":
        return "yangpu"
    return "custom"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sample AMap walking routes for route-based life-circle audit outputs.")
    parser.add_argument("--district", default="杨浦", help="District to sample. Default: 杨浦")
    parser.add_argument("--street", default="五角场街道", help="Street to sample for test mode. Ignored when --all-streets is set.")
    parser.add_argument("--all-streets", action="store_true", help="Sample all streets in the district.")
    parser.add_argument("--all-houses", action="store_true", help="Use all house rows after filtering instead of sampling unique coordinates.")
    parser.add_argument("--limit-streets", type=int, default=None, help="Limit number of streets after filtering.")
    parser.add_argument("--houses-per-street", type=int, default=6)
    parser.add_argument("--pois-per-subtype", type=int, default=2)
    parser.add_argument("--candidate-radius-m", type=float, default=2000.0)
    parser.add_argument("--max-api-calls", type=int, default=252)
    parser.add_argument("--qps", type=float, default=3.0)
    parser.add_argument(
        "--progress-interval-sec",
        type=float,
        default=120.0,
        help="Print progress every N seconds. Set 0 to disable interval updates.",
    )
    parser.add_argument("--sample-seed", type=int, default=20260530)
    parser.add_argument("--cache-path", default=str(DATA_DIR / "cache" / "amap_walking_route_cache.jsonl"))
    parser.add_argument("--output-prefix", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--resume", action="store_true", help="Kept for CLI clarity; cache is always reused when present.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    houses = _load_houses(args.district, args.street, args.all_streets)
    if houses.empty:
        raise SystemExit("No houses found for the requested district/street filter.")
    sample_houses = _select_houses(houses, args.houses_per_street, args.sample_seed, args.limit_streets, args.all_houses)
    if sample_houses.empty:
        raise SystemExit("No sample houses selected.")
    pois = _load_pois(args.district)
    if pois.empty:
        raise SystemExit("No local life-service POIs found for the requested district.")

    cache = WalkingRouteCache(Path(args.cache_path))
    samples = _build_route_samples(sample_houses, pois, cache, args)
    selected_streets = set(sample_houses["street"].dropna().astype(str))
    street_metrics = _load_street_metrics(args.district, selected_streets)
    route_metrics = _compute_route_life_circle(samples, sample_houses, street_metrics, args.houses_per_street)
    compare = _build_compare(route_metrics, street_metrics)
    _write_outputs(samples, route_metrics, compare, _resolve_output_prefix(args))


if __name__ == "__main__":
    main()
