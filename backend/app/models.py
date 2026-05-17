from __future__ import annotations

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class HouseListing(Base):
    __tablename__ = "house_listings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    house_id: Mapped[str | None] = mapped_column(String(80), index=True)
    district: Mapped[str] = mapped_column(String(32), index=True)
    street: Mapped[str | None] = mapped_column(String(64), index=True)
    price: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float)
    wgs84_lng: Mapped[float] = mapped_column(Float)
    wgs84_lat: Mapped[float] = mapped_column(Float)
    gcj02_lng: Mapped[float] = mapped_column(Float)
    gcj02_lat: Mapped[float] = mapped_column(Float)


class PoiPoint(Base):
    __tablename__ = "poi_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    uid: Mapped[str | None] = mapped_column(String(96), index=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(24), index=True)
    source: Mapped[str] = mapped_column(String(64), index=True)
    district: Mapped[str] = mapped_column(String(32), index=True)
    street: Mapped[str | None] = mapped_column(String(64), index=True)
    tag: Mapped[str | None] = mapped_column(String(160))
    wgs84_lng: Mapped[float | None] = mapped_column(Float)
    wgs84_lat: Mapped[float | None] = mapped_column(Float)
    gcj02_lng: Mapped[float] = mapped_column(Float)
    gcj02_lat: Mapped[float] = mapped_column(Float)


class DistrictMetric(Base):
    __tablename__ = "district_metrics"

    district: Mapped[str] = mapped_column(String(32), primary_key=True)
    avg_price: Mapped[float] = mapped_column(Float)
    avg_total_price: Mapped[float] = mapped_column(Float)
    house_count: Mapped[int] = mapped_column(Integer)
    poi_total: Mapped[int] = mapped_column(Integer)
    recreation_count: Mapped[int] = mapped_column(Integer)
    company_count: Mapped[int] = mapped_column(Integer)
    residence_count: Mapped[int] = mapped_column(Integer)
    shopping_count: Mapped[int] = mapped_column(Integer)
    traffic_count: Mapped[int] = mapped_column(Integer)
    healthcare_count: Mapped[int] = mapped_column(Integer)
    business_activity: Mapped[float] = mapped_column(Float)
    activity_norm: Mapped[float] = mapped_column(Float)
    price_norm: Mapped[float] = mapped_column(Float)
    livability_score: Mapped[float] = mapped_column(Float, index=True)
    center_lng: Mapped[float | None] = mapped_column(Float)
    center_lat: Mapped[float | None] = mapped_column(Float)


class StreetMetric(Base):
    __tablename__ = "street_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    district: Mapped[str] = mapped_column(String(32), index=True)
    street: Mapped[str] = mapped_column(String(64), index=True)
    avg_price: Mapped[float] = mapped_column(Float)
    avg_total_price: Mapped[float] = mapped_column(Float)
    house_count: Mapped[int] = mapped_column(Integer)
    poi_total: Mapped[int] = mapped_column(Integer)
    recreation_count: Mapped[int] = mapped_column(Integer)
    company_count: Mapped[int] = mapped_column(Integer)
    residence_count: Mapped[int] = mapped_column(Integer)
    shopping_count: Mapped[int] = mapped_column(Integer)
    traffic_count: Mapped[int] = mapped_column(Integer)
    healthcare_count: Mapped[int] = mapped_column(Integer)
    business_activity: Mapped[float] = mapped_column(Float)
    activity_norm: Mapped[float] = mapped_column(Float)
    price_norm: Mapped[float] = mapped_column(Float)
    livability_score: Mapped[float] = mapped_column(Float, index=True)
    center_lng: Mapped[float | None] = mapped_column(Float)
    center_lat: Mapped[float | None] = mapped_column(Float)


class PoiCategoryMetric(Base):
    __tablename__ = "poi_category_metrics"

    category: Mapped[str] = mapped_column(String(24), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
