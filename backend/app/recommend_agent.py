from __future__ import annotations

import json
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_schemas import AgentRecommendRequest, AgentRecommendResponse, DistrictRecommendation
from .amap import fetch_shanghai_district_boundaries
from .amap_client import geocode_address, get_commute_minutes
from .config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
from .models import DistrictMetric

SHANGHAI_DISTRICT_FALLBACK_CENTER: dict[str, tuple[float, float]] = {
    "黄浦": (121.4903, 31.2228),
    "徐汇": (121.4368, 31.1889),
    "长宁": (121.4247, 31.2204),
    "静安": (121.4471, 31.2279),
    "普陀": (121.3955, 31.2497),
    "虹口": (121.5051, 31.2647),
    "杨浦": (121.5254, 31.2708),
    "浦东": (121.5447, 31.2222),
    "闵行": (121.3817, 31.1128),
    "宝山": (121.4896, 31.4055),
    "嘉定": (121.2655, 31.3748),
    "金山": (121.3416, 30.7410),
    "松江": (121.2277, 31.0322),
    "青浦": (121.1242, 31.1496),
    "奉贤": (121.4740, 30.9178),
    "崇明": (121.3974, 31.6269),
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _normalize_district_key(district: str) -> str:
    text = (district or "").strip().replace("上海市", "")
    if text.endswith("新区"):
        text = text[:-2]
    if text.endswith("区") or text.endswith("县"):
        text = text[:-1]
    if text == "浦东新":
        text = "浦东"
    return text


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_getattr(obj: object, attr_names: list[str]) -> float | None:
    for name in attr_names:
        if hasattr(obj, name):
            value = _as_float(getattr(obj, name))
            if value is not None:
                return value
    return None


def _load_boundary_centers() -> dict[str, tuple[float, float]]:
    centers: dict[str, tuple[float, float]] = {}
    try:
        districts = fetch_shanghai_district_boundaries()
    except Exception:
        return centers

    for item in districts:
        center = item.get("center")
        if not center or len(center) != 2:
            continue
        try:
            lng = float(center[0])
            lat = float(center[1])
        except (TypeError, ValueError):
            continue
        centers[_normalize_district_key(str(item.get("name") or ""))] = (lng, lat)
    return centers


def _get_district_origin(metric: DistrictMetric, boundary_centers: dict[str, tuple[float, float]]) -> tuple[float, float] | None:
    lng = _safe_getattr(metric, ["center_lng", "longitude", "centroid_lng", "lng"])
    lat = _safe_getattr(metric, ["center_lat", "latitude", "centroid_lat", "lat"])
    if lng is not None and lat is not None:
        return (lng, lat)

    key = _normalize_district_key(metric.district)
    if key in boundary_centers:
        return boundary_centers[key]
    if key in SHANGHAI_DISTRICT_FALLBACK_CENTER:
        return SHANGHAI_DISTRICT_FALLBACK_CENTER[key]
    return None


def _build_budget_score(avg_price: float | None, affordable_unit_price: float) -> float:
    if avg_price is None or affordable_unit_price <= 0:
        return 0.0
    ratio = avg_price / affordable_unit_price
    if ratio <= 1:
        return _clamp(1 - 0.3 * abs(ratio - 1))
    return _clamp(max(0.0, 1 - 2 * (ratio - 1)))


def _build_commute_score(commute_minutes: float | None, max_commute_minutes: float) -> float:
    if commute_minutes is None or max_commute_minutes <= 0:
        return 0.0
    if commute_minutes <= max_commute_minutes:
        return _clamp(1 - commute_minutes / max_commute_minutes * 0.5)
    return _clamp(max(0.0, 1 - (commute_minutes / max_commute_minutes - 1)))


def _build_convenience_scores(metrics: list[DistrictMetric]) -> dict[str, float]:
    def _normalize_by_field(field_name: str) -> dict[str, float]:
        values: list[tuple[str, float]] = []
        for item in metrics:
            value = _as_float(getattr(item, field_name, None))
            if value is None:
                continue
            values.append((item.district, value))
        if not values:
            return {}
        numbers = [value for _, value in values]
        lo = min(numbers)
        hi = max(numbers)
        if hi == lo:
            return {district: 0.5 for district, _ in values}
        return {district: _clamp((value - lo) / (hi - lo)) for district, value in values}

    convenience = _normalize_by_field("livability_score")
    if convenience:
        return convenience

    activity_norm_scores: dict[str, float] = {}
    has_any = False
    for item in metrics:
        value = _as_float(getattr(item, "activity_norm", None))
        if value is None:
            continue
        has_any = True
        activity_norm_scores[item.district] = _clamp(value)
    if has_any:
        return activity_norm_scores

    return _normalize_by_field("business_activity")


def _build_rule_explanation(recommendation_context: dict[str, Any]) -> str:
    budget_score = float(recommendation_context.get("budget_score", 0.0))
    commute_score = float(recommendation_context.get("commute_score", 0.0))
    convenience_score = recommendation_context.get("convenience_score")

    budget_text = "预算匹配度较好" if budget_score >= 0.65 else "预算压力相对偏高"
    if commute_score >= 0.65:
        commute_text = "预计通勤时间在可接受范围内"
    elif commute_score > 0:
        commute_text = "预计通勤时间偏长，建议结合具体路线再核对"
    else:
        commute_text = "暂未获取有效通勤时间"

    if convenience_score is None:
        convenience_text = "当前基于预算与通勤做了保守推荐"
    elif float(convenience_score) >= 0.6:
        convenience_text = "区域便利性指标表现较好"
    else:
        convenience_text = "区域便利性指标表现一般"

    return f"{budget_text}，{commute_text}，{convenience_text}。"


def _llm_enabled() -> bool:
    return bool(LLM_API_KEY and LLM_BASE_URL and LLM_MODEL)


def _call_llm_to_polish_reason(recommendation_context: dict[str, Any], fallback: str) -> str:
    if not _llm_enabled():
        return fallback

    endpoint = urljoin(LLM_BASE_URL.rstrip("/") + "/", "chat/completions")
    prompt = (
        "你是上海居住分析助手。请基于输入上下文，把推荐理由润色成一句中文，"
        "40~70字，务实中性，不夸张，不引入上下文之外的数据。"
    )
    user_content = {
        "district": recommendation_context.get("district"),
        "score": recommendation_context.get("score"),
        "budget_score": recommendation_context.get("budget_score"),
        "commute_score": recommendation_context.get("commute_score"),
        "convenience_score": recommendation_context.get("convenience_score"),
        "commute_minutes": recommendation_context.get("commute_minutes"),
        "avg_price": recommendation_context.get("avg_price"),
        "avg_total_price": recommendation_context.get("avg_total_price"),
        "house_count": recommendation_context.get("house_count"),
        "fallback_reason": fallback,
    }

    body = {
        "model": LLM_MODEL,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
        ],
    }

    request = Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LLM_API_KEY}",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        choices = payload.get("choices") or []
        message = choices[0].get("message", {}) if choices else {}
        content = str(message.get("content") or "").strip()
        if content:
            return content.replace("\n", " ")
    except Exception:
        return fallback
    return fallback


