from __future__ import annotations

from dataclasses import dataclass
from math import isfinite, log
from typing import Mapping, Sequence

import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree

SERVICE_CATEGORIES = ("购物", "交通", "医疗", "休闲娱乐", "公司企业")
SERVICE_COUNT_FIELDS = {
    "购物": "shopping_count",
    "交通": "traffic_count",
    "医疗": "healthcare_count",
    "休闲娱乐": "recreation_count",
    "公司企业": "company_count",
}

PHASE1_FIELDS = (
    "poi_diversity",
    "shopping_per_house",
    "traffic_per_house",
    "healthcare_per_house",
    "recreation_per_house",
    "company_per_house",
    "cost_pressure",
    "affordability_score",
    "service_score",
    "vitality_score",
    "livability_score_v2",
)

ACCESS_FIELDS = (
    "shopping_access",
    "traffic_access",
    "healthcare_access",
    "recreation_access",
    "company_access",
)
PHASE2_FIELDS = (
    *ACCESS_FIELDS,
    "nearest_traffic_distance",
    "nearest_healthcare_distance",
    "access_score",
    "value_score",
)
E2SFCA_ACCESS_FIELD_BY_CATEGORY = {
    "购物": "shopping_e2sfca_access",
    "交通": "traffic_e2sfca_access",
    "医疗": "healthcare_e2sfca_access",
    "休闲娱乐": "recreation_e2sfca_access",
    "公司企业": "company_e2sfca_access",
}
E2SFCA_ACCESS_FIELDS = tuple(E2SFCA_ACCESS_FIELD_BY_CATEGORY.values())
PHASE4_FIELDS = (
    *E2SFCA_ACCESS_FIELDS,
    "e2sfca_access_score",
    "e2sfca_value_score",
    "sample_reliability_score",
    "calibrated_score",
)


@dataclass(frozen=True)
class AccessConfig:
    category: str
    output_field: str
    radius_m: float
    beta_m: float


ACCESS_CONFIGS = (
    AccessConfig("购物", "shopping_access", 1000.0, 500.0),
    AccessConfig("交通", "traffic_access", 800.0, 400.0),
    AccessConfig("医疗", "healthcare_access", 2000.0, 1000.0),
    AccessConfig("休闲娱乐", "recreation_access", 1500.0, 750.0),
    AccessConfig("公司企业", "company_access", 2000.0, 1000.0),
)

HOUSE_FEATURE_COLUMNS = (
    "house_id",
    "district",
    "street",
    "unit_price",
    "price",
    "wgs84_lng",
    "wgs84_lat",
    "gcj02_lng",
    "gcj02_lat",
    *ACCESS_FIELDS,
    "nearest_traffic_distance",
    "nearest_healthcare_distance",
    "poi_diversity_around_house",
    "house_access_score",
    "house_affordability_score",
    "house_value_score",
)
HOUSE_PHASE4_FEATURE_COLUMNS = (
    *HOUSE_FEATURE_COLUMNS,
    *E2SFCA_ACCESS_FIELDS,
    "house_e2sfca_access_score",
    "house_e2sfca_value_score",
)
DEMAND_POINT_COLUMNS = (
    "source",
    "demand_weight",
    "district",
    "street",
    "wgs84_lng",
    "wgs84_lat",
    "gcj02_lng",
    "gcj02_lat",
)

_SHANGHAI_TRANSFORMER = Transformer.from_crs("EPSG:4326", "EPSG:32651", always_xy=True)
TREE_QUERY_CHUNK_SIZE = 5000


def numeric_series(values: pd.Series | Sequence[float]) -> pd.Series:
    series = values if isinstance(values, pd.Series) else pd.Series(values)
    return pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)


def minmax_series(values: pd.Series | Sequence[float]) -> pd.Series:
    series = numeric_series(values)
    if series.empty:
        return series.astype(float)
    valid = series.dropna()
    if valid.empty:
        return pd.Series(0.0, index=series.index, dtype=float)
    lo = float(valid.min())
    hi = float(valid.max())
    if hi == lo:
        return pd.Series(0.5, index=series.index, dtype=float)
    return ((series - lo) / (hi - lo)).clip(0.0, 1.0).fillna(0.0).astype(float)


