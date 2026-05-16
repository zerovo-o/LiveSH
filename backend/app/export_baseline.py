from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import shapefile

from .config import DATA_DIR
from .database import engine
from .geo import normalize_district

STREET_BOUNDARY_PATH = DATA_DIR / "sh_street_boundary" / "shanghai_street_boundary.shp"


def _read_table(table: str) -> pd.DataFrame:
    return pd.read_sql_query(f"select * from {table}", engine)


def _read_grouped_counts(table: str) -> pd.DataFrame:
    return pd.read_sql_query(
        f"""
        select district, street, count(*) as {table}_count
        from {table}
        where street is not null and street != ''
        group by district, street
        """,
        engine,
    )


def _load_official_streets(path: Path = STREET_BOUNDARY_PATH) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["district", "street", "is_official_boundary"])

    reader = shapefile.Reader(str(path), encoding="utf-8")
    rows = []
    for shape_record in reader.iterShapeRecords():
        record = shape_record.record.as_dict()
        street = str(record.get("STREET") or "").strip()
        district = normalize_district(record.get("AREA"))
        if not street:
            continue
        rows.append({"district": district, "street": street, "is_official_boundary": True})
    return pd.DataFrame(rows).drop_duplicates(subset=["district", "street"])


def _status(row: pd.Series) -> str:
    has_house = bool(row["has_house"])
    has_poi = bool(row["has_poi"])
    has_metric = bool(row["has_metric"])
    if not row["is_official_boundary"]:
        return "非官方边界中的数据行"
    if not has_metric and has_poi and not has_house:
        return "有POI但无房源，未进入street_metrics"
    if not has_metric and has_house and not has_poi:
        return "有房源但无POI，未进入street_metrics"
    if not has_metric and not has_house and not has_poi:
        return "边界存在但房源和POI都缺"
    if has_house and not has_poi:
        return "有房源但无POI"
    if has_poi and not has_house:
        return "有POI但无房源"
    return "有房源且有POI"


def build_missing_report(street_metrics: pd.DataFrame) -> pd.DataFrame:
    official = _load_official_streets()
    metric_pairs = street_metrics[["district", "street"]].drop_duplicates()
    metric_pairs["has_metric"] = True
    house_counts = _read_grouped_counts("house_listings").rename(columns={"house_listings_count": "house_count_raw"})
    poi_counts = _read_grouped_counts("poi_points").rename(columns={"poi_points_count": "poi_count_raw"})

    all_pairs = pd.concat(
        [
            official[["district", "street"]],
            metric_pairs[["district", "street"]],
            house_counts[["district", "street"]],
            poi_counts[["district", "street"]],
        ],
        ignore_index=True,
    ).drop_duplicates(subset=["district", "street"])

    report = (
        all_pairs.merge(official, on=["district", "street"], how="left")
        .merge(metric_pairs, on=["district", "street"], how="left")
        .merge(street_metrics[["district", "street", "house_count", "poi_total", "livability_score"]], on=["district", "street"], how="left")
        .merge(house_counts, on=["district", "street"], how="left")
        .merge(poi_counts, on=["district", "street"], how="left")
    )
    report["is_official_boundary"] = report["is_official_boundary"].fillna(False).astype(bool)
    report["has_metric"] = report["has_metric"].fillna(False).astype(bool)
    report["house_count"] = report["house_count"].fillna(0).astype(int)
    report["poi_total"] = report["poi_total"].fillna(0).astype(int)
    report["house_count_raw"] = report["house_count_raw"].fillna(0).astype(int)
    report["poi_count_raw"] = report["poi_count_raw"].fillna(0).astype(int)
    report["has_house"] = report["house_count_raw"] > 0
    report["has_poi"] = report["poi_count_raw"] > 0
    report["status"] = report.apply(_status, axis=1)
    columns = [
        "district",
        "street",
        "is_official_boundary",
        "has_metric",
        "has_house",
        "has_poi",
        "house_count",
        "poi_total",
        "house_count_raw",
        "poi_count_raw",
        "livability_score",
        "status",
    ]
    return report[columns].sort_values(["district", "street"]).reset_index(drop=True)


def export_baseline(output_dir: Path = DATA_DIR / "derived") -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    district_metrics = _read_table("district_metrics").sort_values("livability_score", ascending=False)
    street_metrics = _read_table("street_metrics").sort_values("livability_score", ascending=False)
    missing_report = build_missing_report(street_metrics)

    district_metrics.to_csv(output_dir / "baseline_district_metrics.csv", index=False)
    street_metrics.to_csv(output_dir / "baseline_street_metrics.csv", index=False)
    missing_report.to_csv(output_dir / "baseline_street_missing_report.csv", index=False)

    print(f"exported baseline CSVs to {output_dir}")
    print("\nDistrict Top10:")
    print(district_metrics[["district", "house_count", "poi_total", "livability_score"]].head(10).to_string(index=False))
    print("\nStreet Top10:")
    print(street_metrics[["district", "street", "house_count", "poi_total", "livability_score"]].head(10).to_string(index=False))
    print("\nStreet boundary coverage:")
    print(missing_report["status"].value_counts().to_string())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=str(DATA_DIR / "derived"))
    args = parser.parse_args()
    export_baseline(Path(args.output_dir))


if __name__ == "__main__":
    main()
