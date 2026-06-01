from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, median

from sqlalchemy import select
from sqlalchemy.orm import Session

from .amap_client import estimate_commute_minutes, geocode_address, get_commute_minutes
from .config import LLM_RERANK_WEIGHT, RECOMMENDER_VERSION
from .house_recommend_schemas import (
    CommunityRecommendation,
    HouseRecommendRequest,
    HouseRecommendResponse,
    StreetRecommendation,
)
from .llm_rerank import rerank_community_candidates, rerank_house_candidates
from .models import DistrictMetric, HouseListing, StreetMetric
from .poi_preference import build_poi_preference_maps


@dataclass
class HouseCandidate:
    model: HouseListing
    district: str
    sub_district: str
    community_name: str
    title: str
    area: float | None
    budget_score: float
    commute_minutes: float | None = None
    commute_score: float = 0.0
    convenience_score: float = 0.0
    poi_score: float = 0.0
    poi_subtype_score: float = 0.0
    access_score: float = 0.0
    e2sfca_score: float = 0.0
    calibrated_score: float = 0.0
    layout_score: float = 0.5
    comfort_score: float = 0.5
    community_quality_score: float = 0.5
    rule_score: float = 0.0
    final_score: float = 0.0
    llm_score: float | None = None
    llm_confidence: float | None = None
    llm_reason: str | None = None
    breakdown: dict[str, float] | None = None


@dataclass
class CommunityCandidate:
    community_id: str
    district: str
    sub_district: str
    community_name: str
    items: list[HouseCandidate]
    avg_unit_price: float
    avg_total_price: float
    median_commute_minutes: float | None
    budget_match_score: float
    poi_score: float
    poi_subtype_score: float
    traffic_score: float
    access_score: float
    e2sfca_score: float
    calibrated_score: float
    layout_score: float
    comfort_score: float
    community_quality_score: float
    rule_score: float
    final_score: float
    breakdown: dict[str, float] | None = None
    llm_score: float | None = None
    llm_confidence: float | None = None
    llm_reason: str | None = None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _normalize(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: _clamp((v - lo) / (hi - lo)) for k, v in values.items()}


def _normalize_tuple(values: dict[tuple[str, str], float]) -> dict[tuple[str, str], float]:
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: _clamp((v - lo) / (hi - lo)) for k, v in values.items()}


def _float_attr(row: object, *names: str, default: float = 0.0) -> float:
    for name in names:
        value = getattr(row, name, None)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return default


def _resolve_version() -> str:
    v = (RECOMMENDER_VERSION or "v3").lower()
    return v if v in {"v1", "v2", "v3"} else "v3"


def _get_sub_district(row: HouseListing) -> str:
    value = getattr(row, "sub_district", None) or getattr(row, "street", None)
    text = str(value or "").strip()
    return text or "unknown_street"


def _get_community_name(row: HouseListing, sub_district: str) -> str:
    value = getattr(row, "community_name", None)
    text = str(value or "").strip()
    return text or f"{sub_district}_community"


def _get_house_title(row: HouseListing, district: str, sub_district: str) -> str:
    value = getattr(row, "title", None)
    text = str(value or "").strip()
    if text:
        return text
    return f"{district} {sub_district} listing {row.house_id or row.id}"


def _get_house_area(row: HouseListing) -> float | None:
    value = getattr(row, "area", None)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _build_budget_score(unit_price: float, affordable_unit_price: float) -> float:
    if affordable_unit_price <= 0:
        return 0.0
    ratio = unit_price / affordable_unit_price
    if ratio <= 1:
        return _clamp(1 - 0.3 * abs(ratio - 1))
    return _clamp(max(0.0, 1 - 2 * (ratio - 1)))


def _build_commute_score(commute_minutes: float | None, max_commute_minutes: float) -> float:
    if commute_minutes is None or max_commute_minutes <= 0:
        return 0.0
    if commute_minutes <= max_commute_minutes:
        return _clamp(1 - commute_minutes / max_commute_minutes * 0.5)
    return _clamp(max(0.0, 1 - (commute_minutes / max_commute_minutes - 1)))


