from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import DATA_DIR
from .models import RouteLifeCircleMetric


EPSILON = 1e-6
TEMPERATURE = 1.5
DISTRICT_ROUTE_OUTPUTS = {
    "yangpu": "yangpu",
    "杨浦": "yangpu",
    "杨浦区": "yangpu",
    "huangpu": "huangpu",
    "黄浦": "huangpu",
    "黄浦区": "huangpu",
    "jiading": "jiading",
    "嘉定": "jiading",
    "嘉定区": "jiading",
}


def _float_value(row: dict[str, str], field: str, default: float = 0.0) -> float:
    try:
        value = float(row.get(field, ""))
    except (TypeError, ValueError):
        return default
    return value if math.isfinite(value) else default


def _int_value(row: dict[str, str], field: str, default: int = 0) -> int:
    try:
        return int(float(row.get(field, "")))
    except (TypeError, ValueError):
        return default


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def _clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def _sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-value)
        return 1 / (1 + exp_value)
    exp_value = math.exp(value)
    return exp_value / (1 + exp_value)


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    index = (len(sorted_values) - 1) * p
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return sorted_values[low]
    return sorted_values[low] * (high - index) + sorted_values[high] * (index - low)


def robust_stats(values: Iterable[float | None]) -> tuple[float, float]:
    sorted_values = sorted(value for value in values if value is not None and math.isfinite(value))
    if not sorted_values:
        return 0.0, 1.0
    median = _percentile(sorted_values, 0.5)
    q25 = _percentile(sorted_values, 0.25)
    q75 = _percentile(sorted_values, 0.75)
    return median, max(q75 - q25, EPSILON)


def linear_display(raw: float | None) -> float | None:
    if raw is None or not math.isfinite(raw):
        return None
    return round(_clamp(raw * 10, 0, 10), 4)


def robust_sigmoid_display(raw: float | None, median: float, iqr: float) -> float | None:
    if raw is None or not math.isfinite(raw):
        return None
    z = (raw - median) / max(iqr, EPSILON)
    return round(_clamp(4 + 5 * _sigmoid(z / TEMPERATURE), 4, 9), 4)


def _route_output_slug(district: str) -> str | None:
    return DISTRICT_ROUTE_OUTPUTS.get(str(district or "").strip())


def has_route_metrics(district: str) -> bool:
    slug = _route_output_slug(district)
    if not slug:
        return False
    compare_path = DATA_DIR / "derived" / f"amap_walk_compare_{slug}_all.csv"
    metrics_path = DATA_DIR / "derived" / f"amap_walk_life_circle_street_metrics_{slug}_all.csv"
    return compare_path.exists() and metrics_path.exists()


def build_route_metric_records(district: str, calibrated_reference_values: Iterable[float | None]) -> list[dict]:
    slug = _route_output_slug(district)
    if not slug:
        return []
    compare_path = DATA_DIR / "derived" / f"amap_walk_compare_{slug}_all.csv"
    metrics_path = DATA_DIR / "derived" / f"amap_walk_life_circle_street_metrics_{slug}_all.csv"

    route_score_rows = {
        (row.get("district", ""), row.get("street", "")): row
        for row in _read_csv(metrics_path)
    }
    median, iqr = robust_stats(calibrated_reference_values)

    result: list[dict] = []
    for row in _read_csv(compare_path):
        key = (row.get("district", ""), row.get("street", ""))
        route_scores = route_score_rows.get(key, {})
        life_5 = _float_value(route_scores, "life_circle_5min_score_route")
        life_10 = _float_value(route_scores, "life_circle_10min_score_route")
        life_15 = _float_value(route_scores, "life_circle_15min_score_route")
        life_total = _float_value(row, "life_circle_score_route")
        calibrated = _float_value(row, "calibrated_score_life_circle_route")

        result.append(
            {
                "district": key[0],
                "street": key[1],
                "sample_house_count": _int_value(row, "sample_house_count"),
                "route_expected_count": _int_value(row, "route_expected_count"),
                "route_success_count": _int_value(row, "route_success_count"),
                "route_cache_hit_count": _int_value(row, "route_cache_hit_count"),
                "route_success_rate": _float_value(row, "route_success_rate"),
                "route_sample_reliability_score": _float_value(row, "route_sample_reliability_score"),
                "life_circle_5min_score_route": life_5,
                "life_circle_5min_score_route_display": linear_display(life_5),
                "life_circle_10min_score_route": life_10,
                "life_circle_10min_score_route_display": linear_display(life_10),
                "life_circle_15min_score_route": life_15,
                "life_circle_15min_score_route_display": linear_display(life_15),
                "life_circle_score_route": life_total,
                "life_circle_score_route_display": linear_display(life_total),
                "calibrated_score_life_circle_route": calibrated,
                "calibrated_score_life_circle_route_display": robust_sigmoid_display(calibrated, median, iqr),
                "life_circle_score_delta": _float_value(row, "life_circle_score_delta"),
                "calibrated_score_delta": _float_value(row, "calibrated_score_delta"),
                "old_rank": _int_value(row, "old_rank"),
                "route_rank": _int_value(row, "route_rank"),
                "rank_delta": _int_value(row, "rank_delta"),
            }
        )
    return result


