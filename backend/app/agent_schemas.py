from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CommuteMode = Literal["transit", "driving"]


class AgentRecommendRequest(BaseModel):
    budget_wan: float = Field(..., gt=0, description="Budget in 10k CNY")
    target_area: float = Field(..., gt=0, description="Target area in square meters")
    work_address: str = Field(..., min_length=2, max_length=200)
    commute_mode: CommuteMode = "transit"
    max_commute_minutes: float = Field(..., gt=0, le=300)
    top_k: int = Field(default=5, ge=1, le=20)


class DistrictRecommendation(BaseModel):
    district: str
    score: float
    commute_minutes: float | None = None
    avg_price: float | None = None
    avg_total_price: float | None = None
    house_count: int | None = None
    reason: str
    risks: list[str]


class AgentRecommendResponse(BaseModel):
    work_location: str | None = None
    recommendations: list[DistrictRecommendation]

