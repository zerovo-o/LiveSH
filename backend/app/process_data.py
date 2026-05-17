from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import pandas as pd
import shapefile
from sqlalchemy import delete

from .config import DATA_DIR
from .database import Base, SessionLocal, engine
from .geo import normalize_district, wgs84_to_gcj02
from .metrics import (
    add_phase1_scores,
    attach_life_circle_scores,
    attach_phase2_scores,
    attach_phase4_scores,
    build_demand_points,
    compute_e2sfca_house_features,
    compute_house_features,
    compute_life_circle_house_features,
)
from .models import DistrictMetric, HouseListing, PoiCategoryMetric, PoiPoint, StreetMetric
from .poi_taxonomy import add_poi_classification_columns, build_poi_subtype_audit

CATEGORY_BY_SOURCE = {
    "sh_shopping": "购物",
    "sh_healthcare": "医疗",
    "sh_traffic facility": "交通",
    "sh_recreation": "休闲娱乐",
    "sh_company": "公司企业",
    "sh_residence": "住宅",
}

ACTIVITY_WEIGHTS = {
    "购物": 0.35,
    "交通": 0.25,
    "医疗": 0.15,
    "休闲娱乐": 0.15,
    "公司企业": 0.10,
}

STREET_BOUNDARY_PATH = DATA_DIR / "sh_street_boundary" / "shanghai_street_boundary.shp"


def minmax(series: pd.Series) -> pd.Series:
    if series.empty:
        return series
    lo = float(series.min())
    hi = float(series.max())
    if hi == lo:
        return pd.Series([0.5] * len(series), index=series.index)
    return (series - lo) / (hi - lo)