def has_route_metrics_in_db(district: str, db: Session) -> bool:
    slug = _route_output_slug(district)
    if not slug:
        return False
    rows = load_route_metrics_from_db(slug, db)
    return bool(rows)


def _route_metric_to_dict(metric: RouteLifeCircleMetric) -> dict:
    return {
        "district": metric.district,
        "street": metric.street,
        "sample_house_count": metric.sample_house_count,
        "route_expected_count": metric.route_expected_count,
        "route_success_count": metric.route_success_count,
        "route_cache_hit_count": metric.route_cache_hit_count,
        "route_success_rate": metric.route_success_rate,
        "route_sample_reliability_score": metric.route_sample_reliability_score,
        "life_circle_5min_score_route": metric.life_circle_5min_score_route,
        "life_circle_5min_score_route_display": metric.life_circle_5min_score_route_display,
        "life_circle_10min_score_route": metric.life_circle_10min_score_route,
        "life_circle_10min_score_route_display": metric.life_circle_10min_score_route_display,
        "life_circle_15min_score_route": metric.life_circle_15min_score_route,
        "life_circle_15min_score_route_display": metric.life_circle_15min_score_route_display,
        "life_circle_score_route": metric.life_circle_score_route,
        "life_circle_score_route_display": metric.life_circle_score_route_display,
        "calibrated_score_life_circle_route": metric.calibrated_score_life_circle_route,
        "calibrated_score_life_circle_route_display": metric.calibrated_score_life_circle_route_display,
        "life_circle_score_delta": metric.life_circle_score_delta,
        "calibrated_score_delta": metric.calibrated_score_delta,
        "old_rank": metric.old_rank,
        "route_rank": metric.route_rank,
        "rank_delta": metric.rank_delta,
    }


def load_route_metrics_from_db(district: str, db: Session) -> list[dict]:
    slug = _route_output_slug(district)
    if not slug:
        return []
    district_names = {
        "yangpu": ["杨浦", "杨浦区"],
        "huangpu": ["黄浦", "黄浦区"],
        "jiading": ["嘉定", "嘉定区"],
    }[slug]
    metrics = db.scalars(
        select(RouteLifeCircleMetric)
        .where(RouteLifeCircleMetric.district.in_(district_names))
        .order_by(RouteLifeCircleMetric.route_rank.asc(), RouteLifeCircleMetric.street.asc())
    ).all()
    return [_route_metric_to_dict(metric) for metric in metrics]


def load_route_metrics(district: str, calibrated_reference_values: Iterable[float | None]) -> list[dict]:
    return build_route_metric_records(district, calibrated_reference_values)


def load_yangpu_route_metrics(calibrated_reference_values: Iterable[float | None]) -> list[dict]:
    return load_route_metrics("yangpu", calibrated_reference_values)
