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
