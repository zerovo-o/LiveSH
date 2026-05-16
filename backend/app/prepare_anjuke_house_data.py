from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd

from .config import ROOT_DIR
from .geo import normalize_district
from .process_data import assign_streets, load_street_shapes


DEFAULT_DATASET_PATH = ROOT_DIR / "datanew" / "anjuke17w" / "dataset.csv"
DEFAULT_CACHE_PATH = ROOT_DIR / "datanew" / ".cache" / "house_geocode_cache.json"
DEFAULT_STREET_BOUNDARY_PATH = ROOT_DIR / "data" / "sh_street_boundary" / "shanghai_street_boundary.shp"
DEFAULT_OUTPUT_PATH = ROOT_DIR / "data" / "derived" / "sh_house_dataset_anjuke_geocoded.parquet"


def geocode_key(row: pd.Series) -> str:
    return f"{row['区']}-{row['街道']}-{row['小区']}"


def fallback_house_id(index: int, row: pd.Series) -> str:
    text = f"anjuke::{index}::{row['区']}::{row['街道']}::{row['小区']}::{row['标题']}::{row['价格']}::{row['总面积']}"
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:24]


def parse_cache_value(value: object) -> tuple[float | None, float | None, float | None, float | None]:
    if isinstance(value, list) and len(value) >= 4:
        try:
            gcj_lng, gcj_lat, wgs_lng, wgs_lat = [float(item) for item in value[:4]]
        except (TypeError, ValueError):
            return None, None, None, None
        return gcj_lng, gcj_lat, wgs_lng, wgs_lat
    return None, None, None, None


def build_standard_table(dataset_path: Path, cache_path: Path, street_boundary_path: Path) -> pd.DataFrame:
    source = pd.read_csv(dataset_path)
    with cache_path.open("r", encoding="utf-8") as file:
        cache = json.load(file)

    keys = source.apply(geocode_key, axis=1)
    coords = keys.map(lambda key: parse_cache_value(cache.get(key)))
    coord_frame = pd.DataFrame(coords.to_list(), columns=["gcj02_lng", "gcj02_lat", "wgs84_lng", "wgs84_lat"])

    price = pd.to_numeric(source["价格"], errors="coerce")
    area = pd.to_numeric(source["总面积"], errors="coerce")
    unit_price = price * 10000 / area.where(area > 0)
    district_source = source["区"].astype(str).str.strip()

    houses = pd.DataFrame(
        {
            "house_id": [fallback_house_id(index, row) for index, row in source.iterrows()],
            "source": "anjuke17w",
            "title": source["标题"].astype(str),
            "district_source": district_source,
            "district": district_source.map(normalize_district),
            "street_source": source["街道"].astype(str),
            "street": None,
            "community_name": source["小区"].astype(str),
            "geocode_key": keys.astype(str),
            "price": price,
            "unit_price": unit_price,
            "area": area,
            "room_count": pd.to_numeric(source["居室数"], errors="coerce"),
            "hall_count": pd.to_numeric(source["厅堂数"], errors="coerce"),
            "toilet_count": pd.to_numeric(source["卫生间数"], errors="coerce"),
            "year_built": pd.to_numeric(source["建造年份"], errors="coerce"),
            "total_floors": pd.to_numeric(source["居民楼总层数"], errors="coerce"),
            "community_households": pd.to_numeric(source["小区户数"], errors="coerce"),
            "property_fee": pd.to_numeric(source["物业费用"], errors="coerce"),
            "greening_rate": pd.to_numeric(source["小区绿化率"], errors="coerce"),
            "community_avg_price": pd.to_numeric(source["小区均价"], errors="coerce"),
            "renovation": source["装修"].astype(str),
            "floor_location": source["楼层分布"].astype(str),
            "property_type": source["物业类型"].astype(str),
            "property_right": source["产权性质"].astype(str),
            "property_years": source["产权年限"].astype(str),
            "certificate_age": source["房本年限"].astype(str),
            "faces_south": source["南"].astype(bool),
            "faces_north_south": source["南北"].astype(bool),
            "near_subway_text_flag": source["近地铁"].astype(bool),
            "parking_text_flag": source["车位充足"].astype(bool),
            "square_layout_text_flag": source["户型方正"].astype(bool),
            "many_followers_text_flag": source["多人关注"].astype(bool),
            "has_elevator_text_flag": source["有电梯"].astype(bool),
        }
    )
    houses = pd.concat([houses, coord_frame], axis=1)
    houses["has_geocode"] = houses[["wgs84_lng", "wgs84_lat", "gcj02_lng", "gcj02_lat"]].notna().all(axis=1)
    houses["in_shanghai_bbox"] = houses["wgs84_lng"].between(120.5, 122.2) & houses["wgs84_lat"].between(30.5, 31.9)
    houses["is_shanghai_scope"] = houses["district_source"] != "上海周边"
    houses["is_valid_for_algorithm"] = (
        houses["is_shanghai_scope"]
        & houses["has_geocode"]
        & houses["in_shanghai_bbox"]
        & houses["price"].gt(0)
        & houses["unit_price"].gt(0)
    )

    valid = houses[houses["is_valid_for_algorithm"]].copy()
    street_shapes = load_street_shapes(street_boundary_path)
    assigned = assign_streets(valid, street_shapes)
    houses["official_street_assigned"] = False
    houses["district_matches_source"] = False
    houses.loc[valid.index, "district"] = assigned["district"].values
    houses.loc[valid.index, "street"] = assigned["street"].values
    houses.loc[valid.index, "official_street_assigned"] = assigned["street"].notna().values
    source_district = houses.loc[valid.index, "district_source"].map(normalize_district)
    houses.loc[valid.index, "district_matches_source"] = assigned["district"].values == source_district.values
    houses["is_valid_for_algorithm"] = houses["is_valid_for_algorithm"] & houses["official_street_assigned"] & houses["district_matches_source"]
    houses["is_valid_for_street_algorithm"] = houses["is_valid_for_algorithm"] & houses["official_street_assigned"]
    return houses