def records_for_insert(frame: pd.DataFrame) -> list[dict]:
    clean = frame.replace([float("inf"), -float("inf")], pd.NA).astype(object)
    return clean.where(pd.notna(clean), None).to_dict(orient="records")


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        intersects = (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_shape(x: float, y: float, shape: shapefile.Shape) -> bool:
    xmin, ymin, xmax, ymax = shape.bbox
    if not (xmin <= x <= xmax and ymin <= y <= ymax):
        return False
    points = shape.points
    parts = list(shape.parts) + [len(points)]
    for start, end in zip(parts, parts[1:]):
        ring = points[start:end]
        if len(ring) >= 3 and point_in_ring(x, y, ring):
            return True
    return False


def load_street_shapes(path: Path = STREET_BOUNDARY_PATH) -> list[dict]:
    if not path.exists():
        return []
    reader = shapefile.Reader(str(path), encoding="utf-8")
    streets: list[dict] = []
    for shape_record in reader.iterShapeRecords():
        record = shape_record.record.as_dict()
        street = str(record.get("STREET") or "").strip()
        district = normalize_district(record.get("AREA"))
        if street:
            streets.append({"district": district, "street": street, "shape": shape_record.shape})
    return streets


def locate_street(lng: float | None, lat: float | None, streets: list[dict]) -> tuple[str, str] | None:
    if lng is None or lat is None:
        return None
    for item in streets:
        if point_in_shape(float(lng), float(lat), item["shape"]):
            return item["district"], item["street"]
    return None


def assign_streets(rows: pd.DataFrame, streets: list[dict]) -> pd.DataFrame:
    if not streets or rows.empty:
        rows["street"] = None
        return rows
    results = [locate_street(float(row.wgs84_lng), float(row.wgs84_lat), streets) for row in rows.itertuples(index=False)]
    rows = rows.copy()
    rows["street"] = [item[1] if item else None for item in results]
    rows["district"] = [item[0] if item else district for item, district in zip(results, rows["district"])]
    return rows


STANDARD_HOUSE_COLUMNS = [
    "house_id",
    "district",
    "street",
    "price",
    "unit_price",
    "wgs84_lng",
    "wgs84_lat",
    "gcj02_lng",
    "gcj02_lat",
]


def load_standard_house_rows(df: pd.DataFrame) -> pd.DataFrame:
    cols = [column for column in STANDARD_HOUSE_COLUMNS if column in df.columns]
    result = df[cols].copy()
    if "street" not in result.columns:
        result["street"] = None
    if "is_valid_for_algorithm" in df.columns:
        result = result[df["is_valid_for_algorithm"].fillna(False).astype(bool)].copy()
    result = result.dropna(subset=["house_id", "district", "price", "unit_price", "wgs84_lng", "wgs84_lat", "gcj02_lng", "gcj02_lat"])
    result = result.drop_duplicates(subset=["house_id"])
    result["district"] = result["district"].map(normalize_district)
    numeric_cols = ["price", "unit_price", "wgs84_lng", "wgs84_lat", "gcj02_lng", "gcj02_lat"]
    for column in numeric_cols:
        result[column] = pd.to_numeric(result[column], errors="coerce")
    result = result.dropna(subset=numeric_cols)
    return result[(result["wgs84_lng"].between(120.5, 122.2)) & (result["wgs84_lat"].between(30.5, 31.9))]


def load_legacy_house_rows(df: pd.DataFrame) -> pd.DataFrame:
    cols = ["house_id", "district", "listing_total_price", "listing_unit_price", "longitude", "latitude"]
    missing = set(cols) - set(df.columns)
    if missing:
        raise ValueError(f"house data missing required columns: {sorted(missing)}")
    result = df[cols].rename(
        columns={
            "listing_total_price": "price",
            "listing_unit_price": "unit_price",
            "longitude": "wgs84_lng",
            "latitude": "wgs84_lat",
        }
    )
    result = result.dropna(subset=["district", "price", "unit_price", "wgs84_lng", "wgs84_lat"])
    result = result.drop_duplicates(subset=["house_id"])
    result["district"] = result["district"].map(normalize_district)
    result = result[(result["wgs84_lng"].between(120.5, 122.2)) & (result["wgs84_lat"].between(30.5, 31.9))]
    gcj = result.apply(lambda r: wgs84_to_gcj02(float(r["wgs84_lng"]), float(r["wgs84_lat"])), axis=1)
    result["gcj02_lng"] = [item[0] for item in gcj]
    result["gcj02_lat"] = [item[1] for item in gcj]
    result["street"] = None
    return result[STANDARD_HOUSE_COLUMNS]


def load_house_rows(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    if {"price", "unit_price", "wgs84_lng", "wgs84_lat", "gcj02_lng", "gcj02_lat"}.issubset(df.columns):
        return load_standard_house_rows(df)[STANDARD_HOUSE_COLUMNS]
    return load_legacy_house_rows(df)


def iter_poi_rows(raw_dir: Path):
    for shp_path in raw_dir.glob("*/*.shp"):
        source = shp_path.parent.name
        category = CATEGORY_BY_SOURCE.get(source, "其他")
        reader = shapefile.Reader(str(shp_path), encoding="gbk")
        seen_uids: set[str] = set()
        for shape_record in reader.iterShapeRecords():
            row = shape_record.record.as_dict()
            uid = str(row.get("uid") or "").strip()
            if uid and uid in seen_uids:
                continue
            seen_uids.add(uid)
            district = normalize_district(row.get("area"))
            gcj_lng = row.get("gcj02_lng")
            gcj_lat = row.get("gcj02_lat")
            wgs_lng = row.get("wgs84_lng")
            wgs_lat = row.get("wgs84_lat")
            if gcj_lng is None or gcj_lat is None:
                points = getattr(shape_record.shape, "points", [])
                if not points:
                    continue
                wgs_lng, wgs_lat = points[0]
                gcj_lng, gcj_lat = wgs84_to_gcj02(float(wgs_lng), float(wgs_lat))
            if not (120.5 <= float(gcj_lng) <= 122.2 and 30.5 <= float(gcj_lat) <= 31.9):
                continue
            yield {
                "uid": uid or None,
                "name": str(row.get("name") or ""),
                "category": category,
                "source": source,
                "district": district,
                "tag": str(row.get("tag") or ""),
                "wgs84_lng": float(wgs_lng) if wgs_lng not in (None, "") else None,
                "wgs84_lat": float(wgs_lat) if wgs_lat not in (None, "") else None,
                "gcj02_lng": float(gcj_lng),
                "gcj02_lat": float(gcj_lat),
            }


def build_metrics(houses: pd.DataFrame, pois: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    house_agg = houses.groupby("district").agg(
        avg_price=("unit_price", "mean"),
        avg_total_price=("price", "mean"),
        house_count=("house_id", "count"),
        center_lng=("gcj02_lng", "mean"),
        center_lat=("gcj02_lat", "mean"),
    )
    poi_pivot = (
        pois.pivot_table(index="district", columns="category", values="name", aggfunc="count", fill_value=0)
        if not pois.empty
        else pd.DataFrame()
    )
    for category in CATEGORY_BY_SOURCE.values():
        if category not in poi_pivot.columns:
            poi_pivot[category] = 0
    poi_pivot["poi_total"] = poi_pivot[list(CATEGORY_BY_SOURCE.values())].sum(axis=1)
    metrics = house_agg.join(poi_pivot, how="left").fillna(0)
    metrics["business_activity"] = sum(metrics.get(cat, 0) * weight for cat, weight in ACTIVITY_WEIGHTS.items())
    metrics["activity_norm"] = minmax(metrics["business_activity"])
    metrics["price_norm"] = minmax(metrics["avg_price"])
    metrics["livability_score"] = metrics["activity_norm"] - metrics["price_norm"]
    metrics = metrics.reset_index()
    metrics = metrics.rename(
        columns={
            "购物": "shopping_count",
            "医疗": "healthcare_count",
            "交通": "traffic_count",
            "休闲娱乐": "recreation_count",
            "公司企业": "company_count",
            "住宅": "residence_count",
        }
    )
    metrics = add_phase1_scores(metrics)
    category_counts = pd.DataFrame(
        [{"category": category, "count": count} for category, count in Counter(pois["category"]).items()]
    )
    return metrics, category_counts


def build_street_metrics(houses: pd.DataFrame, pois: pd.DataFrame) -> pd.DataFrame:
    houses = houses.dropna(subset=["street"])
    pois = pois.dropna(subset=["street"])
    if houses.empty:
        return pd.DataFrame()

    group_cols = ["district", "street"]
    house_agg = houses.groupby(group_cols).agg(
        avg_price=("unit_price", "mean"),
        avg_total_price=("price", "mean"),
        house_count=("house_id", "count"),
        center_lng=("gcj02_lng", "mean"),
        center_lat=("gcj02_lat", "mean"),
    )
    poi_pivot = (
        pois.pivot_table(index=group_cols, columns="category", values="name", aggfunc="count", fill_value=0)
        if not pois.empty
        else pd.DataFrame()
    )
    for category in CATEGORY_BY_SOURCE.values():
        if category not in poi_pivot.columns:
            poi_pivot[category] = 0
    poi_pivot["poi_total"] = poi_pivot[list(CATEGORY_BY_SOURCE.values())].sum(axis=1)
    metrics = house_agg.join(poi_pivot, how="left").fillna(0)
    metrics["business_activity"] = sum(metrics.get(cat, 0) * weight for cat, weight in ACTIVITY_WEIGHTS.items())
    metrics["activity_norm"] = minmax(metrics["business_activity"])
    metrics["price_norm"] = minmax(metrics["avg_price"])
    metrics["livability_score"] = metrics["activity_norm"] - metrics["price_norm"]
    metrics = metrics.reset_index().rename(
        columns={
            "购物": "shopping_count",
            "医疗": "healthcare_count",
            "交通": "traffic_count",
            "休闲娱乐": "recreation_count",
            "公司企业": "company_count",
            "住宅": "residence_count",
        }
    )
    return add_phase1_scores(metrics)


def ingest(data_dir: Path = DATA_DIR, house_path: Path | None = None) -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    street_shapes = load_street_shapes(data_dir / "sh_street_boundary" / "shanghai_street_boundary.shp")
    resolved_house_path = house_path or data_dir / "sh_house_dataset_raw.parquet"
    houses = load_house_rows(resolved_house_path)
    pois = pd.DataFrame(iter_poi_rows(data_dir / "sh_poi_raw"))
    pois = add_poi_classification_columns(pois)
    if houses["street"].isna().any():
        houses = assign_streets(houses, street_shapes)
    pois = assign_streets(pois, street_shapes)
    metrics, category_counts = build_metrics(houses, pois)
    street_metrics = build_street_metrics(houses, pois)
    house_features = compute_house_features(houses, pois)
    demand_points = build_demand_points(houses, pois)
    phase4_house_features = compute_e2sfca_house_features(house_features, demand_points, pois)
    life_circle_house_features = compute_life_circle_house_features(houses, pois)
    derived_dir = data_dir / "derived"
    derived_dir.mkdir(parents=True, exist_ok=True)
    house_features.to_parquet(derived_dir / "house_features_current.parquet", index=False)
    demand_points.to_parquet(derived_dir / "demand_points_current.parquet", index=False)
    phase4_house_features.to_parquet(derived_dir / "house_features_phase4_current.parquet", index=False)
    life_circle_house_features.to_parquet(derived_dir / "house_life_circle_features_current.parquet", index=False)
    build_poi_subtype_audit(pois).to_csv(derived_dir / "poi_subtype_audit.csv", index=False)
    metrics = attach_phase2_scores(metrics, house_features, ["district"])
    street_metrics = attach_phase2_scores(street_metrics, house_features, ["district", "street"])
    metrics = attach_phase4_scores(metrics, phase4_house_features, ["district"], reliability_house_threshold=50)
    street_metrics = attach_phase4_scores(
        street_metrics,
        phase4_house_features,
        ["district", "street"],
        reliability_house_threshold=10,
    )
    metrics = attach_life_circle_scores(metrics, life_circle_house_features, ["district"])
    street_metrics = attach_life_circle_scores(street_metrics, life_circle_house_features, ["district", "street"])
    street_metrics[
        [
            "district",
            "street",
            "house_count",
            "calibrated_score",
            "calibrated_score_life_circle",
            "life_circle_score",
            "life_circle_5min_score",
            "life_circle_10min_score",
            "life_circle_15min_score",
        ]
    ].to_csv(derived_dir / "life_circle_street_comparison.csv", index=False)

    with SessionLocal.begin() as db:
        for table in [HouseListing, PoiPoint, DistrictMetric, StreetMetric, PoiCategoryMetric]:
            db.execute(delete(table))
        db.bulk_insert_mappings(HouseListing, records_for_insert(houses))
        db.bulk_insert_mappings(PoiPoint, records_for_insert(pois))
        db.bulk_insert_mappings(DistrictMetric, records_for_insert(metrics))
        if not street_metrics.empty:
            db.bulk_insert_mappings(StreetMetric, records_for_insert(street_metrics))
        db.bulk_insert_mappings(PoiCategoryMetric, records_for_insert(category_counts))

    print(
        f"ingested houses={len(houses)} pois={len(pois)} "
        f"districts={len(metrics)} streets={len(street_metrics)} "
        f"house_path={resolved_house_path}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(DATA_DIR))
    parser.add_argument("--house-path", default=None, help="Optional parquet path for a standard house table.")
    args = parser.parse_args()
    ingest(Path(args.data_dir), Path(args.house_path) if args.house_path else None)


if __name__ == "__main__":
    main()