def safe_divide(numerator, denominator):
    if isinstance(numerator, pd.Series) or isinstance(denominator, pd.Series):
        num = numeric_series(numerator)
        den = numeric_series(denominator)
        result = num.divide(den.where(den > 0))
        return result.replace([np.inf, -np.inf], np.nan).fillna(0.0).astype(float)

    try:
        num = float(numerator)
        den = float(denominator)
    except (TypeError, ValueError):
        return 0.0
    if not isfinite(num) or not isfinite(den) or den <= 0:
        return 0.0
    return num / den


def percentile_rank(values: pd.Series | Sequence[float]) -> pd.Series:
    series = numeric_series(values)
    result = pd.Series(0.0, index=series.index, dtype=float)
    valid = series.dropna()
    count = len(valid)
    if count == 0:
        return result
    if count == 1:
        result.loc[valid.index] = 0.5
        return result
    ranks = valid.rank(method="average", ascending=True)
    result.loc[valid.index] = (ranks - 1.0) / (count - 1.0)
    return result.clip(0.0, 1.0).fillna(0.0).astype(float)


def poi_diversity(
    counts: Mapping[str, float] | Sequence[float],
    categories: Sequence[str] = SERVICE_CATEGORIES,
) -> float:
    if isinstance(counts, Mapping):
        values = [max(float(counts.get(category, 0) or 0), 0.0) for category in categories]
    else:
        values = [max(float(value or 0), 0.0) for value in counts]

    total = sum(values)
    if total <= 0:
        return 0.0

    entropy = 0.0
    for value in values:
        if value <= 0:
            continue
        p = value / total
        entropy -= p * log(p)
    denominator = log(len(categories)) if len(categories) > 1 else 1.0
    return float(entropy / denominator) if denominator else 0.0


def add_phase1_scores(metrics: pd.DataFrame) -> pd.DataFrame:
    df = metrics.copy()
    for field in SERVICE_COUNT_FIELDS.values():
        if field not in df.columns:
            df[field] = 0
    for field in ("house_count", "poi_total", "business_activity", "avg_price"):
        if field not in df.columns:
            df[field] = 0
        df[field] = numeric_series(df[field]).fillna(0.0)

    df["shopping_per_house"] = safe_divide(df["shopping_count"], df["house_count"])
    df["traffic_per_house"] = safe_divide(df["traffic_count"], df["house_count"])
    df["healthcare_per_house"] = safe_divide(df["healthcare_count"], df["house_count"])
    df["recreation_per_house"] = safe_divide(df["recreation_count"], df["house_count"])
    df["company_per_house"] = safe_divide(df["company_count"], df["house_count"])

    df["poi_diversity"] = df.apply(
        lambda row: poi_diversity(
            {
                category: row.get(field, 0)
                for category, field in SERVICE_COUNT_FIELDS.items()
            }
        ),
        axis=1,
    )

    prices = numeric_series(df["avg_price"])
    log_prices = pd.Series(np.nan, index=df.index, dtype=float)
    positive_prices = prices > 0
    log_prices.loc[positive_prices] = np.log(prices.loc[positive_prices])
    df["cost_pressure"] = percentile_rank(log_prices)
    df["affordability_score"] = (1.0 - df["cost_pressure"]).clip(0.0, 1.0)

    df["service_score"] = (
        0.25 * minmax_series(df["shopping_per_house"])
        + 0.25 * minmax_series(df["traffic_per_house"])
        + 0.20 * minmax_series(df["healthcare_per_house"])
        + 0.15 * minmax_series(df["recreation_per_house"])
        + 0.15 * minmax_series(df["poi_diversity"])
    )
    df["vitality_score"] = (
        0.40 * minmax_series(df["company_per_house"])
        + 0.30 * minmax_series(df["poi_total"])
        + 0.30 * minmax_series(df["business_activity"])
    )
    df["livability_score_v2"] = (
        0.65 * df["service_score"]
        + 0.20 * df["vitality_score"]
        + 0.15 * df["affordability_score"]
    )

    for field in PHASE1_FIELDS:
        df[field] = numeric_series(df[field]).fillna(0.0).astype(float)
    return df


def decayed_access_from_distances(distances: Sequence[float] | np.ndarray, beta_m: float) -> np.ndarray:
    values = np.asarray(distances, dtype=float)
    if beta_m <= 0:
        raise ValueError("beta_m must be positive")
    return np.exp(-values / beta_m)


