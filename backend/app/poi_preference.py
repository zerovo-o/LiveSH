from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import PoiPoint

PREFERENCE_DIMENSIONS = (
    "daily_life",
    "commute_facility",
    "medical",
    "education",
    "recreation",
    "employment",
)

_ROLE_FACTOR = {
    "basic_daily": 1.0,
    "daily_complete": 0.9,
    "city_resource": 0.75,
    "employment": 0.8,
}

_TIER_FACTOR = {
    5: 1.0,
    10: 0.8,
    15: 0.6,
    None: 0.5,
}

_DAILY_SUBTYPES = {
    "convenience_store",
    "supermarket",
    "market",
    "general_shop",
    "shopping_mall",
    "general_hospital",
    "specialized_hospital",
    "pharmacy",
    "clinic",
}

_COMMUTE_SUBTYPES = {
    "metro_station",
    "bus_stop",
    "rail_station",
    "coach_station",
    "airport",
}

_MEDICAL_SUBTYPES = {
    "pharmacy",
    "clinic",
    "general_hospital",
    "specialized_hospital",
    "emergency",
}

_EDUCATION_KEYWORDS = ("school", "college", "university", "campus", "education")

_RECREATION_SUBTYPES = {
    "park_scenic",
    "sports_fitness",
    "culture_venue",
    "cinema_theater",
    "cafe_tea",
}

_EMPLOYMENT_SUBTYPES = {
    "business_park",
    "office_building",
    "office_company",
    "factory",
    "logistics",
    "cultural_media_company",
}


@dataclass(frozen=True)
class PreferenceMaps:
    district_scores: dict[str, float]
    street_scores: dict[tuple[str, str], float]
    diagnostics: dict[str, int | bool | str]


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


def _normalize_tuple_key(values: dict[tuple[str, str], float]) -> dict[tuple[str, str], float]:
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: _clamp((v - lo) / (hi - lo)) for k, v in values.items()}


def _clean_subtype(value: str | None) -> str:
    return str(value or "").strip().lower()


def _clean_role(value: str | None) -> str:
    return str(value or "").strip().lower()


def _dimension_flags(subtype: str, role: str) -> set[str]:
    flags: set[str] = set()
    if role in {"basic_daily", "daily_complete"} or subtype in _DAILY_SUBTYPES:
        flags.add("daily_life")
    if subtype in _COMMUTE_SUBTYPES:
        flags.add("commute_facility")
    if subtype in _MEDICAL_SUBTYPES:
        flags.add("medical")
    if any(keyword in subtype for keyword in _EDUCATION_KEYWORDS):
        flags.add("education")
    if subtype in _RECREATION_SUBTYPES:
        flags.add("recreation")
    if role == "employment" or subtype in _EMPLOYMENT_SUBTYPES:
        flags.add("employment")
    return flags


def _safe_weight(value: float | int | None) -> float:
    try:
        return _clamp(float(value or 0.0), 0.0, 3.0)
    except (TypeError, ValueError):
        return 0.0


def _blend_score(
    norm_map: dict[str, dict[str, float]],
    weights: dict[str, float],
) -> dict[str, float]:
    if not norm_map:
        return {}

    active_dims = [dim for dim in PREFERENCE_DIMENSIONS if weights.get(dim, 0.0) > 0]
    if not active_dims:
        return {key: 0.5 for key in norm_map}

    result: dict[str, float] = {}
    denom = sum(weights[dim] for dim in active_dims)
    for key, row in norm_map.items():
        total = sum(row.get(dim, 0.5) * weights[dim] for dim in active_dims)
        result[key] = _clamp(total / denom if denom > 0 else 0.5)
    return result


def _blend_score_tuple(
    norm_map: dict[tuple[str, str], dict[str, float]],
    weights: dict[str, float],
) -> dict[tuple[str, str], float]:
    if not norm_map:
        return {}

    active_dims = [dim for dim in PREFERENCE_DIMENSIONS if weights.get(dim, 0.0) > 0]
    if not active_dims:
        return {key: 0.5 for key in norm_map}

    result: dict[tuple[str, str], float] = {}
    denom = sum(weights[dim] for dim in active_dims)
    for key, row in norm_map.items():
        total = sum(row.get(dim, 0.5) * weights[dim] for dim in active_dims)
        result[key] = _clamp(total / denom if denom > 0 else 0.5)
    return result


