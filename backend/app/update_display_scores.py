from __future__ import annotations

import math
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterable


DISPLAY_FIELDS = [
    "livability_score",
    "affordability_score",
    "service_score",
    "vitality_score",
    "livability_score_v2",
    "access_score",
    "value_score",
    "e2sfca_access_score",
    "e2sfca_value_score",
    "calibrated_score",
    "life_circle_5min_score",
    "life_circle_10min_score",
    "life_circle_15min_score",
    "life_circle_score",
    "calibrated_score_life_circle",
]

LINEAR_FIELDS = [
    "affordability_score",
    "service_score",
    "vitality_score",
    "livability_score_v2",
    "access_score",
    "value_score",
    "e2sfca_access_score",
    "e2sfca_value_score",
    "life_circle_5min_score",
    "life_circle_10min_score",
    "life_circle_15min_score",
    "life_circle_score",
]

ROBUST_SIGMOID_FIELDS = [
    "livability_score",
    "calibrated_score",
    "calibrated_score_life_circle",
]

TABLES = {
    "district_metrics": "district",
    "street_metrics": "id",
}

TEMPERATURE = 1.5
EPSILON = 1e-6


def clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def sigmoid(value: float) -> float:
    if value >= 0:
        exp_value = math.exp(-value)
        return 1 / (1 + exp_value)
    exp_value = math.exp(value)
    return exp_value / (1 + exp_value)


def percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    index = (len(sorted_values) - 1) * p
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return sorted_values[low]
    return sorted_values[low] * (high - index) + sorted_values[high] * (index - low)


def robust_stats(values: Iterable[float | None]) -> tuple[float, float]:
    sorted_values = sorted(value for value in values if value is not None and math.isfinite(value))
    if not sorted_values:
        return 0.0, 1.0
    median = percentile(sorted_values, 0.5)
    q25 = percentile(sorted_values, 0.25)
    q75 = percentile(sorted_values, 0.75)
    iqr = max(q75 - q25, EPSILON)
    return median, iqr


def linear_display(raw: float | None) -> float | None:
    if raw is None or not math.isfinite(raw):
        return None
    return round(clamp(raw * 10, 0, 10), 4)


def robust_sigmoid_display(raw: float | None, median: float, iqr: float) -> float | None:
    if raw is None or not math.isfinite(raw):
        return None
    z = (raw - median) / max(iqr, EPSILON)
    return round(clamp(4 + 5 * sigmoid(z / TEMPERATURE), 4, 9), 4)


def db_path() -> Path:
    return Path(__file__).resolve().parents[1] / "livability.db"


def backup_database(path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = path.with_name(f"{path.name}.before_display_scores_{timestamp}.bak")
    shutil.copy2(path, backup_path)
    return backup_path


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def ensure_display_columns(connection: sqlite3.Connection, table: str) -> None:
    columns = table_columns(connection, table)
    for field in DISPLAY_FIELDS:
        display_field = f"{field}_display"
        if display_field not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {display_field} FLOAT")


def update_table(connection: sqlite3.Connection, table: str, key_field: str) -> None:
    ensure_display_columns(connection, table)
    select_fields = [key_field, *DISPLAY_FIELDS]
    rows = connection.execute(f"SELECT {', '.join(select_fields)} FROM {table}").fetchall()
    if not rows:
        return

    field_index = {field: index + 1 for index, field in enumerate(DISPLAY_FIELDS)}
    stats = {
        field: robust_stats(row[field_index[field]] for row in rows)
        for field in ROBUST_SIGMOID_FIELDS
    }

    update_fields = [f"{field}_display" for field in DISPLAY_FIELDS]
    set_clause = ", ".join(f"{field} = ?" for field in update_fields)
    sql = f"UPDATE {table} SET {set_clause} WHERE {key_field} = ?"

    payload = []
    for row in rows:
        values: list[float | None] = []
        for field in DISPLAY_FIELDS:
            raw = row[field_index[field]]
            if field in LINEAR_FIELDS:
                values.append(linear_display(raw))
            else:
                median, iqr = stats[field]
                values.append(robust_sigmoid_display(raw, median, iqr))
        payload.append((*values, row[0]))
    connection.executemany(sql, payload)


def update_display_scores(path: Path | None = None, backup: bool = True) -> None:
    database_path = path or db_path()
    if not database_path.exists():
        raise FileNotFoundError(f"Database not found: {database_path}")
    if backup:
        backup_path = backup_database(database_path)
        print(f"Backed up database to {backup_path}")

    with sqlite3.connect(database_path) as connection:
        for table, key_field in TABLES.items():
            update_table(connection, table, key_field)
        connection.commit()
    print("Display score columns updated.")


def main() -> None:
    update_display_scores()


if __name__ == "__main__":
    main()