def write_reports(houses: pd.DataFrame, output_path: Path) -> None:
    report_path = output_path.with_name(f"{output_path.stem}_report.csv")
    missing_path = output_path.with_name("sh_house_dataset_anjuke_missing_geocode_top.csv")

    report = pd.DataFrame(
        [
            {"metric": "output_rows", "value": float(len(houses))},
            {"metric": "unique_house_id", "value": float(houses["house_id"].nunique())},
            {"metric": "duplicate_house_id", "value": float(houses["house_id"].duplicated().sum())},
            {"metric": "shanghai_scope_rows", "value": float(houses["is_shanghai_scope"].sum())},
            {"metric": "non_shanghai_rows", "value": float((~houses["is_shanghai_scope"]).sum())},
            {"metric": "geocoded_rows_shanghai_scope", "value": float((houses["is_shanghai_scope"] & houses["has_geocode"]).sum())},
            {"metric": "valid_algorithm_rows", "value": float(houses["is_valid_for_algorithm"].sum())},
            {"metric": "missing_geocode_rows_shanghai_scope", "value": float((houses["is_shanghai_scope"] & ~houses["has_geocode"]).sum())},
            {"metric": "official_street_assigned_rows", "value": float(houses["official_street_assigned"].sum())},
            {"metric": "district_matches_source_rows", "value": float(houses["district_matches_source"].sum())},
            {"metric": "district_mismatch_rows", "value": float((houses["official_street_assigned"] & ~houses["district_matches_source"]).sum())},
            {"metric": "valid_street_algorithm_rows", "value": float(houses["is_valid_for_street_algorithm"].sum())},
            {"metric": "unit_price_min", "value": float(houses["unit_price"].min())},
            {"metric": "unit_price_median", "value": float(houses["unit_price"].median())},
            {"metric": "unit_price_max", "value": float(houses["unit_price"].max())},
        ]
    )
    report.to_csv(report_path, index=False)

    missing = (
        houses.loc[houses["is_shanghai_scope"] & ~houses["has_geocode"], ["geocode_key", "district", "street_source", "community_name"]]
        .value_counts(["geocode_key", "district", "street_source", "community_name"])
        .reset_index(name="row_count")
        .sort_values("row_count", ascending=False)
    )
    missing.to_csv(missing_path, index=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-path", default=str(DEFAULT_DATASET_PATH))
    parser.add_argument("--cache-path", default=str(DEFAULT_CACHE_PATH))
    parser.add_argument("--street-boundary-path", default=str(DEFAULT_STREET_BOUNDARY_PATH))
    parser.add_argument("--output-path", default=str(DEFAULT_OUTPUT_PATH))
    args = parser.parse_args()

    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    houses = build_standard_table(Path(args.dataset_path), Path(args.cache_path), Path(args.street_boundary_path))
    houses.to_parquet(output_path, index=False)
    write_reports(houses, output_path)
    print(
        f"wrote {output_path} rows={len(houses)} "
        f"valid={int(houses['is_valid_for_algorithm'].sum())} "
        f"street_valid={int(houses['is_valid_for_street_algorithm'].sum())}"
    )


if __name__ == "__main__":
    main()
