from __future__ import annotations

from .models import DistrictMetric


def _display_score(metric: DistrictMetric, field: str) -> float:
    value = getattr(metric, f"{field}_display", None)
    if value is not None:
        return float(value)
    raw = getattr(metric, field, 0.0)
    return float(raw) * 10


def build_livability_prompt(metric: DistrictMetric) -> str:
    return f"""你是一个城市空间分析助手。请基于以下上海区级指标，给出面向普通公众的居住建议。

区域：{metric.district}
平均挂牌单价：{metric.avg_price:.0f} 元/㎡
平均挂牌总价：{metric.avg_total_price:.1f} 万
房源数量：{metric.house_count}
POI 总数：{metric.poi_total}
购物 POI：{metric.shopping_count}
交通 POI：{metric.traffic_count}
医疗 POI：{metric.healthcare_count}
休闲娱乐 POI：{metric.recreation_count}
公司企业 POI：{metric.company_count}
住宅 POI：{metric.residence_count}
商圈活跃度：{metric.business_activity:.2f}
房价标准化：{metric.price_norm:.3f}
活跃度标准化：{metric.activity_norm:.3f}
稳健评分：{_display_score(metric, "livability_score_v2"):.1f}
服务分：{_display_score(metric, "service_score"):.1f}
活力分：{_display_score(metric, "vitality_score"):.1f}
房价负担分：{_display_score(metric, "affordability_score"):.1f}
可达性分：{_display_score(metric, "access_score"):.1f}
性价比分：{_display_score(metric, "value_score"):.1f}
设施供需充足度：{_display_score(metric, "e2sfca_access_score"):.1f}
校准评分：{_display_score(metric, "calibrated_score"):.1f}
生活圈校准评分：{_display_score(metric, "calibrated_score_life_circle"):.1f}
样本可信度：{metric.sample_reliability_score * 100:.1f}%

请输出：
1. 一句话结论
2. 主要优势
3. 可能短板
4. 适合人群
5. 需要谨慎解释的数据局限
"""


def generate_ai_advice(metric: DistrictMetric) -> tuple[str, str, bool]:
    prompt = build_livability_prompt(metric)
    advice = build_placeholder_advice(metric)
    return prompt, advice, True


def build_placeholder_advice(metric: DistrictMetric) -> str:
    display_score = _display_score(metric, "calibrated_score_life_circle")
    affordability_score = _display_score(metric, "affordability_score")
    score_desc = "较高" if display_score >= 6.5 else "偏低"
    activity_desc = "配套活跃" if metric.activity_norm >= 0.5 else "配套活跃度一般"
    price_desc = "房价负担较友好" if affordability_score >= 5 else "房价负担压力较高"
    reliability_desc = "样本较充分" if metric.sample_reliability_score >= 1 else "样本不足，评分已降权"
    return (
        f"{metric.district} 当前校准评分 {display_score:.1f} 分，整体{score_desc}，呈现“{activity_desc}、{price_desc}”的特征。"
        f"该区域 POI 总量为 {metric.poi_total:,}，购物、交通、医疗与休闲等设施共同影响商圈活跃度。"
        f"当前模型提示：{reliability_desc}。"
        "后续接入大模型后，可基于同一组指标生成更自然的分点建议、适合人群和风险提示。"
    )
