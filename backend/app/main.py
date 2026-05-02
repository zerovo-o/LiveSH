from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from .ai_advice import generate_ai_advice
from .amap import fetch_shanghai_district_boundaries
from .database import Base, engine, get_db
from .models import DistrictMetric, PoiCategoryMetric
from .schemas import AIAdviceOut, AIAdviceRequest, DistrictMetricOut, PoiCategoryOut, SummaryOut

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
    return db.scalars(select(DistrictMetric).order_by(DistrictMetric.livability_score.desc())).all()


@app.get("/api/districts/{district}", response_model=DistrictMetricOut)
def get_district(district: str, db: Session = Depends(get_db)):
    item = db.get(DistrictMetric, district)
    if not item:
        raise HTTPException(status_code=404, detail="district not found")
    return item


@app.get("/api/summary", response_model=SummaryOut)
def summary(db: Session = Depends(get_db)):
    districts = db.scalars(select(DistrictMetric)).all()
    categories = db.scalars(select(PoiCategoryMetric).order_by(PoiCategoryMetric.count.desc())).all()
    price_top10 = sorted(districts, key=lambda x: x.avg_price, reverse=True)[:10]
    shopping_top5 = sorted(districts, key=lambda x: x.shopping_count, reverse=True)[:5]
    score_ranking = sorted(districts, key=lambda x: x.livability_score, reverse=True)
    return {
        "districts": districts,
        "poi_categories": categories,
        "price_top10": price_top10,
        "shopping_top5": shopping_top5,
        "score_ranking": score_ranking,
        "scatter": districts,
        "recommendations": score_ranking[:3],
    }


@app.get("/api/amap/shanghai-districts")
def shanghai_district_boundaries() -> dict:
    return {"districts": fetch_shanghai_district_boundaries()}


@app.post("/api/ai/advice", response_model=AIAdviceOut)
def ai_advice(payload: AIAdviceRequest, db: Session = Depends(get_db)):
    district = payload.district
    if district:
        metric = db.get(DistrictMetric, district)
    else:
        metric = db.scalars(select(DistrictMetric).order_by(DistrictMetric.livability_score.desc())).first()
    if not metric:
        raise HTTPException(status_code=404, detail="district not found")
    prompt, advice, is_placeholder = generate_ai_advice(metric)
    return {
        "district": metric.district,
        "prompt": prompt,
        "advice": advice,
        "is_placeholder": is_placeholder,
    }


def main() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