def _binary_like(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on"}:
        return 1.0
    if text in {"0", "false", "no", "n", "off"}:
        return 0.0
    try:
        return 1.0 if float(value) > 0 else 0.0
    except (TypeError, ValueError):
        return None


def _build_layout_score(row: HouseListing, target_area: float) -> float:
    area = _get_house_area(row)
    room = _float_attr(row, "room_count", default=0.0)
    hall = _float_attr(row, "hall_count", default=0.0)
    toilet = _float_attr(row, "toilet_count", default=0.0)

    if area is None:
        area_score = 0.5
    elif target_area <= 0:
        area_score = 0.5
    else:
        area_ratio = abs(area - target_area) / max(target_area, 1.0)
        area_score = _clamp(1.0 - area_ratio)

    room_score = _clamp(room / 4.0) if room > 0 else 0.2
    hall_score = 1.0 if hall >= 1 else 0.4
    toilet_score = _clamp(toilet / 2.0) if toilet > 0 else 0.3
    return _clamp(0.45 * area_score + 0.30 * room_score + 0.15 * hall_score + 0.10 * toilet_score)


def _build_comfort_score(row: HouseListing) -> float:
    ns_flag = _binary_like(getattr(row, "faces_north_south", None))
    elevator_flag = _binary_like(getattr(row, "has_elevator_text_flag", None))
    south_flag = _binary_like(getattr(row, "faces_south", None))

    renovation_text = str(getattr(row, "renovation", "") or "").lower()
    if any(k in renovation_text for k in ("精装", "豪装", "modern", "new", "精装修")):
        renovation_score = 1.0
    elif any(k in renovation_text for k in ("简装", "普通", "毛坯", "old")):
        renovation_score = 0.45
    else:
        renovation_score = 0.6

    year_built = _float_attr(row, "year_built", default=0.0)
    if year_built >= 2018:
        year_score = 1.0
    elif year_built >= 2010:
        year_score = 0.82
    elif year_built >= 2000:
        year_score = 0.64
    elif year_built > 0:
        year_score = 0.45
    else:
        year_score = 0.55

    orient_score = 0.5
    if ns_flag is not None:
        orient_score = 0.75 if ns_flag > 0 else 0.45
    elif south_flag is not None:
        orient_score = 0.68 if south_flag > 0 else 0.5

    elevator_score = 0.6 if elevator_flag is None else (1.0 if elevator_flag > 0 else 0.35)
    return _clamp(0.30 * orient_score + 0.25 * elevator_score + 0.25 * renovation_score + 0.20 * year_score)


def _build_community_quality_score(row: HouseListing) -> float:
    greening = _float_attr(row, "greening_rate", default=-1.0)
    fee = _float_attr(row, "property_fee", default=-1.0)
    households = _float_attr(row, "community_households", default=-1.0)

    if greening < 0:
        green_score = 0.55
    elif greening <= 1.0:
        green_score = _clamp(greening)
    else:
        green_score = _clamp(greening / 100.0)

    if fee < 0:
        fee_score = 0.55
    elif fee <= 1.2:
        fee_score = 0.42
    elif fee <= 2.0:
        fee_score = 0.62
    elif fee <= 4.0:
        fee_score = 0.85
    elif fee <= 7.0:
        fee_score = 0.72
    else:
        fee_score = 0.52

    if households < 0:
        household_score = 0.55
    elif households < 80:
        household_score = 0.46
    elif households <= 1200:
        household_score = 0.9
    elif households <= 2200:
        household_score = 0.7
    else:
        household_score = 0.5

    return _clamp(0.40 * green_score + 0.30 * fee_score + 0.30 * household_score)


def _weight_inputs(payload: HouseRecommendRequest) -> tuple[float, float]:
    shopping = payload.shopping_weight if payload.shopping_weight > 0 else payload.daily_life_weight
    healthcare = payload.healthcare_weight if payload.healthcare_weight > 0 else payload.medical_weight
    return shopping, healthcare


def _build_metric_maps(
    db: Session,
    healthcare_weight: float,
    shopping_weight: float,
) -> tuple[
    dict[str, float],
    dict[str, float],
    dict[str, float],
    dict[str, float],
    dict[str, float],
    dict[str, float],
]:
    districts = db.scalars(select(DistrictMetric)).all()
    streets = db.scalars(select(StreetMetric)).all()

    convenience_raw = {row.district: _float_attr(row, "livability_score_v2", "livability_score") for row in districts}
    poi_pref_raw = {
        row.district: float(row.healthcare_count) * healthcare_weight + float(row.shopping_count) * shopping_weight
        for row in districts
    }
    access_raw = {row.district: _float_attr(row, "access_score") for row in districts}
    e2sfca_raw = {row.district: _float_attr(row, "e2sfca_access_score") for row in districts}
    calibrated_raw = {row.district: _float_attr(row, "calibrated_score_life_circle", "calibrated_score") for row in districts}
    street_calibrated_raw = {
        (row.district, row.street): _float_attr(row, "calibrated_score_life_circle", "calibrated_score")
        for row in streets
    }

    return (
        _normalize(convenience_raw),
        _normalize(poi_pref_raw),
        _normalize(access_raw),
        _normalize(e2sfca_raw),
        _normalize(calibrated_raw),
        _normalize_tuple(street_calibrated_raw),
    )


def _compute_house_pre_score(item: HouseCandidate, version: str) -> float:
    if version == "v1":
        return _clamp(0.62 * item.budget_score + 0.25 * item.poi_score + 0.13 * item.convenience_score)
    if version == "v2":
        return _clamp(
            0.43 * item.budget_score
            + 0.19 * item.poi_score
            + 0.18 * item.access_score
            + 0.12 * item.e2sfca_score
            + 0.08 * item.calibrated_score
        )
    return _clamp(
        0.39 * item.budget_score
        + 0.17 * item.poi_score
        + 0.17 * item.poi_subtype_score
        + 0.13 * item.access_score
        + 0.08 * item.e2sfca_score
        + 0.06 * item.calibrated_score
    )


def _compute_house_score(item: HouseCandidate, version: str) -> tuple[float, dict[str, float]]:
    if version == "v1":
        score = _clamp(0.42 * item.budget_score + 0.33 * item.commute_score + 0.17 * item.poi_score + 0.08 * item.convenience_score)
        breakdown = {
            "budget": round(item.budget_score, 4),
            "commute": round(item.commute_score, 4),
            "poi_pref": round(item.poi_score, 4),
            "convenience": round(item.convenience_score, 4),
        }
        return score, breakdown
    if version == "v2":
        score = _clamp(
            0.34 * item.budget_score
            + 0.26 * item.commute_score
            + 0.14 * item.poi_score
            + 0.12 * item.access_score
            + 0.08 * item.e2sfca_score
            + 0.06 * item.calibrated_score
        )
        breakdown = {
            "budget": round(item.budget_score, 4),
            "commute": round(item.commute_score, 4),
            "poi_pref": round(item.poi_score, 4),
            "access": round(item.access_score, 4),
            "e2sfca": round(item.e2sfca_score, 4),
            "calibrated": round(item.calibrated_score, 4),
        }
        return score, breakdown

    score = _clamp(
        0.24 * item.budget_score
        + 0.20 * item.commute_score
        + 0.10 * item.poi_score
        + 0.10 * item.poi_subtype_score
        + 0.08 * item.access_score
        + 0.05 * item.e2sfca_score
        + 0.05 * item.calibrated_score
        + 0.08 * item.layout_score
        + 0.06 * item.comfort_score
        + 0.04 * item.community_quality_score
    )
    breakdown = {
        "budget": round(item.budget_score, 4),
        "commute": round(item.commute_score, 4),
        "poi_pref": round(item.poi_score, 4),
        "poi_subtype_pref": round(item.poi_subtype_score, 4),
        "access": round(item.access_score, 4),
        "e2sfca": round(item.e2sfca_score, 4),
        "calibrated": round(item.calibrated_score, 4),
        "layout_match": round(item.layout_score, 4),
        "living_comfort": round(item.comfort_score, 4),
        "community_quality": round(item.community_quality_score, 4),
    }
    return score, breakdown


def _compute_community_score(item: CommunityCandidate, version: str) -> tuple[float, dict[str, float]]:
    if version == "v1":
        score = _clamp(0.40 * item.budget_match_score + 0.30 * item.traffic_score + 0.20 * item.poi_score + 0.10 * item.access_score)
        breakdown = {
            "budget": round(item.budget_match_score, 4),
            "traffic": round(item.traffic_score, 4),
            "poi_pref": round(item.poi_score, 4),
            "access": round(item.access_score, 4),
        }
        return score, breakdown
    if version == "v2":
        score = _clamp(
            0.34 * item.budget_match_score
            + 0.25 * item.traffic_score
            + 0.14 * item.poi_score
            + 0.12 * item.access_score
            + 0.08 * item.e2sfca_score
            + 0.07 * item.calibrated_score
        )
        breakdown = {
            "budget": round(item.budget_match_score, 4),
            "traffic": round(item.traffic_score, 4),
            "poi_pref": round(item.poi_score, 4),
            "access": round(item.access_score, 4),
            "e2sfca": round(item.e2sfca_score, 4),
            "calibrated": round(item.calibrated_score, 4),
        }
        return score, breakdown

    score = _clamp(
        0.26 * item.budget_match_score
        + 0.19 * item.traffic_score
        + 0.10 * item.poi_score
        + 0.10 * item.poi_subtype_score
        + 0.08 * item.access_score
        + 0.05 * item.e2sfca_score
        + 0.04 * item.calibrated_score
        + 0.09 * item.layout_score
        + 0.06 * item.comfort_score
        + 0.03 * item.community_quality_score
    )
    breakdown = {
        "budget": round(item.budget_match_score, 4),
        "traffic": round(item.traffic_score, 4),
        "poi_pref": round(item.poi_score, 4),
        "poi_subtype_pref": round(item.poi_subtype_score, 4),
        "access": round(item.access_score, 4),
        "e2sfca": round(item.e2sfca_score, 4),
        "calibrated": round(item.calibrated_score, 4),
        "layout_match": round(item.layout_score, 4),
        "living_comfort": round(item.comfort_score, 4),
        "community_quality": round(item.community_quality_score, 4),
    }
    return score, breakdown


def _build_house_llm_rows(candidates: list[HouseCandidate], max_items: int) -> list[dict]:
    rows: list[dict] = []
    for item in sorted(candidates, key=lambda x: x.rule_score, reverse=True)[:max_items]:
        rows.append(
            {
                "house_id": str(item.model.house_id or item.model.id),
                "district": item.district,
                "sub_district": item.sub_district,
                "community_name": item.community_name,
                "unit_price": round(float(item.model.unit_price), 2),
                "total_price": round(float(item.model.price), 2),
                "area": round(float(item.area), 2) if item.area is not None else None,
                "commute_minutes": item.commute_minutes,
                "budget_score": round(item.budget_score, 4),
                "commute_score": round(item.commute_score, 4),
                "poi_score": round(item.poi_score, 4),
                "poi_subtype_score": round(item.poi_subtype_score, 4),
                "access_score": round(item.access_score, 4),
                "e2sfca_score": round(item.e2sfca_score, 4),
                "calibrated_score": round(item.calibrated_score, 4),
                "layout_score": round(item.layout_score, 4),
                "comfort_score": round(item.comfort_score, 4),
                "community_quality_score": round(item.community_quality_score, 4),
                "rule_score": round(item.rule_score, 4),
            }
        )
    return rows


def _apply_house_llm_rerank(payload: HouseRecommendRequest, affordable_unit_price: float, candidates: list[HouseCandidate]) -> dict[str, int | str | bool]:
    rows = _build_house_llm_rows(candidates, payload.max_route_calls)
    result = rerank_house_candidates(
        work_address=payload.work_address,
        commute_mode=payload.commute_mode,
        max_commute_minutes=payload.max_commute_minutes,
        affordable_unit_price=affordable_unit_price,
        candidates=rows,
    )
    by_id = {str(item.model.house_id or item.model.id): item for item in candidates}
    hits = 0
    if result.applied:
        base_weight = _clamp(LLM_RERANK_WEIGHT)
        for house_id, rerank_item in result.items.items():
            target = by_id.get(house_id)
            if target is None:
                continue
            confidence = _clamp(rerank_item.confidence)
            dynamic_weight = base_weight * confidence
            target.llm_score = rerank_item.llm_score
            target.llm_confidence = confidence
            target.llm_reason = rerank_item.reason or None
            target.final_score = _clamp((1 - dynamic_weight) * target.rule_score + dynamic_weight * rerank_item.llm_score)
            hits += 1
    for item in candidates:
        if item.final_score <= 0:
            item.final_score = item.rule_score
    return {
        "house_rerank_applied": result.applied,
        "house_rerank_latency_ms": result.latency_ms,
        "house_rerank_candidates": len(rows),
        "house_rerank_success_count": hits,
        "house_rerank_error": result.error or "",
    }


def _build_community_llm_rows(communities: list[CommunityCandidate], max_items: int) -> list[dict]:
    rows: list[dict] = []
    for item in communities[:max_items]:
        rows.append(
            {
                "community_id": item.community_id,
                "district": item.district,
                "sub_district": item.sub_district,
                "community_name": item.community_name,
                "avg_unit_price": round(item.avg_unit_price, 2),
                "avg_total_price": round(item.avg_total_price, 2),
                "median_commute_minutes": item.median_commute_minutes,
                "house_count": len(item.items),
                "budget_match_score": round(item.budget_match_score, 4),
                "poi_score": round(item.poi_score, 4),
                "poi_subtype_score": round(item.poi_subtype_score, 4),
                "traffic_score": round(item.traffic_score, 4),
                "access_score": round(item.access_score, 4),
                "e2sfca_score": round(item.e2sfca_score, 4),
                "calibrated_score": round(item.calibrated_score, 4),
                "layout_score": round(item.layout_score, 4),
                "comfort_score": round(item.comfort_score, 4),
                "community_quality_score": round(item.community_quality_score, 4),
                "rule_score": round(item.rule_score, 4),
            }
        )
    return rows


def _apply_community_llm_rerank(payload: HouseRecommendRequest, communities: list[CommunityCandidate]) -> dict[str, int | str | bool]:
    rows = _build_community_llm_rows(communities, payload.top_communities * 5)
    result = rerank_community_candidates(
        work_address=payload.work_address,
        commute_mode=payload.commute_mode,
        max_commute_minutes=payload.max_commute_minutes,
        budget_wan=payload.budget_wan,
        candidates=rows,
    )
    by_id = {item.community_id: item for item in communities}
    hits = 0
    if result.applied:
        base_weight = _clamp(LLM_RERANK_WEIGHT)
        for community_id, rerank_item in result.items.items():
            target = by_id.get(community_id)
            if target is None:
                continue
            confidence = _clamp(rerank_item.confidence)
            dynamic_weight = base_weight * confidence
            target.llm_score = rerank_item.llm_score
            target.llm_confidence = confidence
            target.llm_reason = rerank_item.reason or None
            target.final_score = _clamp((1 - dynamic_weight) * target.rule_score + dynamic_weight * rerank_item.llm_score)
            hits += 1
    for item in communities:
        if item.final_score <= 0:
            item.final_score = item.rule_score
    communities.sort(key=lambda x: x.final_score, reverse=True)
    return {
        "community_rerank_applied": result.applied,
        "community_rerank_latency_ms": result.latency_ms,
        "community_rerank_candidates": len(rows),
        "community_rerank_success_count": hits,
        "community_rerank_error": result.error or "",
    }


def recommend_houses(payload: HouseRecommendRequest, db: Session) -> HouseRecommendResponse:
    version = _resolve_version()
    affordable_unit_price = payload.budget_wan * 10000.0 / payload.target_area
    work_location = geocode_address(payload.work_address)
    work_location_str = f"{work_location[0]:.6f},{work_location[1]:.6f}" if work_location else None

    shopping_weight, healthcare_weight = _weight_inputs(payload)
    convenience_map, poi_pref_map, access_map, e2sfca_map, calibrated_map, street_calibrated_map = _build_metric_maps(
        db,
        healthcare_weight=healthcare_weight,
        shopping_weight=shopping_weight,
    )

    poi_pref_maps = build_poi_preference_maps(
        db,
        shopping_weight=shopping_weight,
        healthcare_weight=healthcare_weight,
        daily_life_weight=payload.daily_life_weight,
        commute_facility_weight=payload.commute_facility_weight,
        medical_weight=payload.medical_weight,
        education_weight=payload.education_weight,
        recreation_weight=payload.recreation_weight,
        employment_weight=payload.employment_weight,
    )
    district_poi_subtype_map = poi_pref_maps.district_scores
    street_poi_subtype_map = poi_pref_maps.street_scores

    house_rows = db.scalars(select(HouseListing).where(HouseListing.unit_price <= affordable_unit_price * 1.35)).all()
    if not house_rows:
        house_rows = db.scalars(select(HouseListing)).all()

    candidates: list[HouseCandidate] = []
    for row in house_rows:
        budget_score = _build_budget_score(float(row.unit_price), affordable_unit_price)
        if budget_score <= 0 and float(row.unit_price) > affordable_unit_price * 1.8:
            continue
        district = row.district
        sub_district = _get_sub_district(row)
        candidates.append(
            HouseCandidate(
                model=row,
                district=district,
                sub_district=sub_district,
                community_name=_get_community_name(row, sub_district),
                title=_get_house_title(row, district, sub_district),
                area=_get_house_area(row),
                budget_score=budget_score,
            )
        )

    candidates.sort(key=lambda item: abs(float(item.model.unit_price) - affordable_unit_price))
    candidates = candidates[: max(payload.max_route_calls, payload.top_communities * payload.top_houses_per_community * 10)]

    route_calls = 0
    route_success_count = 0
    fallback_commute_count = 0

    for item in candidates:
        district = item.district
        street_key = (district, item.sub_district)
        item.convenience_score = convenience_map.get(district, 0.5)
        item.poi_score = poi_pref_map.get(district, 0.5)
        item.poi_subtype_score = street_poi_subtype_map.get(street_key, district_poi_subtype_map.get(district, 0.5))
        item.access_score = access_map.get(district, 0.5)
        item.e2sfca_score = e2sfca_map.get(district, 0.5)
        item.calibrated_score = street_calibrated_map.get(street_key, calibrated_map.get(district, 0.5))
        item.layout_score = _build_layout_score(item.model, payload.target_area)
        item.comfort_score = _build_comfort_score(item.model)
        item.community_quality_score = _build_community_quality_score(item.model)
        item.rule_score = _compute_house_pre_score(item, version)
        item.final_score = item.rule_score

    candidates.sort(key=lambda item: item.rule_score, reverse=True)
    route_budget = min(payload.max_route_calls, max(payload.top_communities * payload.top_houses_per_community * 6, 20))
    route_target = candidates[:route_budget]

    if work_location is not None:
        for item in route_target:
            origin = (float(item.model.gcj02_lng), float(item.model.gcj02_lat))
            commute = get_commute_minutes(origin, work_location, payload.commute_mode)
            route_calls += 1
            if commute is None:
                commute = estimate_commute_minutes(origin, work_location, payload.commute_mode)
                fallback_commute_count += 1
            else:
                route_success_count += 1
            item.commute_minutes = round(commute, 1) if commute is not None else None

    for item in candidates:
        if item.commute_minutes is None and work_location is not None:
            origin = (float(item.model.gcj02_lng), float(item.model.gcj02_lat))
            item.commute_minutes = estimate_commute_minutes(origin, work_location, payload.commute_mode)
            fallback_commute_count += 1
        item.commute_score = _build_commute_score(item.commute_minutes, payload.max_commute_minutes)
        item.rule_score, item.breakdown = _compute_house_score(item, version)
        item.final_score = item.rule_score

    house_rerank_diag = _apply_house_llm_rerank(payload, affordable_unit_price, candidates)

    grouped_streets: dict[tuple[str, str], list[HouseCandidate]] = {}
    for item in candidates:
        grouped_streets.setdefault((item.district, item.sub_district), []).append(item)

    street_rows: list[StreetRecommendation] = []
    for (district, sub_district), items in grouped_streets.items():
        items.sort(key=lambda x: x.final_score, reverse=True)
        top_count = min(10, len(items))
        street_score = sum(i.final_score for i in items[:top_count]) / top_count
        commute_values = [i.commute_minutes for i in items if i.commute_minutes is not None]
        median_commute = median(commute_values) if commute_values else None
        affordable_count = sum(1 for i in items if float(i.model.unit_price) <= affordable_unit_price)
        affordable_ratio = affordable_count / len(items) if items else 0.0
        street_rows.append(
            StreetRecommendation(
                district=district,
                sub_district=sub_district,
                street_score=round(_clamp(street_score), 4),
                median_commute_minutes=round(float(median_commute), 1) if median_commute is not None else None,
                house_count=len(items),
                affordable_ratio=round(_clamp(affordable_ratio), 4),
                score_breakdown={
                    "avg_access": round(mean(i.access_score for i in items), 4),
                    "avg_e2sfca": round(mean(i.e2sfca_score for i in items), 4),
                    "avg_calibrated": round(mean(i.calibrated_score for i in items), 4),
                },
                reason=f"{sub_district} affordability ratio {int(round(affordable_ratio * 100))}%.",
                risks=[
                    "Street-level recommendation is model-based and should be verified on site.",
                    "Listing price and commute can change over time.",
                ],
            )
        )

    street_rows.sort(key=lambda row: row.street_score, reverse=True)
    top_streets = street_rows[: payload.top_streets]

    grouped_communities: dict[tuple[str, str, str], list[HouseCandidate]] = {}
    for item in candidates:
        grouped_communities.setdefault((item.district, item.sub_district, item.community_name), []).append(item)

    communities: list[CommunityCandidate] = []
    for (district, sub_district, community_name), items in grouped_communities.items():
        items.sort(key=lambda x: x.final_score, reverse=True)
        commute_values = [i.commute_minutes for i in items if i.commute_minutes is not None]
        candidate = CommunityCandidate(
            community_id=f"{district}|{sub_district}|{community_name}",
            district=district,
            sub_district=sub_district,
            community_name=community_name,
            items=items,
            avg_unit_price=mean(float(i.model.unit_price) for i in items),
            avg_total_price=mean(float(i.model.price) for i in items),
            median_commute_minutes=median(commute_values) if commute_values else None,
            budget_match_score=mean(i.budget_score for i in items),
            poi_score=mean(i.poi_score for i in items),
            poi_subtype_score=mean(i.poi_subtype_score for i in items),
            traffic_score=mean(i.commute_score for i in items),
            access_score=mean(i.access_score for i in items),
            e2sfca_score=mean(i.e2sfca_score for i in items),
            calibrated_score=mean(i.calibrated_score for i in items),
            layout_score=mean(i.layout_score for i in items),
            comfort_score=mean(i.comfort_score for i in items),
            community_quality_score=mean(i.community_quality_score for i in items),
            rule_score=0.0,
            final_score=0.0,
        )
        candidate.rule_score, candidate.breakdown = _compute_community_score(candidate, version)
        candidate.final_score = candidate.rule_score
        communities.append(candidate)

    communities.sort(key=lambda x: x.rule_score, reverse=True)
    community_rerank_diag = _apply_community_llm_rerank(payload, communities)

    top_communities = communities[: payload.top_communities]
    allowed_communities = {item.community_id for item in top_communities}

    community_rows: list[CommunityRecommendation] = []
    for item in top_communities:
        fallback_reason = (
            f"户型匹配{item.layout_score:.2f}、居住舒适{item.comfort_score:.2f}、社区质量{item.community_quality_score:.2f}；"
            f"均价约{int(round(item.avg_unit_price))}，综合平衡预算与通勤。"
        )
        community_rows.append(
            CommunityRecommendation(
                district=item.district,
                sub_district=item.sub_district,
                community_name=item.community_name,
                score=round(item.final_score, 4),
                rule_score=round(item.rule_score, 4),
                llm_score=round(item.llm_score, 4) if item.llm_score is not None else None,
                llm_confidence=round(item.llm_confidence, 4) if item.llm_confidence is not None else None,
                median_commute_minutes=round(item.median_commute_minutes, 1) if item.median_commute_minutes is not None else None,
                avg_unit_price=round(item.avg_unit_price, 2),
                avg_total_price=round(item.avg_total_price, 2),
                house_count=len(item.items),
                poi_score=round(item.poi_score, 4),
                traffic_score=round(item.traffic_score, 4),
                budget_match_score=round(item.budget_match_score, 4),
                score_breakdown=item.breakdown,
                reason=item.llm_reason or fallback_reason,
                risks=[
                    "Community grouping is inferred from current street-level data.",
                    "Please verify listings before decision.",
                ],
            )
        )

    house_ids_by_community: dict[str, list[str]] = {item.community_id: [] for item in top_communities}
    for item in sorted(candidates, key=lambda x: x.final_score, reverse=True):
        community_id = f"{item.district}|{item.sub_district}|{item.community_name}"
        if community_id not in allowed_communities:
            continue
        existing_count = len(house_ids_by_community.get(community_id, []))
        if existing_count >= payload.top_houses_per_community:
            continue
        house_ids_by_community[community_id].append(str(item.model.house_id or item.model.id))

    community_house_ids = {item.community_id: house_ids_by_community.get(item.community_id, []) for item in top_communities}

    summary: dict[str, float | int | str | bool | None] = {
        "feature_version_used": version,
        "candidate_houses": len(candidates),
        "route_calls": route_calls,
        "route_success_count": route_success_count,
        "affordable_unit_price": round(affordable_unit_price, 2),
        "top_street_count": len(top_streets),
        "top_community_count": len(top_communities),
        "returned_houses": sum(len(ids) for ids in community_house_ids.values()),
        "house_rerank_applied": house_rerank_diag["house_rerank_applied"],
        "house_rerank_candidates": house_rerank_diag["house_rerank_candidates"],
        "house_rerank_success_count": house_rerank_diag["house_rerank_success_count"],
        "house_rerank_latency_ms": house_rerank_diag["house_rerank_latency_ms"],
        "house_rerank_error": house_rerank_diag["house_rerank_error"],
        "community_rerank_applied": community_rerank_diag["community_rerank_applied"],
        "community_rerank_candidates": community_rerank_diag["community_rerank_candidates"],
        "community_rerank_success_count": community_rerank_diag["community_rerank_success_count"],
        "community_rerank_latency_ms": community_rerank_diag["community_rerank_latency_ms"],
        "community_rerank_error": community_rerank_diag["community_rerank_error"],
        "amap_geocode_ok": bool(work_location is not None),
        "amap_route_success_count": route_success_count,
        "amap_route_failure_count": max(0, route_calls - route_success_count),
        "commute_fallback_count": fallback_commute_count,
        "poi_pref_ready": poi_pref_maps.diagnostics.get("poi_pref_ready", False),
        "poi_pref_grouped_rows": int(poi_pref_maps.diagnostics.get("poi_pref_grouped_rows", 0)),
        "poi_pref_street_keys": int(poi_pref_maps.diagnostics.get("poi_pref_street_keys", 0)),
        "poi_pref_district_keys": int(poi_pref_maps.diagnostics.get("poi_pref_district_keys", 0)),
    }
    if work_location_str is None:
        summary["geocode_warning"] = "work_address_geocode_failed_or_unavailable"
    elif route_calls == 0:
        summary["route_warning"] = "no_commute_route_calls_executed"

    return HouseRecommendResponse(
        work_location=work_location_str,
        streets=top_streets,
        communities=[
            community.model_copy(update={"house_ids": community_house_ids.get(f"{community.district}|{community.sub_district}|{community.community_name}", [])})
            for community in community_rows
        ],
        summary=summary,
    )