def build_poi_preference_maps(
    db: Session,
    *,
    shopping_weight: float,
    healthcare_weight: float,
    daily_life_weight: float,
    commute_facility_weight: float,
    medical_weight: float,
    education_weight: float,
    recreation_weight: float,
    employment_weight: float,
) -> PreferenceMaps:
    weights = {
        "daily_life": _safe_weight(daily_life_weight) + 0.35 * _safe_weight(shopping_weight),
        "commute_facility": _safe_weight(commute_facility_weight),
        "medical": _safe_weight(medical_weight) + 0.5 * _safe_weight(healthcare_weight),
        "education": _safe_weight(education_weight),
        "recreation": _safe_weight(recreation_weight),
        "employment": _safe_weight(employment_weight),
    }

    rows = db.execute(
        select(
            PoiPoint.district,
            PoiPoint.street,
            PoiPoint.poi_subtype,
            PoiPoint.service_role,
            PoiPoint.life_circle_tier,
            func.sum(PoiPoint.supply_weight).label("supply_sum"),
        )
        .where(PoiPoint.is_life_service == 1)
        .where(PoiPoint.district.is_not(None))
        .group_by(
            PoiPoint.district,
            PoiPoint.street,
            PoiPoint.poi_subtype,
            PoiPoint.service_role,
            PoiPoint.life_circle_tier,
        )
    ).all()

    if not rows:
        return PreferenceMaps(
            district_scores={},
            street_scores={},
            diagnostics={
                "poi_pref_ready": False,
                "poi_pref_grouped_rows": 0,
                "poi_pref_street_keys": 0,
                "poi_pref_district_keys": 0,
                "poi_pref_warning": "no_life_service_poi_rows",
            },
        )

    district_dim_raw: dict[str, dict[str, float]] = {}
    street_dim_raw: dict[tuple[str, str], dict[str, float]] = {}

    for row in rows:
        district = str(row.district or "").strip()
        if not district:
            continue
        street = str(row.street or "").strip()
        subtype = _clean_subtype(row.poi_subtype)
        role = _clean_role(row.service_role)
        tier = row.life_circle_tier
        supply_sum = float(row.supply_sum or 0.0)
        if supply_sum <= 0:
            continue

        role_factor = _ROLE_FACTOR.get(role, 0.45)
        tier_factor = _TIER_FACTOR.get(tier, 0.5)
        row_weight = max(0.0, supply_sum * role_factor * tier_factor)
        if row_weight <= 0:
            continue

        dims = _dimension_flags(subtype, role)
        if not dims:
            continue

        district_dim_raw.setdefault(district, {dim: 0.0 for dim in PREFERENCE_DIMENSIONS})
        for dim in dims:
            district_dim_raw[district][dim] += row_weight

        if street:
            key = (district, street)
            street_dim_raw.setdefault(key, {dim: 0.0 for dim in PREFERENCE_DIMENSIONS})
            for dim in dims:
                street_dim_raw[key][dim] += row_weight

    if not district_dim_raw:
        return PreferenceMaps(
            district_scores={},
            street_scores={},
            diagnostics={
                "poi_pref_ready": False,
                "poi_pref_grouped_rows": len(rows),
                "poi_pref_street_keys": 0,
                "poi_pref_district_keys": 0,
                "poi_pref_warning": "no_valid_poi_subtype_rows_after_filtering",
            },
        )

    district_norm_by_dim: dict[str, dict[str, float]] = {district: {} for district in district_dim_raw}
    for dim in PREFERENCE_DIMENSIONS:
        raw_dim = {district: values.get(dim, 0.0) for district, values in district_dim_raw.items()}
        normalized = _normalize(raw_dim)
        for district, value in normalized.items():
            district_norm_by_dim[district][dim] = value

    street_norm_by_dim: dict[tuple[str, str], dict[str, float]] = {street: {} for street in street_dim_raw}
    for dim in PREFERENCE_DIMENSIONS:
        raw_dim = {street: values.get(dim, 0.0) for street, values in street_dim_raw.items()}
        normalized = _normalize_tuple_key(raw_dim)
        for street, value in normalized.items():
            street_norm_by_dim[street][dim] = value

    district_scores = _blend_score(district_norm_by_dim, weights)
    street_scores = _blend_score_tuple(street_norm_by_dim, weights)

    return PreferenceMaps(
        district_scores=district_scores,
        street_scores=street_scores,
        diagnostics={
            "poi_pref_ready": True,
            "poi_pref_grouped_rows": len(rows),
            "poi_pref_street_keys": len(street_scores),
            "poi_pref_district_keys": len(district_scores),
        },
    )