def generate_agent_explanation(recommendation_context: dict[str, Any]) -> str:
    """
    Keep ranking deterministic in code; LLM is used only for explanation polishing.
    """
    fallback = _build_rule_explanation(recommendation_context)
    return _call_llm_to_polish_reason(recommendation_context, fallback)


def recommend_districts(payload: AgentRecommendRequest, db: Session) -> AgentRecommendResponse:
    metrics = db.scalars(select(DistrictMetric)).all()
    if not metrics:
        return AgentRecommendResponse(work_location=None, recommendations=[])

    work_location = geocode_address(payload.work_address)
    work_location_str = None
    if work_location is not None:
        work_location_str = f"{work_location[0]:.6f},{work_location[1]:.6f}"

    boundary_centers = _load_boundary_centers()
    affordable_unit_price = payload.budget_wan * 10000.0 / payload.target_area
    convenience_scores = _build_convenience_scores(metrics)
    has_convenience = bool(convenience_scores)

    results: list[DistrictRecommendation] = []
    for metric in metrics:
        avg_price = _as_float(getattr(metric, "avg_price", None))
        avg_total_price = _as_float(getattr(metric, "avg_total_price", None))
        house_count = _as_int(getattr(metric, "house_count", None))

        origin = _get_district_origin(metric, boundary_centers)
        commute_minutes: float | None = None
        if work_location is not None and origin is not None:
            commute_minutes = get_commute_minutes(origin, work_location, payload.commute_mode)
            if commute_minutes is not None:
                commute_minutes = round(max(0.0, commute_minutes), 1)

        budget_score = _build_budget_score(avg_price, affordable_unit_price)
        commute_score = _build_commute_score(commute_minutes, payload.max_commute_minutes)
        convenience_score = convenience_scores.get(metric.district)

        if has_convenience and convenience_score is not None:
            score = 0.45 * budget_score + 0.40 * commute_score + 0.15 * convenience_score
        else:
            score = 0.55 * budget_score + 0.45 * commute_score
        score = round(_clamp(score), 4)

        risks = [
            "当前结果基于区级或最小样本数据，不能代表具体小区。",
            "当前房价为挂牌或样本均值，不等同于真实成交价。",
        ]
        if commute_minutes is None:
            risks.append("未能获取有效通勤时间。")
        if house_count is not None and house_count <= 3:
            risks.append("当前区域样本量较少，结果波动可能较大。")

        reason = generate_agent_explanation(
            {
                "district": metric.district,
                "score": score,
                "budget_score": round(budget_score, 4),
                "commute_score": round(commute_score, 4),
                "convenience_score": round(convenience_score, 4) if convenience_score is not None else None,
                "commute_minutes": commute_minutes,
                "avg_price": avg_price,
                "avg_total_price": avg_total_price,
                "house_count": house_count,
            }
        )

        results.append(
            DistrictRecommendation(
                district=metric.district,
                score=score,
                commute_minutes=commute_minutes,
                avg_price=avg_price,
                avg_total_price=avg_total_price,
                house_count=house_count,
                reason=reason,
                risks=risks,
            )
        )

    results.sort(key=lambda item: item.score, reverse=True)
    return AgentRecommendResponse(work_location=work_location_str, recommendations=results[: payload.top_k])
