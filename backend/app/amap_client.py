from __future__ import annotations

import json
from dataclasses import dataclass
from math import asin, cos, radians, sin, sqrt
from typing import Any, Literal
from urllib.parse import urlencode
from urllib.request import urlopen

from .config import AMAP_WEB_SERVICE_KEY

GeocodeLocation = tuple[float, float]
CommuteMode = Literal["transit", "driving"]

GEOCODE_URL = "https://restapi.amap.com/v3/geocode/geo"
DRIVING_URL = "https://restapi.amap.com/v5/direction/driving"
TRANSIT_URL = "https://restapi.amap.com/v5/direction/transit/integrated"

_GEOCODE_CACHE: dict[str, GeocodeLocation | None] = {}
_ROUTE_CACHE: dict[tuple[str, str, CommuteMode], float | None] = {}


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


def _extract_duration_seconds(route_item: dict[str, Any]) -> float | None:
    # v5 often returns duration under item.cost.duration
    cost = route_item.get("cost")
    if isinstance(cost, dict):
        duration = cost.get("duration")
        try:
            if duration is not None:
                return float(duration)
        except (TypeError, ValueError):
            pass

    # backward-compatible fallback for payloads exposing top-level duration
    duration = route_item.get("duration")
    try:
        if duration is not None:
            return float(duration)
    except (TypeError, ValueError):
        return None
    return None


def geocode_address(address: str, city: str = "上海") -> GeocodeLocation | None:
    cache_key = f"{city}|{address}".strip()
    cached = _GEOCODE_CACHE.get(cache_key)
    if cached is not None:
        return cached

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
    location = _parse_location(str(geocodes[0].get("location", "")))
    if location is not None:
        _GEOCODE_CACHE[cache_key] = location
    return location


def _haversine_km(origin: GeocodeLocation, destination: GeocodeLocation) -> float:
    lon1, lat1 = origin
    lon2, lat2 = destination
    r = 6371.0
    dlon = radians(lon2 - lon1)
    dlat = radians(lat2 - lat1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def estimate_commute_minutes(origin: GeocodeLocation, destination: GeocodeLocation, mode: CommuteMode) -> float:
    distance_km = max(0.0, _haversine_km(origin, destination))
    if mode == "driving":
        speed_kmh = 28.0
        overhead_min = 6.0
    else:
        speed_kmh = 18.0
        overhead_min = 12.0
    estimate = distance_km / speed_kmh * 60.0 + overhead_min
    return max(5.0, round(estimate, 1))


def get_commute_minutes(origin: GeocodeLocation, destination: GeocodeLocation, mode: CommuteMode) -> float | None:
    origin_str = f"{origin[0]},{origin[1]}"
    destination_str = f"{destination[0]},{destination[1]}"
    cache_key = (origin_str, destination_str, mode)
    if cache_key in _ROUTE_CACHE:
        return _ROUTE_CACHE[cache_key]

    if mode == "driving":
        result = _request_json(
            DRIVING_URL,
            {
                "origin": origin_str,
                "destination": destination_str,
                "show_fields": "cost",
            },
        )
        if not result.ok or not result.data:
            return None

        route = result.data.get("route") or {}
        paths = route.get("paths") or []
        if not paths:
            return None
        duration_seconds = _extract_duration_seconds(paths[0])
        if duration_seconds is None:
            return None
        value = duration_seconds / 60.0
        _ROUTE_CACHE[cache_key] = value
        return value

    result = _request_json(
        TRANSIT_URL,
        {
            "origin": origin_str,
            "destination": destination_str,
            "city1": "021",
            "city2": "021",
            "show_fields": "cost",
        },
    )
    if not result.ok or not result.data:
        return None

    route = result.data.get("route") or {}
    transits = route.get("transits") or []
    if not transits:
        return None
    duration_seconds = _extract_duration_seconds(transits[0])
    if duration_seconds is None:
        return None
    value = duration_seconds / 60.0
    _ROUTE_CACHE[cache_key] = value
    return value
