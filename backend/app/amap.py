from __future__ import annotations

import json
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import HTTPException

from .config import AMAP_WEB_SERVICE_KEY
from .geo import normalize_district

AMAP_DISTRICT_URL = "https://restapi.amap.com/v3/config/district"


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


@lru_cache(maxsize=1)
def fetch_shanghai_district_boundaries() -> list[dict]:
    if not AMAP_WEB_SERVICE_KEY:
        raise HTTPException(status_code=500, detail="AMAP_WEB_SERVICE_KEY is not configured")

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
