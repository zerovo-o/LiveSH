from __future__ import annotations

from pydantic import BaseModel


class DistrictMetricOut(BaseModel):
    district: str
    avg_price: float
    avg_total_price: float
    house_count: int
    poi_total: int
    recreation_count: int
    company_count: int
    residence_count: int
    shopping_count: int
    traffic_count: int
    healthcare_count: int
    business_activity: float
    activity_norm: float
    price_norm: float
    livability_score: float
    livability_score_display: float | None = None
    poi_diversity: float
    shopping_per_house: float
    traffic_per_house: float
    healthcare_per_house: float
    recreation_per_house: float
    company_per_house: float
    cost_pressure: float
    affordability_score: float
    affordability_score_display: float | None = None
    service_score: float
    service_score_display: float | None = None
    vitality_score: float
    vitality_score_display: float | None = None
    livability_score_v2: float
    livability_score_v2_display: float | None = None
    shopping_access: float
    traffic_access: float
    healthcare_access: float
    recreation_access: float
    company_access: float
    nearest_traffic_distance: float | None = None
    nearest_healthcare_distance: float | None = None
    access_score: float
    access_score_display: float | None = None
    value_score: float
    value_score_display: float | None = None
    shopping_e2sfca_access: float
    traffic_e2sfca_access: float
    healthcare_e2sfca_access: float
    recreation_e2sfca_access: float
    company_e2sfca_access: float
    e2sfca_access_score: float
    e2sfca_access_score_display: float | None = None
    e2sfca_value_score: float
    e2sfca_value_score_display: float | None = None
    sample_reliability_score: float
    calibrated_score: float
    calibrated_score_display: float | None = None
    life_circle_5min_score: float
    life_circle_5min_score_display: float | None = None
    life_circle_10min_score: float
    life_circle_10min_score_display: float | None = None
    life_circle_15min_score: float
    life_circle_15min_score_display: float | None = None
    life_circle_score: float
    life_circle_score_display: float | None = None
    life_circle_5min_coverage: float
    life_circle_10min_coverage: float
    life_circle_15min_coverage: float
    calibrated_score_life_circle: float
    calibrated_score_life_circle_display: float | None = None
    center_lng: float | None = None
    center_lat: float | None = None

    model_config = {"from_attributes": True}


class PoiCategoryOut(BaseModel):
    category: str
    count: int

    model_config = {"from_attributes": True}


class StreetMetricOut(BaseModel):
    id: int
    district: str
    street: str
    avg_price: float
    avg_total_price: float
    house_count: int
    poi_total: int
    recreation_count: int
    company_count: int
    residence_count: int
    shopping_count: int
    traffic_count: int
    healthcare_count: int
    business_activity: float
    activity_norm: float
    price_norm: float
    livability_score: float
    livability_score_display: float | None = None
    poi_diversity: float
    shopping_per_house: float
    traffic_per_house: float
    healthcare_per_house: float
    recreation_per_house: float
    company_per_house: float
    cost_pressure: float
    affordability_score: float
    affordability_score_display: float | None = None
    service_score: float
    service_score_display: float | None = None
    vitality_score: float
    vitality_score_display: float | None = None
    livability_score_v2: float
    livability_score_v2_display: float | None = None
    shopping_access: float
    traffic_access: float
    healthcare_access: float
    recreation_access: float
    company_access: float
    nearest_traffic_distance: float | None = None
    nearest_healthcare_distance: float | None = None
    access_score: float
    access_score_display: float | None = None
    value_score: float
    value_score_display: float | None = None
    shopping_e2sfca_access: float
    traffic_e2sfca_access: float
    healthcare_e2sfca_access: float
    recreation_e2sfca_access: float
    company_e2sfca_access: float
    e2sfca_access_score: float
    e2sfca_access_score_display: float | None = None
    e2sfca_value_score: float
    e2sfca_value_score_display: float | None = None
    sample_reliability_score: float
    calibrated_score: float
    calibrated_score_display: float | None = None
    life_circle_5min_score: float
    life_circle_5min_score_display: float | None = None
    life_circle_10min_score: float
    life_circle_10min_score_display: float | None = None
    life_circle_15min_score: float
    life_circle_15min_score_display: float | None = None
    life_circle_score: float
    life_circle_score_display: float | None = None
    life_circle_5min_coverage: float
    life_circle_10min_coverage: float
    life_circle_15min_coverage: float
    calibrated_score_life_circle: float
    calibrated_score_life_circle_display: float | None = None
    center_lng: float | None = None
    center_lat: float | None = None

    model_config = {"from_attributes": True}


class RouteStreetMetricOut(BaseModel):
    district: str
    street: str
    sample_house_count: int
    route_expected_count: int
    route_success_count: int
    route_cache_hit_count: int
    route_success_rate: float
    route_sample_reliability_score: float
    life_circle_5min_score_route: float
    life_circle_5min_score_route_display: float | None = None
    life_circle_10min_score_route: float
    life_circle_10min_score_route_display: float | None = None
    life_circle_15min_score_route: float
    life_circle_15min_score_route_display: float | None = None
    life_circle_score_route: float
    life_circle_score_route_display: float | None = None
    calibrated_score_life_circle_route: float
    calibrated_score_life_circle_route_display: float | None = None
    life_circle_score_delta: float
    calibrated_score_delta: float
    old_rank: int
    route_rank: int
    rank_delta: int


class CommunityMetricOut(BaseModel):
    district: str
    street: str | None = None
    community_name: str
    house_count: int
    avg_price: float


class SummaryOut(BaseModel):
    districts: list[DistrictMetricOut]
    poi_categories: list[PoiCategoryOut]
    price_top10: list[DistrictMetricOut]
    shopping_top5: list[DistrictMetricOut]
    score_ranking: list[DistrictMetricOut]
    scatter: list[DistrictMetricOut]
    recommendations: list[DistrictMetricOut]


class AIAdviceRequest(BaseModel):
    district: str | None = None


class AIAdviceOut(BaseModel):
    district: str
    prompt: str
    advice: str
    is_placeholder: bool = True


class ChartInsightRequest(BaseModel):
    chart_id: str
    title: str
    description: str | None = None
    scope: str | None = None
    selected_district: str | None = None
    data: dict


class ChartInsightOut(BaseModel):
    chart_id: str
    insight: str
    is_placeholder: bool = False
