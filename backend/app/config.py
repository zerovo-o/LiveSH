from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
DATA_DIR = ROOT_DIR / "data"

load_dotenv(BACKEND_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'livability.db'}")
AMAP_WEB_SERVICE_KEY = os.getenv("AMAP_WEB_SERVICE_KEY", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
_llm_rerank_raw = os.getenv("LLM_RERANK_ENABLED", "").strip().lower()
if _llm_rerank_raw:
    LLM_RERANK_ENABLED = _llm_rerank_raw in {"1", "true", "yes", "on"}
else:
    LLM_RERANK_ENABLED = bool(LLM_API_KEY and LLM_BASE_URL and LLM_MODEL)
LLM_RERANK_WEIGHT = float(os.getenv("LLM_RERANK_WEIGHT", "0.3"))
LLM_RERANK_TIMEOUT_SEC = int(os.getenv("LLM_RERANK_TIMEOUT_SEC", "60"))
LLM_RERANK_MAX_CANDIDATES = int(os.getenv("LLM_RERANK_MAX_CANDIDATES", "12"))
