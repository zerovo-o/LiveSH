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
from .models import DistrictMetric, HouseListing, PoiCategoryMetric, PoiPoint

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


def minmax(series: pd.Series) -> pd.Series:
    if series.empty:
        return series
    lo = float(series.min())
    hi = float(series.max())
    if hi == lo:
        return pd.Series([0.5] * len(series), index=series.index)
    return (series - lo) / (hi - lo)


def load_house_rows(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    cols = ["house_id", "district", "listing_total_price", "listing_unit_price", "longitude", "latitude"]
    df = df[cols].rename(
        columns={
            "listing_total_price": "price",
            "listing_unit_price": "unit_price",
            "longitude": "wgs84_lng",
            "latitude": "wgs84_lat",
        }
    )
    df = df.dropna(subset=["district", "price", "unit_price", "wgs84_lng", "wgs84_lat"])
    df = df.drop_duplicates(subset=["house_id"])
    df["district"] = df["district"].map(normalize_district)
    df = df[(df["wgs84_lng"].between(120.5, 122.2)) & (df["wgs84_lat"].between(30.5, 31.9))]
    gcj = df.apply(lambda r: wgs84_to_gcj02(float(r["wgs84_lng"]), float(r["wgs84_lat"])), axis=1)
    df["gcj02_lng"] = [item[0] for item in gcj]
    df["gcj02_lat"] = [item[1] for item in gcj]
    return df


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
    if pois.empty:
        # Keep downstream logic stable when optional POI raw data is missing.
        pois = pd.DataFrame(columns=["district", "category", "name"])
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
    category_counts = pd.DataFrame(
        [{"category": category, "count": count} for category, count in Counter(pois["category"]).items()]
    )
    return metrics, category_counts


def ingest(data_dir: Path = DATA_DIR) -> None:
    Base.metadata.create_all(bind=engine)
    houses = load_house_rows(data_dir / "sh_house_dataset_raw.parquet")
    pois = pd.DataFrame(iter_poi_rows(data_dir / "sh_poi_raw"))
    metrics, category_counts = build_metrics(houses, pois)

    with SessionLocal.begin() as db:
        for table in [HouseListing, PoiPoint, DistrictMetric, PoiCategoryMetric]:
            db.execute(delete(table))
        db.bulk_insert_mappings(HouseListing, houses.to_dict(orient="records"))
        db.bulk_insert_mappings(PoiPoint, pois.to_dict(orient="records"))
        db.bulk_insert_mappings(DistrictMetric, metrics.to_dict(orient="records"))
        db.bulk_insert_mappings(PoiCategoryMetric, category_counts.to_dict(orient="records"))

    print(f"ingested houses={len(houses)} pois={len(pois)} districts={len(metrics)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(DATA_DIR))
    args = parser.parse_args()
    ingest(Path(args.data_dir))


if __name__ == "__main__":
    main()
