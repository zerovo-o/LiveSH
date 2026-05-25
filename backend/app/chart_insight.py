from __future__ import annotations

import json
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import certifi

from .config import DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from .schemas import ChartInsightRequest


def generate_chart_insight(payload: ChartInsightRequest) -> tuple[str, bool]:
    if not DEEPSEEK_API_KEY:
        return build_placeholder_insight(payload), True

    prompt = build_chart_prompt(payload)
    request_body = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是城市居住数据分析助手。请只基于用户提供的图表标题、说明和数据生成结论，"
                    "语言面向可视化看板用户，避免编造未给出的数值。"
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.35,
        "max_tokens": 800,
    }
    endpoint = f"{DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
    req = Request(
        endpoint,
        data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        context = ssl.create_default_context(cafile=certifi.where())
        with urlopen(req, timeout=45, context=context) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return build_placeholder_insight(payload), True

    content = (
        result.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    return content or build_placeholder_insight(payload), not bool(content)


def build_chart_prompt(payload: ChartInsightRequest) -> str:
    data_json = json.dumps(payload.data, ensure_ascii=False, indent=2)
    scope = payload.scope or "未注明"
    selected = payload.selected_district or "未选中具体区域"
    return f"""请为下面这张可视化图表生成一段中文数据结论。

图表标题：{payload.title}
图表说明：{payload.description or "无"}
分析范围：{scope}
当前选中区域：{selected}
图表数据：
{data_json}

要求：
1. 输出一个自然段，约 150 到 220 个中文字符，必须写完整句子，不要在最后留下未完成的短语。
2. 风格接近课程数据分析报告，不要分点，不要写“根据图表可知”这类空话。
3. 必须点出核心比较关系、异常或排名含义；如果有全市均值，请结合均值解释。
4. 不要输出 Markdown，不要列标题。
"""


def build_placeholder_insight(payload: ChartInsightRequest) -> str:
    selected = f"，当前选中区域为{payload.selected_district}" if payload.selected_district else ""
    scope = f"，分析范围为{payload.scope}" if payload.scope else ""
    highlights = summarize_payload(payload.data)
    return (
        f"{payload.title}呈现了该模块的核心指标分布{scope}{selected}。"
        f"{highlights}"
        "由于 DeepSeek API Key 尚未配置或接口暂不可用，当前为本地兜底结论；配置后将结合图表数据生成更完整的自然语言分析。"
    )


def summarize_payload(data: dict[str, Any]) -> str:
    if "top" in data and isinstance(data["top"], list) and data["top"]:
        first = data["top"][0]
        name = first.get("district") or first.get("name") or "首位对象"
        value = first.get("value")
        return f"其中{name}位于前列，指标值约为{value}，说明其在当前维度上具有较强代表性。"
    if "selected" in data and "city_average" in data:
        return "选中区域与全市均值的对比显示，不同评分维度之间存在一定差异，需要结合资源配置、便利性与成本压力综合判断。"
    if "bins" in data:
        return "评分区间分布能够帮助识别高分与低分区域的集中程度，适合用于观察城市空间便利性的梯度变化。"
    return "图表中的指标变化可用于判断区域之间在价格、设施、可达性或评分模型上的相对差异。"
