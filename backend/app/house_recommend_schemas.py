from __future__ import annotations

from pydantic import BaseModel, Field

from .agent_schemas import CommuteMode


class HouseRecommendRequest(BaseModel):
    budget_wan: float = Field(..., gt=0)
    target_area: float = Field(..., gt=0)
    work_address: str = Field(..., min_length=2, max_length=200)
    commute_mode: CommuteMode = "transit"
    max_commute_minutes: float = Field(..., gt=0, le=300)
    top_streets: int = Field(default=5, ge=1, le=20)
    top_houses_per_street: int = Field(default=3, ge=1, le=10)
    # Limit expensive route calls in one request.
    max_route_calls: int = Field(default=120, ge=20, le=600)


class StreetRecommendation(BaseModel):
    district: str
    sub_district: str
    street_score: float
    median_commute_minutes: float | None = None
    house_count: int
    affordable_ratio: float
    reason: str
    risks: list[str]


class HouseRecommendation(BaseModel):
    house_id: str
    district: str
    sub_district: str
    community_name: str | None = None
    title: str | None = None
    area: float | None = None
    commute_minutes: float | None = None
    unit_price: float
    total_price: float
    score: float
    reason: str
    risks: list[str]


class HouseRecommendResponse(BaseModel):
    work_location: str | None = None
    streets: list[StreetRecommendation]
    houses: list[HouseRecommendation]
    summary: dict[str, float | int | str | None]

