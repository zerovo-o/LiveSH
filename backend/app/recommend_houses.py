from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from .amap_client import geocode_address, get_commute_minutes
from .house_recommend_schemas import (
    HouseRecommendRequest,
    HouseRecommendResponse,
    HouseRecommendation,
    StreetRecommendation,
)
from .models import DistrictMetric, HouseListing


@dataclass
class HouseCandidate:
    model: HouseListing
    budget_score: float
    commute_minutes: float | None = None
    commute_score: float = 0.0
    convenience_score: float = 0.0
    house_score: float = 0.0


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _build_budget_score(unit_price: float, affordable_unit_price: float) -> float:
    if affordable_unit_price <= 0:
        return 0.0
    ratio = unit_price / affordable_unit_price
    if ratio <= 1:
        return _clamp(1 - 0.3 * abs(ratio - 1))
    return _clamp(max(0.0, 1 - 2 * (ratio - 1)))


def _build_commute_score(commute_minutes: float | None, max_commute_minutes: float) -> float:
    if commute_minutes is None or max_commute_minutes <= 0:
        return 0.0
    if commute_minutes <= max_commute_minutes:
        return _clamp(1 - commute_minutes / max_commute_minutes * 0.5)
    return _clamp(max(0.0, 1 - (commute_minutes / max_commute_minutes - 1)))


def _normalize(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: _clamp((v - lo) / (hi - lo)) for k, v in values.items()}


def _build_district_convenience(db: Session) -> dict[str, float]:
    rows = db.scalars(select(DistrictMetric)).all()
    if not rows:
        return {}
    by_district = {row.district: float(row.livability_score) for row in rows}
    return _normalize(by_district)


def _house_reason(item: HouseCandidate) -> str:
    if item.commute_minutes is None:
        commute_text = "通勤时间暂未获取"
    else:
        commute_text = f"预计通勤约{int(round(item.commute_minutes))}分钟"
    return (
        f"预算匹配度较好，{commute_text}，并结合区域便利性指标进行综合排序。"
    )


def _street_reason(sub_district: str, median_commute: float | None, affordable_ratio: float) -> str:
    commute_text = (
        f"中位通勤约{int(round(median_commute))}分钟" if median_commute is not None else "通勤时间样本有限"
    )
    return f"{sub_district}样本中可负担房源占比约{int(round(affordable_ratio * 100))}% ，{commute_text}。"


def recommend_houses(payload: HouseRecommendRequest, db: Session) -> HouseRecommendResponse:
    affordable_unit_price = payload.budget_wan * 10000.0 / payload.target_area
    work_location = geocode_address(payload.work_address)
    work_location_str = None
    if work_location is not None:
        work_location_str = f"{work_location[0]:.6f},{work_location[1]:.6f}"

    district_convenience = _build_district_convenience(db)

    # Stage 1: fetch and pre-score candidates.
    house_rows = db.scalars(
        select(HouseListing).where(HouseListing.unit_price <= affordable_unit_price * 1.35)
    ).all()
    if not house_rows:
        house_rows = db.scalars(select(HouseListing)).all()

    candidates: list[HouseCandidate] = []
    for row in house_rows:
        budget_score = _build_budget_score(float(row.unit_price), affordable_unit_price)
        if budget_score <= 0 and float(row.unit_price) > affordable_unit_price * 1.8:
            continue
        candidates.append(HouseCandidate(model=row, budget_score=budget_score))

    # Cap candidates for expensive route calculation by budget proximity.
    candidates.sort(key=lambda item: abs(float(item.model.unit_price) - affordable_unit_price))
    candidates = candidates[: max(payload.max_route_calls, payload.top_streets * payload.top_houses_per_street * 3)]

    # Stage 2: route calls and final house score.
    route_calls = 0
    for item in candidates:
        if work_location is not None and route_calls < payload.max_route_calls:
            origin = (float(item.model.gcj02_lng), float(item.model.gcj02_lat))
            commute = get_commute_minutes(origin, work_location, payload.commute_mode)
            item.commute_minutes = round(commute, 1) if commute is not None else None
            route_calls += 1

        item.commute_score = _build_commute_score(item.commute_minutes, payload.max_commute_minutes)
        item.convenience_score = district_convenience.get(item.model.district, 0.5)
        item.house_score = _clamp(
            0.45 * item.budget_score + 0.40 * item.commute_score + 0.15 * item.convenience_score
        )

    # Group by (district, sub_district) for street-level recommendation.
    grouped: dict[tuple[str, str], list[HouseCandidate]] = {}
    for item in candidates:
        key = (item.model.district, item.model.sub_district or "未知")
        grouped.setdefault(key, []).append(item)

    street_rows: list[StreetRecommendation] = []
    for (district, sub_district), items in grouped.items():
        items.sort(key=lambda x: x.house_score, reverse=True)
        street_score = sum(i.house_score for i in items[: min(10, len(items))]) / min(10, len(items))
        commute_values = [i.commute_minutes for i in items if i.commute_minutes is not None]
        median_commute = median(commute_values) if commute_values else None
        affordable_count = sum(1 for i in items if float(i.model.unit_price) <= affordable_unit_price)
        affordable_ratio = affordable_count / len(items) if items else 0.0
        risks = [
            "街道推荐基于当前抓取样本，不代表该街道全量在售房源。",
            "挂牌价格不等同于最终成交价。",
        ]
        if not commute_values:
            risks.append("该街道暂未获取有效通勤时间样本。")
        street_rows.append(
            StreetRecommendation(
                district=district,
                sub_district=sub_district,
                street_score=round(_clamp(street_score), 4),
                median_commute_minutes=round(float(median_commute), 1) if median_commute is not None else None,
                house_count=len(items),
                affordable_ratio=round(_clamp(affordable_ratio), 4),
                reason=_street_reason(sub_district, median_commute, affordable_ratio),
                risks=risks,
            )
        )

    street_rows.sort(key=lambda row: row.street_score, reverse=True)
    top_streets = street_rows[: payload.top_streets]
    allowed_streets = {(s.district, s.sub_district) for s in top_streets}

    # Flatten houses for top streets.
    house_rows_out: list[HouseRecommendation] = []
    for item in sorted(candidates, key=lambda x: x.house_score, reverse=True):
        street_key = (item.model.district, item.model.sub_district or "未知")
        if street_key not in allowed_streets:
            continue
        existing_count = sum(
            1
            for row in house_rows_out
            if row.district == street_key[0] and row.sub_district == street_key[1]
        )
        if existing_count >= payload.top_houses_per_street:
            continue
        risks = [
            "房源详情可能随时间变化，请以最新挂牌信息为准。",
        ]
        if item.commute_minutes is None:
            risks.append("未能获取该房源有效通勤时间。")

        house_rows_out.append(
            HouseRecommendation(
                house_id=str(item.model.house_id or item.model.id),
                district=item.model.district,
                sub_district=item.model.sub_district or "未知",
                community_name=item.model.community_name,
                title=item.model.title,
                area=float(item.model.area) if item.model.area is not None else None,
                commute_minutes=item.commute_minutes,
                unit_price=float(item.model.unit_price),
                total_price=float(item.model.price),
                score=round(item.house_score, 4),
                reason=_house_reason(item),
                risks=risks,
            )
        )

    summary = {
        "candidate_houses": len(candidates),
        "route_calls": route_calls,
        "affordable_unit_price": round(affordable_unit_price, 2),
        "top_street_count": len(top_streets),
        "returned_houses": len(house_rows_out),
    }

    return HouseRecommendResponse(
        work_location=work_location_str,
        streets=top_streets,
        houses=house_rows_out,
        summary=summary,
    )

