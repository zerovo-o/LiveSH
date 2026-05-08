from __future__ import annotations

import json
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import urlopen

import shapefile
from fastapi import HTTPException

from .config import DATA_DIR
from .config import AMAP_WEB_SERVICE_KEY
from .geo import normalize_district, wgs84_to_gcj02

AMAP_DISTRICT_URL = "https://restapi.amap.com/v3/config/district"
LOCAL_STREET_BOUNDARY_PATH = DATA_DIR / "sh_street_boundary" / "shanghai_street_boundary.shp"


def _parse_boundary(polyline: str) -> list[list[list[float]]]:
    rings: list[list[list[float]]] = []
    for ring_text in polyline.split("|"):
        ring: list[list[float]] = []
        for pair in ring_text.split(";"):
            if not pair:
                continue
            lng_text, lat_text = pair.split(",", 1)
            ring.append([float(lng_text), float(lat_text)])
        if ring:
            rings.append(ring)
    return rings


def _shape_to_gcj02_boundaries(shape: shapefile.Shape) -> list[list[list[float]]]:
    boundaries: list[list[list[float]]] = []
    points = shape.points
    parts = list(shape.parts) + [len(points)]
    for start, end in zip(parts, parts[1:]):
        ring: list[list[float]] = []
        for lng, lat in points[start:end]:
            gcj_lng, gcj_lat = wgs84_to_gcj02(float(lng), float(lat))
            ring.append([gcj_lng, gcj_lat])
        if len(ring) >= 3:
            boundaries.append(ring)
    return boundaries


@lru_cache(maxsize=1)
def fetch_local_shanghai_district_boundaries() -> list[dict]:
    if not LOCAL_STREET_BOUNDARY_PATH.exists():
        raise HTTPException(status_code=500, detail="Local Shanghai street boundary file is not configured")

    reader = shapefile.Reader(str(LOCAL_STREET_BOUNDARY_PATH), encoding="utf-8")
    grouped: dict[str, list[list[list[float]]]] = {}
    bboxes: dict[str, list[float]] = {}
    for shape_record in reader.iterShapeRecords():
        record = shape_record.record.as_dict()
        district = normalize_district(record.get("AREA"))
        boundaries = _shape_to_gcj02_boundaries(shape_record.shape)
        if not district or not boundaries:
            continue
        grouped.setdefault(district, []).extend(boundaries)

        xmin, ymin, xmax, ymax = [float(value) for value in shape_record.shape.bbox]
        gcj_min_lng, gcj_min_lat = wgs84_to_gcj02(xmin, ymin)
        gcj_max_lng, gcj_max_lat = wgs84_to_gcj02(xmax, ymax)
        if district not in bboxes:
            bboxes[district] = [gcj_min_lng, gcj_min_lat, gcj_max_lng, gcj_max_lat]
        else:
            box = bboxes[district]
            box[0] = min(box[0], gcj_min_lng)
            box[1] = min(box[1], gcj_min_lat)
            box[2] = max(box[2], gcj_max_lng)
            box[3] = max(box[3], gcj_max_lat)

    result: list[dict] = []
    for district, boundaries in sorted(grouped.items()):
        xmin, ymin, xmax, ymax = bboxes[district]
        result.append(
            {
                "name": district,
                "adcode": None,
                "center": [(xmin + xmax) / 2, (ymin + ymax) / 2],
                "boundaries": boundaries,
            }
        )
    if not result:
        raise HTTPException(status_code=500, detail="No local Shanghai district boundaries found")
    return result


@lru_cache(maxsize=1)
def fetch_local_shanghai_street_boundaries() -> list[dict]:
    if not LOCAL_STREET_BOUNDARY_PATH.exists():
        raise HTTPException(status_code=500, detail="Local Shanghai street boundary file is not configured")

    reader = shapefile.Reader(str(LOCAL_STREET_BOUNDARY_PATH), encoding="utf-8")
    result: list[dict] = []
    for shape_record in reader.iterShapeRecords():
        record = shape_record.record.as_dict()
        street = str(record.get("STREET") or "").strip()
        district = normalize_district(record.get("AREA"))
        boundaries = _shape_to_gcj02_boundaries(shape_record.shape)
        if not street or not district or not boundaries:
            continue

        xmin, ymin, xmax, ymax = [float(value) for value in shape_record.shape.bbox]
        gcj_min_lng, gcj_min_lat = wgs84_to_gcj02(xmin, ymin)
        gcj_max_lng, gcj_max_lat = wgs84_to_gcj02(xmax, ymax)
        result.append(
            {
                "name": street,
                "district": district,
                "center": [(gcj_min_lng + gcj_max_lng) / 2, (gcj_min_lat + gcj_max_lat) / 2],
                "boundaries": boundaries,
            }
        )
    if not result:
        raise HTTPException(status_code=500, detail="No local Shanghai street boundaries found")
    return result


@lru_cache(maxsize=1)
def fetch_shanghai_district_boundaries() -> list[dict]:
    if not AMAP_WEB_SERVICE_KEY:
        return fetch_local_shanghai_district_boundaries()

    query = urlencode(
        {
            "key": AMAP_WEB_SERVICE_KEY,
            "keywords": "上海市",
            "subdistrict": 1,
            "extensions": "all",
        }
    )
    with urlopen(f"{AMAP_DISTRICT_URL}?{query}", timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if payload.get("status") != "1":
        message = payload.get("info") or payload.get("infocode") or "AMap district request failed"
        raise HTTPException(status_code=502, detail=message)

    districts = payload.get("districts") or []
    children = districts[0].get("districts") if districts else []
    if not children:
        raise HTTPException(status_code=502, detail="No Shanghai district boundaries returned from AMap")

    result: list[dict] = []
    for item in children:
        polyline = item.get("polyline") or ""
        boundaries = _parse_boundary(polyline) if polyline else []
        if not boundaries:
            continue
        result.append(
            {
                "name": normalize_district(item.get("name")),
                "adcode": item.get("adcode"),
                "center": [float(x) for x in str(item.get("center", "")).split(",")] if item.get("center") else None,
                "boundaries": boundaries,
            }
        )
    return result
