from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, median
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .amap_client import geocode_address, get_commute_minutes
from .config import LLM_RERANK_WEIGHT, RECOMMENDER_VERSION
from .house_recommend_schemas import (
    CommunityRecommendation,
    HouseRecommendRequest,
    HouseRecommendResponse,
    HouseRecommendation,
    StreetRecommendation,
)
from .llm_rerank import rerank_community_candidates, rerank_house_candidates
from .models import DistrictMetric, HouseListing, StreetMetric

Version = Literal["v1", "v2"]


@dataclass
class HouseCandidate:
    model: HouseListing
    budget_score: float
    commute_minutes: float | None = None
    commute_score: float = 0.0
    convenience_score: float = 0.0
    poi_score: float = 0.0
    access_score: float = 0.0
    e2sfca_score: float = 0.0
    calibrated_score: float = 0.0
    rule_score: float = 0.0
    llm_score: float | None = None
    llm_confidence: float | None = None
    final_score: float = 0.0
    llm_reason: str | None = None
    breakdown: dict[str, float] | None = None


@dataclass
class CommunityCandidate:
    community_id: str
    district: str
    sub_district: str
    community_name: str
    items: list[HouseCandidate]
    avg_unit_price: float
    avg_total_price: float
    median_commute_minutes: float | None
    budget_match_score: float
    poi_score: float
    traffic_score: float
    access_score: float
    e2sfca_score: float
    calibrated_score: float
    rule_score: float
    llm_score: float | None = None
    llm_confidence: float | None = None
    final_score: float = 0.0
    llm_reason: str | None = None
    breakdown: dict[str, float] | None = None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _normalize(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    lo = min(values.values())
    hi = max(values.values())
    if hi == lo:
        return {k: 0.5 for k in values}
    return {k: _clamp((v - lo) / (hi - lo)) for k, v in values.items()}


def _resolve_version() -> Version:
    return "v2" if RECOMMENDER_VERSION == "v2" else "v1"


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


def _build_metric_maps(
    db: Session,
    healthcare_weight: float,
    shopping_weight: float,
) -> tuple[dict[str, float], dict[str, float], dict[str, float]]:
    rows = db.scalars(select(DistrictMetric)).all()
    if not rows:
        return {}, {}, {}

    convenience_raw = {row.district: float(row.livability_score) for row in rows}
    traffic_raw = {row.district: float(row.traffic_count) for row in rows}
    poi_pref_raw = {
        row.district: float(row.healthcare_count) * healthcare_weight + float(row.shopping_count) * shopping_weight
        for row in rows
    }
    return _normalize(convenience_raw), _normalize(traffic_raw), _normalize(poi_pref_raw)


def _build_advanced_metric_maps(
    db: Session,
) -> tuple[dict[str, float], dict[str, float], dict[str, float], dict[str, float], dict[str, float]]:
    districts = db.scalars(select(DistrictMetric)).all()
    streets = db.scalars(select(StreetMetric)).all()

    district_access_raw = {row.district: float(row.access_score) for row in districts}
    district_e2sfca_raw = {row.district: float(row.e2sfca_access_score) for row in districts}
    district_calibrated_raw = {row.district: float(row.calibrated_score) for row in districts}
    district_livable_v2_raw = {row.district: float(row.livability_score_v2) for row in districts}

    street_calibrated_raw = {
        (row.district, row.street): float(row.calibrated_score)
        for row in streets
    }

    return (
        _normalize(district_access_raw),
        _normalize(district_e2sfca_raw),
        _normalize(district_calibrated_raw),
        _normalize(district_livable_v2_raw),
        _normalize(street_calibrated_raw),
    )


def _house_reason(item: HouseCandidate) -> str:
    if item.llm_reason:
        return item.llm_reason
    commute_text = (
        "暂未获取有效通勤时间"
        if item.commute_minutes is None
        else f"预计通勤约 {int(round(item.commute_minutes))} 分钟"
    )
    return f"预算匹配较好，{commute_text}，综合配套与可达性表现稳定。"


def _street_reason(sub_district: str, median_commute: float | None, affordable_ratio: float) -> str:
    commute_text = (
        f"中位通勤约 {int(round(median_commute))} 分钟"
        if median_commute is not None
        else "通勤时间暂未稳定获取"
    )
    return f"{sub_district} 预算可承受房源占比约 {int(round(affordable_ratio * 100))}%，{commute_text}。"


def _community_reason(item: CommunityCandidate) -> str:
    if item.llm_reason:
        return item.llm_reason
    commute_text = (
        f"中位通勤约 {int(round(item.median_commute_minutes))} 分钟"
        if item.median_commute_minutes is not None
        else "通勤时间暂未稳定获取"
    )
    return (
        f"该小区均价约 {int(round(item.avg_unit_price))} 元/㎡，均总价约 {item.avg_total_price:.1f} 万，"
        f"{commute_text}，预算与可达性综合匹配度较好。"
    )


def _compute_house_rule_score(item: HouseCandidate, version: Version) -> tuple[float, dict[str, float]]:
    if version == "v2":
        score = _clamp(
            0.34 * item.budget_score
            + 0.26 * item.commute_score
            + 0.14 * item.poi_score
            + 0.12 * item.access_score
            + 0.08 * item.e2sfca_score
            + 0.06 * item.calibrated_score
        )
        breakdown = {
            "budget": round(item.budget_score, 4),
            "commute": round(item.commute_score, 4),
            "poi_pref": round(item.poi_score, 4),
            "access": round(item.access_score, 4),
            "e2sfca": round(item.e2sfca_score, 4),
            "calibrated": round(item.calibrated_score, 4),
        }
        return score, breakdown

    score = _clamp(
        0.42 * item.budget_score + 0.33 * item.commute_score + 0.17 * item.poi_score + 0.08 * item.convenience_score
    )
    breakdown = {
        "budget": round(item.budget_score, 4),
        "commute": round(item.commute_score, 4),
        "poi_pref": round(item.poi_score, 4),
        "convenience": round(item.convenience_score, 4),
    }
    return score, breakdown


def _compute_community_rule_score(item: CommunityCandidate, version: Version) -> tuple[float, dict[str, float]]:
    if version == "v2":
        score = _clamp(
            0.34 * item.budget_match_score
            + 0.25 * item.traffic_score
            + 0.14 * item.poi_score
            + 0.12 * item.access_score
            + 0.08 * item.e2sfca_score
            + 0.07 * item.calibrated_score
        )
        breakdown = {
            "budget": round(item.budget_match_score, 4),
            "traffic": round(item.traffic_score, 4),
            "poi_pref": round(item.poi_score, 4),
            "access": round(item.access_score, 4),
            "e2sfca": round(item.e2sfca_score, 4),
            "calibrated": round(item.calibrated_score, 4),
        }
        return score, breakdown

    score = _clamp(
        0.40 * item.budget_match_score + 0.30 * item.traffic_score + 0.20 * item.poi_score + 0.10 * item.access_score
    )
    breakdown = {
        "budget": round(item.budget_match_score, 4),
        "traffic": round(item.traffic_score, 4),
        "poi_pref": round(item.poi_score, 4),
        "access": round(item.access_score, 4),
    }
    return score, breakdown


def _build_house_rerank_rows(candidates: list[HouseCandidate], max_items: int) -> list[dict]:
    rows: list[dict] = []
    for item in sorted(candidates, key=lambda x: x.rule_score, reverse=True)[:max_items]:
        row = {
            "house_id": str(item.model.house_id or item.model.id),
            "district": item.model.district,
            "sub_district": item.model.sub_district or "未知街道",
            "community_name": item.model.community_name or "未知小区",
            "unit_price": round(float(item.model.unit_price), 2),
            "total_price": round(float(item.model.price), 2),
            "area": round(float(item.model.area), 2) if item.model.area is not None else None,
            "commute_minutes": item.commute_minutes,
            "budget_score": round(item.budget_score, 4),
            "commute_score": round(item.commute_score, 4),
            "poi_score": round(item.poi_score, 4),
            "convenience_score": round(item.convenience_score, 4),
            "access_score": round(item.access_score, 4),
            "e2sfca_score": round(item.e2sfca_score, 4),
            "calibrated_score": round(item.calibrated_score, 4),
            "rule_score": round(item.rule_score, 4),
        }
        rows.append(row)
    return rows


def _apply_house_llm_rerank(
    *,
    payload: HouseRecommendRequest,
    affordable_unit_price: float,
    candidates: list[HouseCandidate],
) -> dict[str, int | str | bool]:
    llm_rows = _build_house_rerank_rows(candidates, payload.max_route_calls)
    rerank_result = rerank_house_candidates(
        work_address=payload.work_address,
        commute_mode=payload.commute_mode,
        max_commute_minutes=payload.max_commute_minutes,
        affordable_unit_price=affordable_unit_price,
        candidates=llm_rows,
    )

    by_house_id = {str(item.model.house_id or item.model.id): item for item in candidates}
    llm_hits = 0
    if rerank_result.applied:
        base_weight = _clamp(LLM_RERANK_WEIGHT)
        for house_id, rerank_item in rerank_result.items.items():
            target = by_house_id.get(house_id)
            if target is None:
                continue
            confidence = _clamp(rerank_item.confidence)
            dynamic_weight = base_weight * confidence
            target.llm_score = rerank_item.llm_score
            target.llm_confidence = confidence
            target.llm_reason = rerank_item.reason or None
            target.final_score = _clamp((1 - dynamic_weight) * target.rule_score + dynamic_weight * rerank_item.llm_score)
            llm_hits += 1

    for item in candidates:
        if item.final_score <= 0:
            item.final_score = item.rule_score

    return {
        "house_rerank_applied": rerank_result.applied,
        "house_rerank_latency_ms": rerank_result.latency_ms,
        "house_rerank_candidates": len(llm_rows),
        "house_rerank_success_count": llm_hits,
        "house_rerank_error": rerank_result.error or "",
    }


def _group_communities(candidates: list[HouseCandidate], version: Version) -> list[CommunityCandidate]:
    grouped: dict[tuple[str, str, str], list[HouseCandidate]] = {}
    for item in candidates:
        key = (
            item.model.district,
            item.model.sub_district or "未知街道",
            item.model.community_name or "未知小区",
        )
        grouped.setdefault(key, []).append(item)

    communities: list[CommunityCandidate] = []
    for (district, sub_district, community_name), items in grouped.items():
        items.sort(key=lambda x: x.final_score, reverse=True)
        commute_values = [i.commute_minutes for i in items if i.commute_minutes is not None]
        median_commute = median(commute_values) if commute_values else None
        avg_unit_price = mean(float(i.model.unit_price) for i in items)
        avg_total_price = mean(float(i.model.price) for i in items)
        budget_match_score = mean(i.budget_score for i in items)
        poi_score = mean(i.poi_score for i in items)
        traffic_score = mean(i.commute_score for i in items)
        access_score = mean(i.access_score for i in items)
        e2sfca_score = mean(i.e2sfca_score for i in items)
        calibrated_score = mean(i.calibrated_score for i in items)

        community_id = f"{district}|{sub_district}|{community_name}"
        candidate = CommunityCandidate(
            community_id=community_id,
            district=district,
            sub_district=sub_district,
            community_name=community_name,
            items=items,
            avg_unit_price=avg_unit_price,
            avg_total_price=avg_total_price,
            median_commute_minutes=median_commute,
            budget_match_score=budget_match_score,
            poi_score=poi_score,
            traffic_score=traffic_score,
            access_score=access_score,
            e2sfca_score=e2sfca_score,
            calibrated_score=calibrated_score,
            rule_score=0.0,
            final_score=0.0,
        )
        candidate.rule_score, candidate.breakdown = _compute_community_rule_score(candidate, version)
        candidate.final_score = candidate.rule_score
        communities.append(candidate)

    communities.sort(key=lambda x: x.rule_score, reverse=True)
    return communities


def _build_community_rerank_rows(communities: list[CommunityCandidate], max_items: int) -> list[dict]:
    rows: list[dict] = []
    for item in communities[:max_items]:
        rows.append(
            {
                "community_id": item.community_id,
                "district": item.district,
                "sub_district": item.sub_district,
                "community_name": item.community_name,
                "avg_unit_price": round(item.avg_unit_price, 2),
                "avg_total_price": round(item.avg_total_price, 2),
                "median_commute_minutes": item.median_commute_minutes,
                "house_count": len(item.items),
                "budget_match_score": round(item.budget_match_score, 4),
                "poi_score": round(item.poi_score, 4),
                "traffic_score": round(item.traffic_score, 4),
                "access_score": round(item.access_score, 4),
                "e2sfca_score": round(item.e2sfca_score, 4),
                "calibrated_score": round(item.calibrated_score, 4),
                "rule_score": round(item.rule_score, 4),
            }
        )
    return rows


def _apply_community_llm_rerank(
    *,
    payload: HouseRecommendRequest,
    communities: list[CommunityCandidate],
) -> dict[str, int | str | bool]:
    llm_rows = _build_community_rerank_rows(communities, payload.top_communities * 5)
    rerank_result = rerank_community_candidates(
        work_address=payload.work_address,
        commute_mode=payload.commute_mode,
        max_commute_minutes=payload.max_commute_minutes,
        budget_wan=payload.budget_wan,
        candidates=llm_rows,
    )

    by_id = {item.community_id: item for item in communities}
    llm_hits = 0
    if rerank_result.applied:
        base_weight = _clamp(LLM_RERANK_WEIGHT)
        for community_id, rerank_item in rerank_result.items.items():
            target = by_id.get(community_id)
            if target is None:
                continue
            confidence = _clamp(rerank_item.confidence)
            dynamic_weight = base_weight * confidence
            target.llm_score = rerank_item.llm_score
            target.llm_confidence = confidence
            target.llm_reason = rerank_item.reason or None
            target.final_score = _clamp((1 - dynamic_weight) * target.rule_score + dynamic_weight * rerank_item.llm_score)
            llm_hits += 1

    for item in communities:
        if item.final_score <= 0:
            item.final_score = item.rule_score

    communities.sort(key=lambda x: x.final_score, reverse=True)
    return {
        "community_rerank_applied": rerank_result.applied,
        "community_rerank_latency_ms": rerank_result.latency_ms,
        "community_rerank_candidates": len(llm_rows),
        "community_rerank_success_count": llm_hits,
        "community_rerank_error": rerank_result.error or "",
    }


def recommend_houses(payload: HouseRecommendRequest, db: Session) -> HouseRecommendResponse:
    version = _resolve_version()
    affordable_unit_price = payload.budget_wan * 10000.0 / payload.target_area
    work_location = geocode_address(payload.work_address)
    work_location_str = None
    if work_location is not None:
        work_location_str = f"{work_location[0]:.6f},{work_location[1]:.6f}"

    convenience_map, _traffic_map, poi_pref_map = _build_metric_maps(
        db,
        healthcare_weight=payload.healthcare_weight,
        shopping_weight=payload.shopping_weight,
    )
    access_map, e2sfca_map, calibrated_map, livable_v2_map, street_calibrated_map = _build_advanced_metric_maps(db)

    house_rows = db.scalars(select(HouseListing).where(HouseListing.unit_price <= affordable_unit_price * 1.35)).all()
    if not house_rows:
        house_rows = db.scalars(select(HouseListing)).all()

    candidates: list[HouseCandidate] = []
    for row in house_rows:
        budget_score = _build_budget_score(float(row.unit_price), affordable_unit_price)
        if budget_score <= 0 and float(row.unit_price) > affordable_unit_price * 1.8:
            continue
        candidates.append(HouseCandidate(model=row, budget_score=budget_score))

    candidates.sort(key=lambda item: abs(float(item.model.unit_price) - affordable_unit_price))
    candidates = candidates[: max(payload.max_route_calls, payload.top_communities * payload.top_houses_per_community * 10)]

    route_calls = 0
    route_success_count = 0
    for item in candidates:
        if work_location is not None and route_calls < payload.max_route_calls:
            origin = (float(item.model.gcj02_lng), float(item.model.gcj02_lat))
            commute = get_commute_minutes(origin, work_location, payload.commute_mode)
            item.commute_minutes = round(commute, 1) if commute is not None else None
            route_calls += 1
            if commute is not None:
                route_success_count += 1

        district = item.model.district
        sub_district = item.model.sub_district or ""
        item.commute_score = _build_commute_score(item.commute_minutes, payload.max_commute_minutes)
        item.convenience_score = livable_v2_map.get(district, convenience_map.get(district, 0.5))
        item.poi_score = poi_pref_map.get(district, 0.5)
        item.access_score = access_map.get(district, 0.5)
        item.e2sfca_score = e2sfca_map.get(district, 0.5)
        base_calibrated = calibrated_map.get(district, 0.5)
        item.calibrated_score = street_calibrated_map.get((district, sub_district), base_calibrated)

        item.rule_score, item.breakdown = _compute_house_rule_score(item, version)
        item.final_score = item.rule_score

    house_rerank_diag = _apply_house_llm_rerank(
        payload=payload,
        affordable_unit_price=affordable_unit_price,
        candidates=candidates,
    )

    grouped_streets: dict[tuple[str, str], list[HouseCandidate]] = {}
    for item in candidates:
        key = (item.model.district, item.model.sub_district or "未知街道")
        grouped_streets.setdefault(key, []).append(item)

    street_rows: list[StreetRecommendation] = []
    for (district, sub_district), items in grouped_streets.items():
        items.sort(key=lambda x: x.final_score, reverse=True)
        top_count = min(10, len(items))
        street_score = sum(i.final_score for i in items[:top_count]) / top_count
        commute_values = [i.commute_minutes for i in items if i.commute_minutes is not None]
        median_commute = median(commute_values) if commute_values else None
        affordable_count = sum(1 for i in items if float(i.model.unit_price) <= affordable_unit_price)
        affordable_ratio = affordable_count / len(items) if items else 0.0
        avg_access = mean(i.access_score for i in items)
        avg_e2sfca = mean(i.e2sfca_score for i in items)
        avg_calibrated = mean(i.calibrated_score for i in items)
        risks = [
            "街道层级结果基于样本聚合，不能代表具体小区实时成交情况。",
            "房价为样本均值，可能与挂牌价和成交价存在偏差。",
        ]
        if not commute_values:
            risks.append("未能获取有效通勤时间，建议在地图软件中复核。")
        street_rows.append(
            StreetRecommendation(
                district=district,
                sub_district=sub_district,
                street_score=round(_clamp(street_score), 4),
                median_commute_minutes=round(float(median_commute), 1) if median_commute is not None else None,
                house_count=len(items),
                affordable_ratio=round(_clamp(affordable_ratio), 4),
                score_breakdown={
                    "avg_access": round(avg_access, 4),
                    "avg_e2sfca": round(avg_e2sfca, 4),
                    "avg_calibrated": round(avg_calibrated, 4),
                },
                reason=_street_reason(sub_district, median_commute, affordable_ratio),
                risks=risks,
            )
        )

    street_rows.sort(key=lambda row: row.street_score, reverse=True)
    top_streets = street_rows[: payload.top_streets]

    communities = _group_communities(candidates, version)
    community_rerank_diag = _apply_community_llm_rerank(payload=payload, communities=communities)
    top_communities = communities[: payload.top_communities]
    allowed_communities = {item.community_id for item in top_communities}

    community_rows: list[CommunityRecommendation] = []
    for item in top_communities:
        risks = [
            "小区推荐依赖样本覆盖度，可能存在部分房源缺失。",
            "均价和通勤为估算值，建议结合实地看房复核。",
        ]
        if item.median_commute_minutes is None:
            risks.append("该小区未能稳定获取通勤时间。")
        community_rows.append(
            CommunityRecommendation(
                district=item.district,
                sub_district=item.sub_district,
                community_name=item.community_name,
                score=round(item.final_score, 4),
                rule_score=round(item.rule_score, 4),
                llm_score=round(item.llm_score, 4) if item.llm_score is not None else None,
                llm_confidence=round(item.llm_confidence, 4) if item.llm_confidence is not None else None,
                median_commute_minutes=round(item.median_commute_minutes, 1)
                if item.median_commute_minutes is not None
                else None,
                avg_unit_price=round(item.avg_unit_price, 2),
                avg_total_price=round(item.avg_total_price, 2),
                house_count=len(item.items),
                poi_score=round(item.poi_score, 4),
                traffic_score=round(item.traffic_score, 4),
                budget_match_score=round(item.budget_match_score, 4),
                score_breakdown=item.breakdown,
                reason=_community_reason(item),
                risks=risks,
            )
        )

    house_rows_out: list[HouseRecommendation] = []
    for item in sorted(candidates, key=lambda x: x.final_score, reverse=True):
        community_id = f"{item.model.district}|{item.model.sub_district or '未知街道'}|{item.model.community_name or '未知小区'}"
        if community_id not in allowed_communities:
            continue
        existing_count = sum(
            1
            for row in house_rows_out
            if row.district == item.model.district
            and row.sub_district == (item.model.sub_district or "未知街道")
            and row.community_name == (item.model.community_name or "未知小区")
        )
        if existing_count >= payload.top_houses_per_community:
            continue
        risks = ["房源为样本推荐，请核验挂牌状态、产权和税费信息。"]
        if item.commute_minutes is None:
            risks.append("该房源未获取到有效通勤时间。")

        house_rows_out.append(
            HouseRecommendation(
                house_id=str(item.model.house_id or item.model.id),
                district=item.model.district,
                sub_district=item.model.sub_district or "未知街道",
                community_name=item.model.community_name,
                title=item.model.title,
                area=float(item.model.area) if item.model.area is not None else None,
                commute_minutes=item.commute_minutes,
                unit_price=float(item.model.unit_price),
                total_price=float(item.model.price),
                score=round(item.final_score, 4),
                rule_score=round(item.rule_score, 4),
                llm_score=round(item.llm_score, 4) if item.llm_score is not None else None,
                llm_confidence=round(item.llm_confidence, 4) if item.llm_confidence is not None else None,
                community_score=next((round(c.final_score, 4) for c in top_communities if c.community_id == community_id), None),
                score_breakdown=item.breakdown,
                reason=_house_reason(item),
                risks=risks,
            )
        )

    summary: dict[str, float | int | str | bool | None] = {
        "feature_version_used": version,
        "candidate_houses": len(candidates),
        "route_calls": route_calls,
        "route_success_count": route_success_count,
        "affordable_unit_price": round(affordable_unit_price, 2),
        "top_street_count": len(top_streets),
        "top_community_count": len(top_communities),
        "returned_houses": len(house_rows_out),
        "house_rerank_applied": house_rerank_diag["house_rerank_applied"],
        "house_rerank_candidates": house_rerank_diag["house_rerank_candidates"],
        "house_rerank_success_count": house_rerank_diag["house_rerank_success_count"],
        "house_rerank_latency_ms": house_rerank_diag["house_rerank_latency_ms"],
        "house_rerank_error": house_rerank_diag["house_rerank_error"],
        "community_rerank_applied": community_rerank_diag["community_rerank_applied"],
        "community_rerank_candidates": community_rerank_diag["community_rerank_candidates"],
        "community_rerank_success_count": community_rerank_diag["community_rerank_success_count"],
        "community_rerank_latency_ms": community_rerank_diag["community_rerank_latency_ms"],
        "community_rerank_error": community_rerank_diag["community_rerank_error"],
        "amap_geocode_ok": bool(work_location is not None),
        "amap_route_success_count": route_success_count,
        "amap_route_failure_count": max(0, route_calls - route_success_count),
    }
    if work_location_str is None:
        summary["geocode_warning"] = "work_address_geocode_failed_or_unavailable"
    elif route_calls == 0:
        summary["route_warning"] = "no_commute_route_calls_executed"

    return HouseRecommendResponse(
        work_location=work_location_str,
        streets=top_streets,
        communities=community_rows,
        houses=house_rows_out,
        summary=summary,
    )
