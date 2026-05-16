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
    poi_diversity: float
    shopping_per_house: float
    traffic_per_house: float
    healthcare_per_house: float
    recreation_per_house: float
    company_per_house: float
    cost_pressure: float
    affordability_score: float
    service_score: float
    vitality_score: float
    livability_score_v2: float
    shopping_access: float
    traffic_access: float
    healthcare_access: float
    recreation_access: float
    company_access: float
    nearest_traffic_distance: float | None = None
    nearest_healthcare_distance: float | None = None
    access_score: float
    value_score: float
    shopping_e2sfca_access: float
    traffic_e2sfca_access: float
    healthcare_e2sfca_access: float
    recreation_e2sfca_access: float
    company_e2sfca_access: float
    e2sfca_access_score: float
    e2sfca_value_score: float
    sample_reliability_score: float
    calibrated_score: float
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
    poi_diversity: float
    shopping_per_house: float
    traffic_per_house: float
    healthcare_per_house: float
    recreation_per_house: float
    company_per_house: float
    cost_pressure: float
    affordability_score: float
    service_score: float
    vitality_score: float
    livability_score_v2: float
    shopping_access: float
    traffic_access: float
    healthcare_access: float
    recreation_access: float
    company_access: float
    nearest_traffic_distance: float | None = None
    nearest_healthcare_distance: float | None = None
    access_score: float
    value_score: float
    shopping_e2sfca_access: float
    traffic_e2sfca_access: float
    healthcare_e2sfca_access: float
    recreation_e2sfca_access: float
    company_e2sfca_access: float
    e2sfca_access_score: float
    e2sfca_value_score: float
    sample_reliability_score: float
    calibrated_score: float
    center_lng: float | None = None
    center_lat: float | None = None

    model_config = {"from_attributes": True}


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

