from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .ai_advice import generate_ai_advice
from .amap import fetch_local_shanghai_street_boundaries, fetch_shanghai_district_boundaries
from .chart_insight import generate_chart_insight
from .database import Base, engine, get_db
from .models import DistrictMetric, HouseListing, PoiCategoryMetric, PoiPoint, StreetMetric
from .recommend_houses import recommend_houses
from .route_life_circle import load_yangpu_route_metrics
from .schemas import (
    AIAdviceOut,
    AIAdviceRequest,
    ChartInsightOut,
    ChartInsightRequest,
    CommunityMetricOut,
    DistrictMetricOut,
    RouteStreetMetricOut,
    StreetMetricOut,
    SummaryOut,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Shanghai Livability Analysis API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/districts", response_model=list[DistrictMetricOut])
def list_districts(db: Session = Depends(get_db)):
    return db.scalars(select(DistrictMetric).order_by(DistrictMetric.calibrated_score_life_circle.desc())).all()


@app.get("/api/districts/{district}", response_model=DistrictMetricOut)
def get_district(district: str, db: Session = Depends(get_db)):
    item = db.get(DistrictMetric, district)
    if not item:
        raise HTTPException(status_code=404, detail="district not found")
    return item


@app.get("/api/streets", response_model=list[StreetMetricOut])
def list_streets(district: str | None = None, db: Session = Depends(get_db)):
    statement = select(StreetMetric)
    if district:
        statement = statement.where(StreetMetric.district == district)
    return db.scalars(statement.order_by(StreetMetric.calibrated_score_life_circle.desc())).all()


@app.get("/api/streets/route-life-circle/yangpu", response_model=list[RouteStreetMetricOut])
def list_yangpu_route_life_circle(db: Session = Depends(get_db)):
    reference_values = db.scalars(select(StreetMetric.calibrated_score_life_circle)).all()
    return load_yangpu_route_metrics(reference_values)


@app.get("/api/streets/{district}/{street}", response_model=StreetMetricOut)
def get_street(district: str, street: str, db: Session = Depends(get_db)):
    item = db.scalars(
        select(StreetMetric).where(StreetMetric.district == district, StreetMetric.street == street)
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="street not found")
    return item


@app.get("/api/communities", response_model=list[CommunityMetricOut])
def list_communities(
    district: str | None = None,
    street: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    statement = (
        select(
            HouseListing.district.label("district"),
            HouseListing.street.label("street"),
            HouseListing.community_name.label("community_name"),
            func.count(HouseListing.id).label("house_count"),
            func.avg(HouseListing.unit_price).label("avg_price"),
        )
        .where(HouseListing.community_name.is_not(None), func.trim(HouseListing.community_name) != "")
        .group_by(HouseListing.district, HouseListing.street, HouseListing.community_name)
    )
    if district:
        statement = statement.where(HouseListing.district == district)
    if street:
        statement = statement.where(HouseListing.street == street)
    if q:
        statement = statement.where(HouseListing.community_name.contains(q.strip()))
    rows = db.execute(
        statement.order_by(func.count(HouseListing.id).desc(), HouseListing.community_name.asc())
    ).mappings()
    return [
        {
            "district": str(row["district"]),
            "street": row["street"],
            "community_name": str(row["community_name"]),
            "house_count": int(row["house_count"] or 0),
            "avg_price": float(row["avg_price"] or 0.0),
        }
        for row in rows
    ]


@app.get("/api/summary", response_model=SummaryOut)
def summary(db: Session = Depends(get_db)):
    districts = db.scalars(select(DistrictMetric)).all()
    categories = db.scalars(select(PoiCategoryMetric).order_by(PoiCategoryMetric.count.desc())).all()
    price_top10 = sorted(districts, key=lambda x: x.avg_price, reverse=True)[:10]
    shopping_top5 = sorted(districts, key=lambda x: x.shopping_count, reverse=True)[:5]
    score_ranking = sorted(districts, key=lambda x: x.calibrated_score_life_circle, reverse=True)
    return {
        "districts": districts,
        "poi_categories": categories,
        "price_top10": price_top10,
        "shopping_top5": shopping_top5,
        "score_ranking": score_ranking,
        "scatter": districts,
        "recommendations": [item for item in score_ranking if item.house_count >= 50][:5],
    }


@app.get("/api/amap/shanghai-districts")
def shanghai_district_boundaries() -> dict:
    return {"districts": fetch_shanghai_district_boundaries()}


@app.get("/api/amap/shanghai-streets")
def shanghai_street_boundaries() -> dict:
    return {"streets": fetch_local_shanghai_street_boundaries()}


@app.post("/api/ai/advice", response_model=AIAdviceOut)
def ai_advice(payload: AIAdviceRequest, db: Session = Depends(get_db)):
    district = payload.district
    if district:
        metric = db.get(DistrictMetric, district)
    else:
        metric = db.scalars(select(DistrictMetric).order_by(DistrictMetric.calibrated_score_life_circle.desc())).first()
    if not metric:
        raise HTTPException(status_code=404, detail="district not found")
    prompt, advice, is_placeholder = generate_ai_advice(metric)
    return {
        "district": metric.district,
        "prompt": prompt,
        "advice": advice,
        "is_placeholder": is_placeholder,
    }


@app.post("/api/ai/chart-insight", response_model=ChartInsightOut)
def chart_insight(payload: ChartInsightRequest):
    insight, is_placeholder = generate_chart_insight(payload)
    return {
        "chart_id": payload.chart_id,
        "insight": insight,
        "is_placeholder": is_placeholder,
    }


@app.post("/api/agent/recommend-houses", response_model=HouseRecommendResponse)
def agent_recommend_houses(payload: HouseRecommendRequest, db: Session = Depends(get_db)):
    return recommend_houses(payload, db)


@app.get("/api/pois/heatmap")
def pois_heatmap(category: str = "all", db: Session = Depends(get_db)):
    statement = select(PoiPoint.gcj02_lng, PoiPoint.gcj02_lat, PoiPoint.category, PoiPoint.supply_weight)
    if category != "all":
        statement = statement.where(PoiPoint.category == category)
    rows = db.execute(statement).all()
    return {
        "points": [
            {"lng": row[0], "lat": row[1], "category": row[2], "weight": row[3] or 1.0}
            for row in rows
        ]
    }


@app.get("/api/houses/heatmap")
def houses_heatmap(db: Session = Depends(get_db)):
    rows = db.execute(
        select(HouseListing.gcj02_lng, HouseListing.gcj02_lat, HouseListing.unit_price)
    ).all()
    return {
        "points": [
            {"lng": row[0], "lat": row[1], "unit_price": row[2]}
            for row in rows
        ]
    }


def main() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