def residence_poi_weight(house_point_count: int, residence_poi_count: int) -> float:
    if house_point_count <= 0 or residence_poi_count <= 0:
        return 0.0
    return min(1.0, float(house_point_count) / float(residence_poi_count))


def project_wgs84_to_meters(lng: pd.Series | np.ndarray, lat: pd.Series | np.ndarray) -> np.ndarray:
    x, y = _SHANGHAI_TRANSFORMER.transform(np.asarray(lng, dtype=float), np.asarray(lat, dtype=float))
    return np.column_stack([x, y])


def _chunk_bounds(length: int, chunk_size: int = TREE_QUERY_CHUNK_SIZE):
    for start in range(0, length, chunk_size):
        yield start, min(start + chunk_size, length)


def _valid_wgs84_points(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.dropna(subset=["wgs84_lng", "wgs84_lat"]).copy()
    lng = numeric_series(result["wgs84_lng"])
    lat = numeric_series(result["wgs84_lat"])
    result = result[lng.between(120.5, 122.2) & lat.between(30.5, 31.9)]
    return result


def _compute_category_access(house_xy: np.ndarray, poi_xy: np.ndarray, radius_m: float, beta_m: float) -> np.ndarray:
    if len(house_xy) == 0 or len(poi_xy) == 0:
        return np.zeros(len(house_xy), dtype=float)
    tree = cKDTree(poi_xy)
    access = np.zeros(len(house_xy), dtype=float)
    for start, end in _chunk_bounds(len(house_xy)):
        neighbors = tree.query_ball_point(house_xy[start:end], r=radius_m)
        for offset, neighbor_indexes in enumerate(neighbors):
            if not neighbor_indexes:
                continue
            index = start + offset
            distances = np.linalg.norm(poi_xy[neighbor_indexes] - house_xy[index], axis=1)
            access[index] = float(decayed_access_from_distances(distances, beta_m).sum())
    return access


def _nearest_distances(house_xy: np.ndarray, poi_xy: np.ndarray) -> np.ndarray:
    if len(house_xy) == 0 or len(poi_xy) == 0:
        return np.full(len(house_xy), np.nan, dtype=float)
    distances, _ = cKDTree(poi_xy).query(house_xy, k=1)
    return np.asarray(distances, dtype=float)


def build_demand_points(houses: pd.DataFrame, pois: pd.DataFrame) -> pd.DataFrame:
    house_points = _valid_wgs84_points(houses)
    residence_pois = _valid_wgs84_points(pois[pois["category"] == "住宅"]) if "category" in pois.columns else pd.DataFrame()
    weight = residence_poi_weight(len(house_points), len(residence_pois))

    demand_frames: list[pd.DataFrame] = []
    if not house_points.empty:
        house_demand = house_points.copy()
        house_demand["source"] = "house_listing"
        house_demand["demand_weight"] = 1.0
        demand_frames.append(house_demand)

    if not residence_pois.empty and weight > 0:
        residence_demand = residence_pois.copy()
        residence_demand["source"] = "residence_poi"
        residence_demand["demand_weight"] = weight
        demand_frames.append(residence_demand)

    if not demand_frames:
        return pd.DataFrame(columns=DEMAND_POINT_COLUMNS)

    demand_points = pd.concat(demand_frames, ignore_index=True)
    for column in DEMAND_POINT_COLUMNS:
        if column not in demand_points.columns:
            demand_points[column] = None
    return demand_points[list(DEMAND_POINT_COLUMNS)]


def compute_facility_supply_ratios(
    facility_xy: np.ndarray,
    demand_xy: np.ndarray,
    demand_weights: Sequence[float] | np.ndarray,
    radius_m: float,
    beta_m: float,
) -> np.ndarray:
    if len(facility_xy) == 0 or len(demand_xy) == 0:
        return np.zeros(len(facility_xy), dtype=float)

    demand_weights_array = np.asarray(demand_weights, dtype=float)
    demand_tree = cKDTree(demand_xy)
    ratios = np.zeros(len(facility_xy), dtype=float)
    for start, end in _chunk_bounds(len(facility_xy)):
        neighbors = demand_tree.query_ball_point(facility_xy[start:end], r=radius_m)
        for offset, neighbor_indexes in enumerate(neighbors):
            if not neighbor_indexes:
                continue
            index = start + offset
            distances = np.linalg.norm(demand_xy[neighbor_indexes] - facility_xy[index], axis=1)
            denominator = float((demand_weights_array[neighbor_indexes] * decayed_access_from_distances(distances, beta_m)).sum())
            ratios[index] = 1.0 / denominator if denominator > 0 else 0.0
    return ratios


def compute_weighted_facility_access(
    target_xy: np.ndarray,
    facility_xy: np.ndarray,
    facility_weights: Sequence[float] | np.ndarray,
    radius_m: float,
    beta_m: float,
) -> np.ndarray:
    if len(target_xy) == 0 or len(facility_xy) == 0:
        return np.zeros(len(target_xy), dtype=float)

    facility_weights_array = np.asarray(facility_weights, dtype=float)
    facility_tree = cKDTree(facility_xy)
    access = np.zeros(len(target_xy), dtype=float)
    for start, end in _chunk_bounds(len(target_xy)):
        neighbors = facility_tree.query_ball_point(target_xy[start:end], r=radius_m)
        for offset, neighbor_indexes in enumerate(neighbors):
            if not neighbor_indexes:
                continue
            index = start + offset
            distances = np.linalg.norm(facility_xy[neighbor_indexes] - target_xy[index], axis=1)
            access[index] = float((facility_weights_array[neighbor_indexes] * decayed_access_from_distances(distances, beta_m)).sum())
    return access


def compute_house_features(houses: pd.DataFrame, pois: pd.DataFrame) -> pd.DataFrame:
    required_house_columns = {
        "house_id",
        "district",
        "street",
        "unit_price",
        "price",
        "wgs84_lng",
        "wgs84_lat",
        "gcj02_lng",
        "gcj02_lat",
    }
    required_poi_columns = {"category", "wgs84_lng", "wgs84_lat"}
    missing_house = required_house_columns - set(houses.columns)
    missing_poi = required_poi_columns - set(pois.columns)
    if missing_house:
        raise ValueError(f"houses missing required columns: {sorted(missing_house)}")
    if missing_poi:
        raise ValueError(f"pois missing required columns: {sorted(missing_poi)}")

    features = _valid_wgs84_points(houses).reset_index(drop=True)
    if features.empty:
        return pd.DataFrame(columns=HOUSE_FEATURE_COLUMNS)

    house_xy = project_wgs84_to_meters(features["wgs84_lng"], features["wgs84_lat"])
    valid_pois = _valid_wgs84_points(pois)

    projected_by_category: dict[str, np.ndarray] = {}
    for config in ACCESS_CONFIGS:
        category_pois = valid_pois[valid_pois["category"] == config.category]
        projected_by_category[config.category] = (
            project_wgs84_to_meters(category_pois["wgs84_lng"], category_pois["wgs84_lat"])
            if not category_pois.empty
            else np.empty((0, 2), dtype=float)
        )
        features[config.output_field] = _compute_category_access(
            house_xy,
            projected_by_category[config.category],
            config.radius_m,
            config.beta_m,
        )

    features["nearest_traffic_distance"] = _nearest_distances(house_xy, projected_by_category["交通"])
    features["nearest_healthcare_distance"] = _nearest_distances(house_xy, projected_by_category["医疗"])

    access_matrix = features[list(ACCESS_FIELDS)].to_numpy(dtype=float)
    features["poi_diversity_around_house"] = [poi_diversity(row) for row in access_matrix]
    features["house_access_score"] = (
        0.25 * minmax_series(features["shopping_access"])
        + 0.25 * minmax_series(features["traffic_access"])
        + 0.20 * minmax_series(features["healthcare_access"])
        + 0.15 * minmax_series(features["recreation_access"])
        + 0.10 * minmax_series(features["company_access"])
        + 0.05 * minmax_series(features["poi_diversity_around_house"])
    )

    unit_prices = numeric_series(features["unit_price"])
    log_unit_prices = pd.Series(np.nan, index=features.index, dtype=float)
    positive_prices = unit_prices > 0
    log_unit_prices.loc[positive_prices] = np.log(unit_prices.loc[positive_prices])
    features["house_affordability_score"] = (1.0 - percentile_rank(log_unit_prices)).clip(0.0, 1.0)
    features["house_value_score"] = (
        0.65 * features["house_access_score"]
        + 0.35 * features["house_affordability_score"]
    )

    for field in (
        *ACCESS_FIELDS,
        "poi_diversity_around_house",
        "house_access_score",
        "house_affordability_score",
        "house_value_score",
    ):
        features[field] = numeric_series(features[field]).fillna(0.0).astype(float)
    for field in ("nearest_traffic_distance", "nearest_healthcare_distance"):
        features[field] = numeric_series(features[field])
    return features[list(HOUSE_FEATURE_COLUMNS)]


def compute_e2sfca_house_features(
    house_features: pd.DataFrame,
    demand_points: pd.DataFrame,
    pois: pd.DataFrame,
) -> pd.DataFrame:
    required_house_columns = set(HOUSE_FEATURE_COLUMNS)
    required_demand_columns = {"demand_weight", "wgs84_lng", "wgs84_lat"}
    required_poi_columns = {"category", "wgs84_lng", "wgs84_lat"}
    missing_house = required_house_columns - set(house_features.columns)
    missing_demand = required_demand_columns - set(demand_points.columns)
    missing_poi = required_poi_columns - set(pois.columns)
    if missing_house:
        raise ValueError(f"house_features missing required columns: {sorted(missing_house)}")
    if missing_demand:
        raise ValueError(f"demand_points missing required columns: {sorted(missing_demand)}")
    if missing_poi:
        raise ValueError(f"pois missing required columns: {sorted(missing_poi)}")

    features = _valid_wgs84_points(house_features).reset_index(drop=True)
    if features.empty:
        return pd.DataFrame(columns=HOUSE_PHASE4_FEATURE_COLUMNS)

    house_xy = project_wgs84_to_meters(features["wgs84_lng"], features["wgs84_lat"])
    valid_demand = _valid_wgs84_points(demand_points)
    valid_pois = _valid_wgs84_points(pois)
    demand_xy = (
        project_wgs84_to_meters(valid_demand["wgs84_lng"], valid_demand["wgs84_lat"])
        if not valid_demand.empty
        else np.empty((0, 2), dtype=float)
    )
    demand_weights = numeric_series(valid_demand["demand_weight"]).fillna(0.0).to_numpy(dtype=float)

    for config in ACCESS_CONFIGS:
        e2sfca_field = E2SFCA_ACCESS_FIELD_BY_CATEGORY[config.category]
        facility_pois = valid_pois[valid_pois["category"] == config.category]
        facility_xy = (
            project_wgs84_to_meters(facility_pois["wgs84_lng"], facility_pois["wgs84_lat"])
            if not facility_pois.empty
            else np.empty((0, 2), dtype=float)
        )
        supply_ratios = compute_facility_supply_ratios(
            facility_xy,
            demand_xy,
            demand_weights,
            config.radius_m,
            config.beta_m,
        )
        features[e2sfca_field] = compute_weighted_facility_access(
            house_xy,
            facility_xy,
            supply_ratios,
            config.radius_m,
            config.beta_m,
        )

    features["house_e2sfca_access_score"] = (
        0.25 * minmax_series(features["shopping_e2sfca_access"])
        + 0.25 * minmax_series(features["traffic_e2sfca_access"])
        + 0.20 * minmax_series(features["healthcare_e2sfca_access"])
        + 0.15 * minmax_series(features["recreation_e2sfca_access"])
        + 0.15 * minmax_series(features["company_e2sfca_access"])
    )
    features["house_e2sfca_value_score"] = (
        0.65 * features["house_e2sfca_access_score"]
        + 0.35 * features["house_affordability_score"]
    )

    for field in (*E2SFCA_ACCESS_FIELDS, "house_e2sfca_access_score", "house_e2sfca_value_score"):
        features[field] = numeric_series(features[field]).fillna(0.0).astype(float)
    return features[list(HOUSE_PHASE4_FEATURE_COLUMNS)]


def aggregate_house_features(house_features: pd.DataFrame, group_cols: Sequence[str]) -> pd.DataFrame:
    columns = list(group_cols) + list(PHASE2_FIELDS)
    if house_features.empty:
        return pd.DataFrame(columns=columns)

    valid = house_features.dropna(subset=list(group_cols)).copy()
    if valid.empty:
        return pd.DataFrame(columns=columns)

    grouped = valid.groupby(list(group_cols)).agg(
        shopping_access=("shopping_access", "mean"),
        traffic_access=("traffic_access", "mean"),
        healthcare_access=("healthcare_access", "mean"),
        recreation_access=("recreation_access", "mean"),
        company_access=("company_access", "mean"),
        nearest_traffic_distance=("nearest_traffic_distance", "median"),
        nearest_healthcare_distance=("nearest_healthcare_distance", "median"),
        access_score=("house_access_score", "mean"),
        value_score=("house_value_score", "mean"),
    )
    return grouped.reset_index()[columns]


def attach_phase2_scores(metrics: pd.DataFrame, house_features: pd.DataFrame, group_cols: Sequence[str]) -> pd.DataFrame:
    df = metrics.copy()
    aggregated = aggregate_house_features(house_features, group_cols)
    if not aggregated.empty:
        df = df.merge(aggregated, on=list(group_cols), how="left")
    else:
        for field in PHASE2_FIELDS:
            df[field] = np.nan

    for field in ACCESS_FIELDS:
        df[field] = numeric_series(df.get(field, pd.Series(index=df.index, dtype=float))).fillna(0.0)
    for field in ("access_score", "value_score"):
        df[field] = numeric_series(df.get(field, pd.Series(index=df.index, dtype=float))).fillna(0.0)
    for field in ("nearest_traffic_distance", "nearest_healthcare_distance"):
        df[field] = numeric_series(df.get(field, pd.Series(index=df.index, dtype=float)))
    return df


def aggregate_e2sfca_features(house_features: pd.DataFrame, group_cols: Sequence[str]) -> pd.DataFrame:
    columns = list(group_cols) + list(E2SFCA_ACCESS_FIELDS) + ["e2sfca_value_score"]
    if house_features.empty:
        return pd.DataFrame(columns=columns)

    valid = house_features.dropna(subset=list(group_cols)).copy()
    if valid.empty:
        return pd.DataFrame(columns=columns)

    grouped = valid.groupby(list(group_cols)).agg(
        shopping_e2sfca_access=("shopping_e2sfca_access", "mean"),
        traffic_e2sfca_access=("traffic_e2sfca_access", "mean"),
        healthcare_e2sfca_access=("healthcare_e2sfca_access", "mean"),
        recreation_e2sfca_access=("recreation_e2sfca_access", "mean"),
        company_e2sfca_access=("company_e2sfca_access", "mean"),
        e2sfca_value_score=("house_e2sfca_value_score", "mean"),
    )
    return grouped.reset_index()[columns]


def attach_phase4_scores(
    metrics: pd.DataFrame,
    house_features: pd.DataFrame,
    group_cols: Sequence[str],
    reliability_house_threshold: int,
) -> pd.DataFrame:
    df = metrics.copy()
    if "house_count" not in df.columns:
        df["house_count"] = 0.0
    if "livability_score_v2" not in df.columns:
        df["livability_score_v2"] = 0.0
    if "value_score" not in df.columns:
        df["value_score"] = 0.0
    aggregated = aggregate_e2sfca_features(house_features, group_cols)
    if not aggregated.empty:
        df = df.merge(aggregated, on=list(group_cols), how="left")
    else:
        for field in E2SFCA_ACCESS_FIELDS:
            df[field] = np.nan
        df["e2sfca_value_score"] = np.nan

    for field in E2SFCA_ACCESS_FIELDS:
        df[field] = numeric_series(df.get(field, pd.Series(index=df.index, dtype=float))).fillna(0.0)
    df["e2sfca_value_score"] = numeric_series(df.get("e2sfca_value_score", pd.Series(index=df.index, dtype=float))).fillna(0.0)
    df["e2sfca_access_score"] = (
        0.25 * minmax_series(df["shopping_e2sfca_access"])
        + 0.25 * minmax_series(df["traffic_e2sfca_access"])
        + 0.20 * minmax_series(df["healthcare_e2sfca_access"])
        + 0.15 * minmax_series(df["recreation_e2sfca_access"])
        + 0.15 * minmax_series(df["company_e2sfca_access"])
    )
    threshold = max(float(reliability_house_threshold), 1.0)
    df["sample_reliability_score"] = (numeric_series(df["house_count"]).fillna(0.0) / threshold).clip(0.0, 1.0)
    df["calibrated_score"] = (
        0.50 * numeric_series(df["livability_score_v2"]).fillna(0.0)
        + 0.35 * df["e2sfca_access_score"]
        + 0.15 * numeric_series(df["value_score"]).fillna(0.0)
    ) * df["sample_reliability_score"]

    for field in PHASE4_FIELDS:
        df[field] = numeric_series(df[field]).fillna(0.0).astype(float)
    return df
