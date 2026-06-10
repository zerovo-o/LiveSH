from __future__ import annotations

import argparse
from pathlib import Path

from sqlalchemy import delete, select

from .config import DATA_DIR
from .database import Base, SessionLocal, engine
from .models import RouteLifeCircleMetric, StreetMetric
from .route_life_circle import build_route_metric_records

DEFAULT_DISTRICTS = ("yangpu", "huangpu", "jiading")


def ingest_route_life_circle(districts: tuple[str, ...] = DEFAULT_DISTRICTS) -> dict[str, int]:
    Base.metadata.create_all(bind=engine)
    with SessionLocal.begin() as db:
        reference_values = db.scalars(select(StreetMetric.calibrated_score_life_circle)).all()
        counts: dict[str, int] = {}
        for district in districts:
            rows = build_route_metric_records(district, reference_values)
            if not rows:
                counts[district] = 0
                continue
            district_names = {row["district"] for row in rows}
            db.execute(delete(RouteLifeCircleMetric).where(RouteLifeCircleMetric.district.in_(district_names)))
            db.bulk_insert_mappings(RouteLifeCircleMetric, rows)
            counts[district] = len(rows)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Import route life-circle CSV outputs into livability.db.")
    parser.add_argument(
        "--district",
        action="append",
        choices=DEFAULT_DISTRICTS,
        help="District slug to import. Repeat for multiple districts. Defaults to yangpu, huangpu, jiading.",
    )
    parser.add_argument(
        "--data-dir",
        default=str(DATA_DIR),
        help="Reserved for consistency with other data scripts. Route CSV paths use app config DATA_DIR.",
    )
    args = parser.parse_args()
    Path(args.data_dir)
    counts = ingest_route_life_circle(tuple(args.district or DEFAULT_DISTRICTS))
    for district, count in counts.items():
        print(f"{district}: imported {count} route life-circle rows")


if __name__ == "__main__":
    main()
