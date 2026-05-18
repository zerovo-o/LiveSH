from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from .config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    LLM_RERANK_ENABLED,
    LLM_RERANK_MAX_CANDIDATES,
    LLM_RERANK_TIMEOUT_SEC,
)


@dataclass
class RerankItem:
    item_id: str
    llm_score: float
    confidence: float
    reason: str


@dataclass
class RerankResult:
    applied: bool
    items: dict[str, RerankItem]
    latency_ms: int
    error: str | None = None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _llm_ready() -> bool:
    return bool(LLM_RERANK_ENABLED and LLM_API_KEY and LLM_BASE_URL and LLM_MODEL)


def _extract_json_block(text: str) -> str | None:
    value = text.strip()
    if not value:
        return None
    if value.startswith("{") and value.endswith("}"):
        return value
    start = value.find("{")
    end = value.rfind("}")
    if start >= 0 and end > start:
        return value[start : end + 1]
    return None


def _post_chat_completion(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    endpoint = urljoin(LLM_BASE_URL.rstrip("/") + "/", "chat/completions")
    request = Request(
        endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LLM_API_KEY}",
        },
        method="POST",
    )
    started = time.time()
    with urlopen(request, timeout=LLM_RERANK_TIMEOUT_SEC) as response:
        payload = json.loads(response.read().decode("utf-8"))
    latency_ms = int((time.time() - started) * 1000)
    return payload, latency_ms


def _parse_items(payload: dict[str, Any], id_key: str) -> dict[str, RerankItem]:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        return {}
    parsed: dict[str, RerankItem] = {}
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get(id_key) or "").strip()
        if not item_id:
            continue
        try:
            llm_score = _clamp(float(item.get("llm_score", 0.5)))
            confidence = _clamp(float(item.get("confidence", 0.5)))
        except (TypeError, ValueError):
            continue
        reason = str(item.get("reason") or "").strip()
        parsed[item_id] = RerankItem(
            item_id=item_id,
            llm_score=llm_score,
            confidence=confidence,
            reason=reason,
        )
    return parsed


def _rerank_common(
    *,
    task_name: str,
    id_key: str,
    context: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> RerankResult:
    if not _llm_ready():
        return RerankResult(applied=False, items={}, latency_ms=0, error="llm_rerank_disabled_or_missing_config")

    trimmed = candidates[: max(1, min(LLM_RERANK_MAX_CANDIDATES, len(candidates)))]
    if not trimmed:
        return RerankResult(applied=False, items={}, latency_ms=0, error="empty_candidates")

    system_prompt = (
        "你是上海住房推荐评估助手。你只能做软重排，不可推翻规则分。"
        "请仅返回严格 JSON，格式："
        "{\"items\":[{\""
        + id_key
        + "\":\"...\",\"llm_score\":0.0,\"confidence\":0.0,\"reason\":\"...\"}]}"
        "llm_score 和 confidence 范围必须在 [0,1]。reason 20-60 中文字。"
    )
    user_payload = {
        "task": task_name,
        "context": context,
        "candidates": trimmed,
        "requirements": {
            "output_json_only": True,
            "score_range": [0, 1],
            "confidence_range": [0, 1],
            "reason_length_hint": "20-60 Chinese chars",
        },
    }
    body = {
        "model": LLM_MODEL,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
    }
    try:
        raw, latency_ms = _post_chat_completion(body)
        choices = raw.get("choices") or []
        content = ""
        if choices:
            content = str((choices[0].get("message") or {}).get("content") or "").strip()
        json_block = _extract_json_block(content)
        if not json_block:
            return RerankResult(applied=False, items={}, latency_ms=latency_ms, error="llm_non_json_output")
        parsed_payload = json.loads(json_block)
        parsed_items = _parse_items(parsed_payload, id_key=id_key)
        if not parsed_items:
            return RerankResult(applied=False, items={}, latency_ms=latency_ms, error="llm_empty_or_invalid_items")
        return RerankResult(applied=True, items=parsed_items, latency_ms=latency_ms, error=None)
    except Exception as exc:  # noqa: BLE001
        return RerankResult(applied=False, items={}, latency_ms=0, error=f"llm_rerank_failed:{exc}")


def rerank_house_candidates(
    *,
    work_address: str,
    commute_mode: str,
    max_commute_minutes: float,
    affordable_unit_price: float,
    candidates: list[dict[str, Any]],
) -> RerankResult:
    context = {
        "work_address": work_address,
        "commute_mode": commute_mode,
        "max_commute_minutes": max_commute_minutes,
        "affordable_unit_price": affordable_unit_price,
    }
    return _rerank_common(
        task_name="house_rerank",
        id_key="house_id",
        context=context,
        candidates=candidates,
    )


def rerank_community_candidates(
    *,
    work_address: str,
    commute_mode: str,
    max_commute_minutes: float,
    budget_wan: float,
    candidates: list[dict[str, Any]],
) -> RerankResult:
    context = {
        "work_address": work_address,
        "commute_mode": commute_mode,
        "max_commute_minutes": max_commute_minutes,
        "budget_wan": budget_wan,
    }
    return _rerank_common(
        task_name="community_rerank",
        id_key="community_id",
        context=context,
        candidates=candidates,
    )

