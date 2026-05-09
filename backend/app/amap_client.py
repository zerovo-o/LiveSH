from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlencode
from urllib.request import urlopen

from .config import AMAP_WEB_SERVICE_KEY

GeocodeLocation = tuple[float, float]
CommuteMode = Literal["transit", "driving"]

GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"
DRIVING_URL = "https://restapi.amap.com/v5/direction/driving"
TRANSIT_URL = "https://restapi.amap.com/v5/direction/transit/integrated"


@dataclass
class AmapResult:
    ok: bool
    data: dict[str, Any] | None
    error: str | None = None


def _build_query_url(base_url: str, params: dict[str, Any]) -> str:
    return f"{base_url}?{urlencode(params)}"


def _request_json(base_url: str, params: dict[str, Any], timeout: int = 10) -> AmapResult:
    if not AMAP_WEB_SERVICE_KEY:
        return AmapResult(ok=False, data=None, error="AMAP_WEB_SERVICE_KEY is not configured")

    merged_params = {**params, "key": AMAP_WEB_SERVICE_KEY, "output": "JSON"}
    url = _build_query_url(base_url, merged_params)
    try:
        with urlopen(url, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return AmapResult(ok=False, data=None, error=f"AMap request failed: {exc}")

    status = str(payload.get("status", ""))
    if status != "1":
        info = payload.get("info") or payload.get("infocode") or "AMap API returned non-success status"
        return AmapResult(ok=False, data=payload, error=str(info))
    return AmapResult(ok=True, data=payload, error=None)


def _parse_location(value: str) -> GeocodeLocation | None:
    parts = (value or "").split(",")
    if len(parts) != 2:
        return None
    try:
        lng = float(parts[0])
        lat = float(parts[1])
    except ValueError:
        return None
    return lng, lat


def geocode_address(address: str, city: str = "上海") -> GeocodeLocation | None:
    result = _request_json(
        GEOCODE_URL,
        {
            "address": address,
            "city": city,
        },
    )
    if not result.ok or not result.data:
        return None

    geocodes = result.data.get("geocodes") or []
    if not geocodes:
        return None
    return _parse_location(str(geocodes[0].get("location", "")))


def get_commute_minutes(origin: GeocodeLocation, destination: GeocodeLocation, mode: CommuteMode) -> float | None:
    origin_str = f"{origin[0]},{origin[1]}"
    destination_str = f"{destination[0]},{destination[1]}"
    if mode == "driving":
        result = _request_json(
            DRIVING_URL,
            {
                "origin": origin_str,
                "destination": destination_str,
            },
        )
        if not result.ok or not result.data:
            return None

        route = result.data.get("route") or {}
        paths = route.get("paths") or []
        if not paths:
            return None
        try:
            duration_seconds = float(paths[0].get("duration"))
        except (TypeError, ValueError):
            return None
        return duration_seconds / 60.0

    result = _request_json(
        TRANSIT_URL,
        {
            "origin": origin_str,
            "destination": destination_str,
            "city1": "021",
            "city2": "021",
        },
    )
    if not result.ok or not result.data:
        return None

    route = result.data.get("route") or {}
    transits = route.get("transits") or []
    if not transits:
        return None
    try:
        duration_seconds = float(transits[0].get("duration"))
    except (TypeError, ValueError):
        return None
    return duration_seconds / 60.0

