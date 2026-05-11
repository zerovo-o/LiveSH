from __future__ import annotations


import pandas as pd
import shapefile

from .config import DATA_DIR
from .geo import normalize_district
from .process_data import iter_poi_rows
from .amap import geocode_shanghai_community_wgs84


BOUNDARY_PATH = DATA_DIR / "sh_street_boundary" / "shanghai_street_boundary.shp"


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


def load_street_shapes() -> list[dict]:
    reader = shapefile.Reader(str(BOUNDARY_PATH), encoding="utf-8")
    streets: list[dict] = []
    for shape_record in reader.iterShapeRecords():
        record = shape_record.record.as_dict()
        street = str(record.get("STREET") or "").strip()
        district = normalize_district(record.get("AREA"))
        if not street:
            continue
        streets.append({"district": district, "street": street, "shape": shape_record.shape})
    return streets


def locate_street(lng: float, lat: float, streets: list[dict]) -> tuple[str, str] | None:
    for item in streets:
        if point_in_shape(lng, lat, item["shape"]):
            return item["district"], item["street"]
    return None


def validate_houses(streets: list[dict], limit: int = 300) -> None:
    csv_path = DATA_DIR / "anjuke17w" / "dataset.csv"
    if not csv_path.exists():
        raise SystemExit(f"house dataset CSV not found: {csv_path}")

    df = pd.read_csv(csv_path, encoding="utf-8-sig", usecols=["区", "街道", "小区"]).rename(
        columns={"区": "district", "街道": "street", "小区": "community"}
    )
    df["district"] = df["district"].map(normalize_district)
    df["street"] = df["street"].map(lambda v: str(v or "").strip())
    df["community"] = df["community"].map(lambda v: str(v or "").strip())
    df = df.dropna(subset=["district", "community"]).reset_index(drop=True)

    matched = 0
    samples: list[tuple[str, str, str]] = []
    total = min(limit, len(df))
    for row in df.head(limit).itertuples(index=False):
        try:
            geocoded = geocode_shanghai_community_wgs84(row.district, row.street, row.community)
        except RuntimeError as exc:
            raise SystemExit(str(exc))
        if not geocoded:
            continue
        gcj_lng, gcj_lat, wgs_lng, wgs_lat = geocoded
        result = locate_street(float(gcj_lng), float(gcj_lat), streets)
        if result:
            matched += 1
            if len(samples) < 8:
                samples.append((row.district, result[0], result[1]))
    print(f"houses matched={matched}/{total}")
    for source_district, district, street in samples:
        print(f"  house district={source_district} -> {district} / {street}")


def validate_pois(streets: list[dict], limit: int = 300) -> None:
    matched = 0
    samples: list[tuple[str, str, str, str]] = []
    for index, row in enumerate(iter_poi_rows(DATA_DIR / "sh_poi_raw")):
        if index >= limit:
            break
        result = locate_street(float(row["wgs84_lng"] or row["gcj02_lng"]), float(row["wgs84_lat"] or row["gcj02_lat"]), streets)
        if result:
            matched += 1
            if len(samples) < 8:
                samples.append((row["category"], row["district"], result[0], result[1]))
    print(f"pois matched={matched}/{limit}")
    for category, source_district, district, street in samples:
        print(f"  poi category={category} area={source_district} -> {district} / {street}")


def main() -> None:
    if not BOUNDARY_PATH.exists():
        raise SystemExit(f"street boundary not found: {BOUNDARY_PATH}")
    streets = load_street_shapes()
    print(f"loaded street boundaries={len(streets)} from {BOUNDARY_PATH}")
    validate_houses(streets)
    validate_pois(streets)


if __name__ == "__main__":
    main()
