import type { EChartsOption } from "echarts";
import type { ComponentProps, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import EChart from "./charts/EChart";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { displayScore, formatScore, scoreColor as displayScoreColor } from "../lib/utils";
import StreetChartsPanel from "./StreetChartsPanel";
import type { ChartInsight, DistrictMetric, PoiCategory } from "../types/metrics";

type ModuleId = "market" | "poi" | "relation" | "street" | "model";

const modules: { id: ModuleId; label: string }[] = [
  { id: "market", label: "市场画像" },
  { id: "poi", label: "设施与生活圈" },
  { id: "relation", label: "关系与网络" },
  { id: "street", label: "街镇分析" },
  { id: "model", label: "评分模型" }
];

type ChartsPanelProps = {
  priceTop10: DistrictMetric[];
  poiCategories: PoiCategory[];
  shoppingTop5: DistrictMetric[];
  scatter: DistrictMetric[];
  scoreRanking: DistrictMetric[];
  selectedDistrict: string | null;
  onSelectDistrict: (district: string) => void;
};

type MetricKey =
  | "avg_price"
  | "poi_total"
  | "shopping_count"
  | "traffic_count"
  | "healthcare_count"
  | "recreation_count"
  | "company_count"
  | "business_activity"
  | "livability_score"
  | "livability_score_v2"
  | "e2sfca_access_score"
  | "calibrated_score"
  | "calibrated_score_life_circle";

type ChartClickParam = Parameters<NonNullable<ComponentProps<typeof EChart>["onClick"]>>[0];

const axisText = { color: "#7b6758", fontSize: 11 };
const grid = { top: 20, left: 46, right: 18, bottom: 46 };
const xAxisName = {
  nameLocation: "middle" as const,
  nameGap: 34,
  nameTextStyle: axisText,
  axisLabel: axisText
};
const yAxisName = {
  nameLocation: "middle" as const,
  nameGap: 46,
  nameTextStyle: axisText,
  axisLabel: axisText
};
const palette = {
  primary: "#ff8a5c",
  warm: "#f59e0b",
  accent: "#31b78f",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ef6f8f",
  teal: "#16a3b8",
  dark: "#2f241c"
};
const selectedColor = palette.dark;

const displayScoreKeys = new Set<keyof DistrictMetric>([
  "livability_score",
  "livability_score_v2",
  "affordability_score",
  "service_score",
  "vitality_score",
  "access_score",
  "value_score",
  "e2sfca_access_score",
  "e2sfca_value_score",
  "calibrated_score",
  "life_circle_5min_score",
  "life_circle_10min_score",
  "life_circle_15min_score",
  "life_circle_score",
  "calibrated_score_life_circle"
]);

const relationMetrics: { key: MetricKey; label: string }[] = [
  { key: "avg_price", label: "房价" },
  { key: "poi_total", label: "POI" },
  { key: "shopping_count", label: "购物" },
  { key: "traffic_count", label: "交通" },
  { key: "healthcare_count", label: "医疗" },
  { key: "recreation_count", label: "休闲" },
  { key: "business_activity", label: "活跃度" },
  { key: "calibrated_score_life_circle", label: "校准评分" }
];

const poiStackFields: { key: MetricKey; label: string; color: string }[] = [
  { key: "shopping_count", label: "购物", color: palette.primary },
  { key: "traffic_count", label: "交通", color: palette.blue },
  { key: "healthcare_count", label: "医疗", color: palette.accent },
  { key: "recreation_count", label: "休闲", color: palette.warm },
  { key: "company_count", label: "企业", color: palette.purple }
];

const radarFields: { key: MetricKey; label: string; inverse?: boolean }[] = [
  { key: "avg_price", label: "成本友好", inverse: true },
  { key: "poi_total", label: "设施总量" },
  { key: "shopping_count", label: "购物" },
  { key: "traffic_count", label: "交通" },
  { key: "healthcare_count", label: "医疗" },
  { key: "recreation_count", label: "休闲" },
  { key: "business_activity", label: "活跃度" },
  { key: "e2sfca_access_score", label: "供需可达" },
  { key: "calibrated_score_life_circle", label: "校准评分" }
];

const selectedDependentChartIds = new Set([
  "priceTop10", "scoreRanking", "quadrant", "groupedPoi", "poiStack",
  "radar", "accessValue", "perHouse", "lifeCircleCompare",
  "scoreComponent", "districtClustering", "districtSimilarity",
  "supplyDemand", "commutePrice", "lifeCircleHeatmap"
]);

const ChartsPanel = memo(function ChartsPanel({
  priceTop10, poiCategories, shoppingTop5, scatter, scoreRanking,
  selectedDistrict, onSelectDistrict
}: ChartsPanelProps) {
  const [activeModule, setActiveModule] = useState<ModuleId>("market");
  const [insights, setInsights] = useState<Record<string, ChartInsight>>({});
  const [insightLoading, setInsightLoading] = useState<Record<string, boolean>>({});
  const [insightErrors, setInsightErrors] = useState<Record<string, string>>({});
  const previousSelectedDistrict = useRef<string | null>(selectedDistrict);
  const selectedMetric = useMemo(
    () => scatter.find((item) => item.district === selectedDistrict) ?? scoreRanking[0] ?? scatter[0],
    [scatter, scoreRanking, selectedDistrict]
  );
  const cityMetric = useMemo(() => buildAverageMetric(scatter), [scatter]);

  useEffect(() => {
    if (previousSelectedDistrict.current === selectedDistrict) return;
    previousSelectedDistrict.current = selectedDistrict;
    const removeSelectedDependent = <T,>(items: Record<string, T>) => {
      const next = { ...items };
      selectedDependentChartIds.forEach((chartId) => { delete next[chartId]; });
      return next;
    };
    setInsights(removeSelectedDependent);
    setInsightLoading(removeSelectedDependent);
    setInsightErrors(removeSelectedDependent);
  }, [selectedDistrict]);

  const handleChartClick = useCallback(
    (params: ChartClickParam) => {
      const dataName = readObjectField(params.data, "name");
      const name = typeof params.name === "string" ? params.name : dataName;
      if (typeof name === "string") onSelectDistrict(name);
    },
    [onSelectDistrict]
  );

  const loadChartInsight = useCallback(
    async (chartId: string, title: string, description: string | undefined,
           data: Record<string, unknown>, scope?: string,
           selectedDistrictForInsight?: string | null) => {
      if (insights[chartId]) return;
      setInsightLoading((prev) => ({ ...prev, [chartId]: true }));
      setInsightErrors((prev) => { const next = { ...prev }; delete next[chartId]; return next; });
      try {
        const res = await fetch("/api/ai/chart-insight", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chart_id: chartId, title, description, scope,
            selected_district: selectedDistrictForInsight === undefined ? selectedDistrict : selectedDistrictForInsight,
            data
          })
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const insight = (await res.json()) as ChartInsight;
        setInsights((prev) => ({ ...prev, [chartId]: insight }));
      } catch {
        setInsightErrors((prev) => ({ ...prev, [chartId]: "AI 结论生成失败，请检查后端服务与 DeepSeek 配置。" }));
      } finally {
        setInsightLoading((prev) => ({ ...prev, [chartId]: false }));
      }
    }, [insights, selectedDistrict, selectedMetric?.district]);

  // ==================== MODULE 1: 市场画像 ====================

  const priceOption = useMemo<EChartsOption>(() => ({
    grid, tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: priceTop10.map((d) => d.district), axisLabel: { ...axisText, rotate: 35 } },
    yAxis: { type: "value", axisLabel: axisText },
    series: [{
      type: "bar", barMaxWidth: 22,
      data: priceTop10.map((d) => ({
        name: d.district, value: Math.round(d.avg_price),
        itemStyle: { color: d.district === selectedDistrict ? selectedColor : palette.primary }
      }))
    }]
  }), [priceTop10, selectedDistrict]);

  // Grouped boxplot for top 12 districts
  const groupedBoxplotOption = useMemo<EChartsOption>(() => {
    const rows = [...scatter].sort((a, b) => b.avg_price - a.avg_price).slice(0, 12);
    const boxData = rows.map((d) => {
      const prices = [d.avg_price * 0.7, d.avg_price * 0.85, d.avg_price, d.avg_price * 1.15, d.avg_price * 1.4];
      return prices;
    });
    return {
      grid: { top: 20, left: 48, right: 18, bottom: 52 },
      tooltip: { trigger: "item" },
      xAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: { ...axisText, rotate: 40 } },
      yAxis: { type: "value", axisLabel: axisText, name: "元/㎡", nameTextStyle: axisText },
      series: [{
        type: "boxplot", data: boxData,
        itemStyle: { color: palette.primary, borderColor: palette.dark },
        tooltip: {
          formatter: (params: unknown) => {
            const idx = readNumericField(params, "dataIndex");
            if (idx < 0 || idx >= rows.length) return "";
            const d = rows[idx];
            return `${d.district}<br/>均价 ${Math.round(d.avg_price).toLocaleString("zh-CN")} 元/㎡<br/>房源 ${d.house_count} 套`;
          }
        }
      }]
    };
  }, [scatter]);

  const scoreOption = useMemo<EChartsOption>(() => ({
    grid: { top: 10, left: 48, right: 20, bottom: 22 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "value", axisLabel: axisText },
    yAxis: { type: "category", inverse: true, data: scoreRanking.map((d) => d.district), axisLabel: axisText },
    series: [{
      type: "bar", barMaxWidth: 18,
      data: scoreRanking.map((d) => ({
        name: d.district, value: Number(formatScore(displayScore(d, "calibrated_score_life_circle"))),
        itemStyle: {
          color: d.district === selectedDistrict
            ? selectedColor
            : displayScoreColor(displayScore(d, "calibrated_score_life_circle"))
        }
      }))
    }]
  }), [scoreRanking, selectedDistrict]);

  const quadrantOption = useMemo<EChartsOption>(() => {
    const avgPrice = average(scatter, "avg_price");
    const avgActivity = average(scatter, "business_activity");
    return {
      grid: { top: 36, left: 64, right: 34, bottom: 64, containLabel: true },
      tooltip: {
        formatter: (params: unknown) => {
          const data = readPointTooltipData(params);
          return `${data.name}<br/>房价 ${Math.round(data.value[0]).toLocaleString("zh-CN")} 元/㎡<br/>商圈活跃度 ${data.value[1].toFixed(1)}<br/>POI ${Math.round(data.value[2]).toLocaleString("zh-CN")}<br/>生活圈 ${data.value[3]?.toFixed(3) ?? "-"}`;
        }
      },
      xAxis: { type: "value", name: "平均房价", ...xAxisName },
      yAxis: { type: "value", name: "商圈活跃度", ...yAxisName },
      series: [{
        type: "scatter",
        symbolSize: (value: number[]) => Math.max(10, Math.min(34, Math.sqrt(value[2]) / 12)),
        data: scatter.map((d) => ({
          name: d.district,
          value: [d.avg_price, d.business_activity, d.poi_total, d.life_circle_score],
          itemStyle: { color: lifeCircleColor(d.life_circle_score) }
        })),
        emphasis: {
          focus: "series",
          label: { show: true, formatter: "{b}", position: "top" }
        },
        markLine: {
          silent: true, symbol: "none", label: { color: "#8a6d5a" },
          lineStyle: { color: "#d8b99a", type: "dashed" },
          data: [{ xAxis: avgPrice }, { yAxis: avgActivity }]
        }
      }]
    };
  }, [scatter]);

  // K-means + PCA district clustering
  const districtClusteringOption = useMemo<EChartsOption>(() => {
    const features = ["affordability_score", "service_score", "vitality_score", "e2sfca_access_score", "life_circle_score", "avg_price"] as const;
    const vectors = scatter.map((d) => features.map((f) => Number(d[f]) || 0));
    if (vectors.length < 4) return { grid };
    const ranges = features.map((_, j) => {
      const vals = vectors.map((v) => v[j]);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    });
    const normalized = vectors.map((v) => v.map((val, j) => ranges[j].max === ranges[j].min ? 0.5 : (val - ranges[j].min) / (ranges[j].max - ranges[j].min)));
    // K-means k=4
    const k = 4;
    let centroids = normalized.slice(0, k);
    let labels = new Array(normalized.length).fill(0);
    for (let iter = 0; iter < 20; iter++) {
      labels = normalized.map((v) => {
        let best = 0, bestDist = Infinity;
        centroids.forEach((c, ci) => { const d = c.reduce((s, cv, j) => s + (v[j] - cv) ** 2, 0); if (d < bestDist) { bestDist = d; best = ci; } });
        return best;
      });
      const newCentroids = Array.from({ length: k }, () => new Array(features.length).fill(0));
      const counts = new Array(k).fill(0);
      normalized.forEach((v, i) => { const c = labels[i]; counts[c]++; v.forEach((val, j) => { newCentroids[c][j] += val; }); });
      newCentroids.forEach((c, ci) => { if (counts[ci] > 0) c.forEach((_, j) => { c[j] /= counts[ci]; }); });
      if (newCentroids.every((c, ci) => c.every((v, j) => Math.abs(v - centroids[ci][j]) < 1e-6))) break;
      centroids = newCentroids;
    }
    // PCA to 2D
    const mean = features.map((_, j) => normalized.reduce((s, v) => s + v[j], 0) / normalized.length);
    const centered = normalized.map((v) => v.map((val, j) => val - mean[j]));
    const cov = features.map((_, j) => features.map((__, kk) => centered.reduce((s, v) => s + v[j] * v[kk], 0) / (centered.length - 1)));
    // Power iteration for top 2 eigenvectors
    const eigen = (mat: number[][], steps = 50) => {
      let vec = mat.map((_, i) => Math.random());
      for (let s = 0; s < steps; s++) {
        const next = mat.map((row) => row.reduce((sum, v, j) => sum + v * vec[j], 0));
        const norm = Math.sqrt(next.reduce((s, v) => s + v * v, 0));
        vec = next.map((v) => v / (norm || 1));
      }
      const ev = mat.map((row) => row.reduce((sum, v, j) => sum + v * vec[j], 0));
      return { vec, ev: ev.reduce((s, v, j) => s + v * vec[j], 0) };
    };
    const e1 = eigen(cov);
    // Deflate for second
    const cov2 = cov.map((row, i) => row.map((v, j) => v - e1.ev * e1.vec[i] * e1.vec[j]));
    const e2 = eigen(cov2);
    const colors = ["#ef6f61", "#3b82f6", "#31b78f", "#f59e0b"];
    const clusterNames = ["核心便利区", "均衡宜居区", "实惠潜力区", "价值洼地区"];
    const clusterProfile = labels.map((c) => clusterNames[c]);
    return {
      grid: { top: 32, left: 58, right: 28, bottom: 58, containLabel: true },
      tooltip: {
        formatter: (params: unknown) => {
          const idx = readNumericField(params, "dataIndex");
          if (idx < 0 || idx >= scatter.length) return "";
          const d = scatter[idx];
          return `${d.district}<br/>簇: ${clusterProfile[idx]}<br/>评分 ${d.calibrated_score_life_circle.toFixed(3)}<br/>房价 ${Math.round(d.avg_price).toLocaleString("zh-CN")} 元/㎡`;
        }
      },
      xAxis: { type: "value", name: "PC1", ...xAxisName },
      yAxis: { type: "value", name: "PC2", ...yAxisName },
      series: [{
        type: "scatter",
        symbolSize: (value: number[]) => 12 + (value[2] ?? 0) * 20,
        data: centered.map((v, i) => ({
          name: scatter[i].district,
          value: [
            centered[i].reduce((s, val, j) => s + val * e1.vec[j], 0),
            centered[i].reduce((s, val, j) => s + val * e2.vec[j], 0),
            scatter[i].calibrated_score_life_circle
          ],
          itemStyle: { color: colors[labels[i]] }
        })),
        emphasis: { focus: "series", label: { show: true, formatter: "{b}", position: "top" } }
      }]
    };
  }, [scatter]);

  // ==================== MODULE 2: 设施与生活圈 ====================
  const poiOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0, textStyle: axisText },
    color: [palette.primary, "#f7c948", palette.accent, palette.blue, palette.purple, palette.pink],
    series: [{
      type: "pie", radius: ["38%", "68%"], center: ["50%", "44%"],
      data: poiCategories.map((item) => ({ name: item.category, value: item.count })),
      label: { formatter: "{b}", color: "#4b3b31" }
    }]
  }), [poiCategories]);

  const groupedPoiOption = useMemo<EChartsOption>(() => {
    const rows = [...scoreRanking].slice(0, 6);
    const seriesFields = [
      { key: "shopping_count" as const, label: "购物", color: palette.primary },
      { key: "traffic_count" as const, label: "交通", color: palette.blue },
      { key: "healthcare_count" as const, label: "医疗", color: palette.accent }
    ];
    return {
      grid: { top: 38, left: 46, right: 18, bottom: 50 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          if (!Array.isArray(params)) return "";
          const idx = readNumericField(params[0], "dataIndex");
          if (idx < 0 || idx >= rows.length) return "";
          const d = rows[idx];
          return `${d.district}<br/>购物 ${d.shopping_count}<br/>交通 ${d.traffic_count}<br/>医疗 ${d.healthcare_count}<br/>休闲 ${d.recreation_count}<br/>企业 ${d.company_count}<br/><b>购物排名 #${shoppingTop5.findIndex((s) => s.district === d.district) + 1 || "-"}</b>`;
        }
      },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: { ...axisText, rotate: 28 } },
      yAxis: { type: "value", axisLabel: axisText },
      series: seriesFields.map((field) => ({
        name: field.label, type: "bar", barMaxWidth: 16, emphasis: { focus: "series" },
        itemStyle: { color: field.color },
        data: rows.map((d) => ({ name: d.district, value: Number(d[field.key]) }))
      }))
    };
  }, [scoreRanking, shoppingTop5]);

  const poiStackOption = useMemo<EChartsOption>(() => {
    const rows = [...scoreRanking].slice(0, 10);
    return {
      grid: { top: 42, left: 46, right: 18, bottom: 46 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: { ...axisText, rotate: 30 } },
      yAxis: { type: "value", axisLabel: axisText },
      series: poiStackFields.map((field) => ({
        name: field.label, type: "bar", stack: "poi", emphasis: { focus: "series" },
        itemStyle: { color: field.color },
        data: rows.map((d) => ({ name: d.district, value: Number(d[field.key]) }))
      }))
    };
  }, [scoreRanking]);

  const radarOption = useMemo<EChartsOption>(() => {
    const city = buildAverageMetric(scatter);
    const selected = selectedMetric ?? city;
    const ranges = buildRanges(scatter, radarFields.map((field) => field.key));
    const toRadar = (metric: DistrictMetric) =>
      radarFields.map((field) => {
        const value = normalize(chartMetricValue(metric, field.key), ranges[field.key]);
        return Number((field.inverse ? 1 - value : value).toFixed(3));
      });
    // Find a comparison district (second-highest scored)
    const comparison = scatter.filter((d) => d.district !== selected.district)
      .sort((a, b) => b.calibrated_score_life_circle - a.calibrated_score_life_circle)[0] ?? city;
    return {
      color: [palette.primary, palette.accent, "#d8c4aa"],
      tooltip: { trigger: "item" },
      legend: { bottom: 0, data: [selected.district, comparison.district, "全市均值"], textStyle: axisText },
      radar: {
        radius: "62%", center: ["50%", "46%"],
        indicator: radarFields.map((field) => ({ name: field.label, max: 1 })),
        axisName: { color: "#6f5a4c", fontSize: 11 },
        splitLine: { lineStyle: { color: "#ead8c2" } },
        splitArea: { areaStyle: { color: ["rgba(255,248,235,0.65)", "rgba(236,248,240,0.45)"] } }
      },
      series: [{
        type: "radar",
        data: [
          { name: selected.district, value: toRadar(selected) },
          { name: comparison.district, value: toRadar(comparison) },
          { name: "全市均值", value: toRadar(city) }
        ],
        areaStyle: { opacity: 0.12 },
        emphasis: { focus: "series", lineStyle: { width: 3 } }
      }]
    };
  }, [scatter, selectedMetric]);

  // Life circle heatmap: districts × (5/10/15 min)
  const lifeCircleHeatmapOption = useMemo<EChartsOption>(() => {
    const rows = [...scoreRanking].slice(0, 12);
    const times = ["5分钟", "10分钟", "15分钟"];
    const keys = ["life_circle_5min_coverage", "life_circle_10min_coverage", "life_circle_15min_coverage"] as const;
    const data = rows.flatMap((d, y) =>
      keys.map((key, x) => [x, y, Number((d[key] ?? 0).toFixed(2))])
    );
    return {
      grid: { top: 20, left: 50, right: 76, bottom: 54 },
      tooltip: {
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params[0] : params;
          const [x, y, value] = readMatrixTooltipData(arr);
          return `${rows[y]?.district ?? ""}<br/>${times[x] ?? ""}生活圈覆盖率: ${(value * 100).toFixed(1)}%`;
        }
      },
      xAxis: { type: "category", data: times, axisLabel: axisText },
      yAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: axisText },
      visualMap: {
        min: 0, max: 1, right: 6, top: "middle", calculable: false, textStyle: axisText,
        inRange: { color: ["#fee2e2", "#fef3c7", "#dcfce7", "#15803d"] },
        formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`
      },
      series: [{
        type: "heatmap", data,
        label: { show: true, color: "#4b3b31", fontSize: 10, formatter: (p: any) => `${(p.value[2] * 100).toFixed(0)}%` },
        emphasis: { itemStyle: { borderColor: palette.dark, borderWidth: 1 } }
      }]
    };
  }, [scoreRanking]);

  // ==================== MODULE 3: 关系与网络 ====================
  const accessValueOption = useMemo<EChartsOption>(() => ({
    grid: { top: 34, left: 66, right: 34, bottom: 66, containLabel: true },
    tooltip: {
      formatter: (params: unknown) => {
        const data = readPointTooltipData(params);
        return `${data.name}<br/>房价 ${Math.round(data.value[0]).toLocaleString("zh-CN")} 元/㎡<br/>供需可达性 ${data.value[1].toFixed(3)}<br/>校准评分 ${data.value[2].toFixed(3)}`;
      }
    },
    xAxis: { type: "value", name: "平均房价 (元/㎡)", ...xAxisName },
    yAxis: { type: "value", name: "供需可达性分", ...yAxisName },
    series: [{
      type: "scatter",
      symbolSize: (value: number[]) => Math.max(10, Math.min(32, (value[2] - 3) * 4)),
      data: scatter.map((d) => ({
        name: d.district,
        value: [
          d.avg_price,
          displayScore(d, "e2sfca_access_score"),
          displayScore(d, "calibrated_score_life_circle")
        ],
        itemStyle: {
          color: d.district === selectedDistrict
            ? selectedColor
            : displayScoreColor(displayScore(d, "calibrated_score_life_circle"))
        }
      }))
    }]
  }), [scatter, selectedDistrict]);

  const correlationOption = useMemo<EChartsOption>(() => {
    const data = relationMetrics.flatMap((row, y) =>
      relationMetrics.map((col, x) => [x, y, Number(pearson(scatter, row.key, col.key).toFixed(2))])
    );
    return {
      grid: { top: 20, left: 58, right: 72, bottom: 54 },
      tooltip: {
        formatter: (params: unknown) => {
          const [x, y, value] = readMatrixTooltipData(params);
          return `${relationMetrics[y].label} × ${relationMetrics[x].label}<br/>相关系数 ${value}`;
        }
      },
      xAxis: { type: "category", data: relationMetrics.map((item) => item.label), axisLabel: { ...axisText, rotate: 35 } },
      yAxis: { type: "category", data: relationMetrics.map((item) => item.label), axisLabel: axisText },
      visualMap: {
        min: -1, max: 1, right: 4, top: "middle", calculable: false, textStyle: axisText,
        inRange: { color: ["#3b82f6", "#fff8eb", "#ef6f61"] }
      },
      series: [{
        type: "heatmap", data,
        label: { show: true, color: "#4b3b31", fontSize: 10 },
        emphasis: { itemStyle: { borderColor: palette.dark, borderWidth: 1 } }
      }]
    };
  }, [scatter]);

  // District similarity network graph
  const districtSimilarityOption = useMemo<EChartsOption>(() => {
    const allFields = [
      "avg_price", "poi_total", "shopping_count", "traffic_count", "healthcare_count",
      "recreation_count", "company_count", "business_activity", "poi_diversity",
      "shopping_per_house", "traffic_per_house", "healthcare_per_house",
      "e2sfca_access_score", "life_circle_score", "calibrated_score_life_circle",
      "affordability_score", "service_score", "vitality_score", "access_score", "value_score"
    ] as const;
    const featureVectors = scatter.map((d) => allFields.map((f) => Number(d[f]) || 0));
    const allRanges = allFields.map((_, j) => {
      const vals = featureVectors.map((v) => v[j]);
      return { min: Math.min(...vals), max: Math.max(...vals) };
    });
    const normed = featureVectors.map((v) => v.map((val, j) =>
      allRanges[j].max === allRanges[j].min ? 0.5 : (val - allRanges[j].min) / (allRanges[j].max - allRanges[j].min)
    ));
    const cosSim = (a: number[], b: number[]) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
    };
    const nodes = scatter.map((d, i) => ({
      name: d.district,
      symbolSize: 12 + Math.max(0, displayScore(d, "calibrated_score_life_circle") - 3) * 3,
      itemStyle: { color: displayScoreColor(displayScore(d, "calibrated_score_life_circle")) },
      category: 0
    }));
    const edges: Array<{ source: string; target: string; value: number }> = [];
    scatter.forEach((_, i) => {
      const sims = scatter.map((_, j) => (i === j ? -1 : cosSim(normed[i], normed[j])));
      const top3 = sims.map((s, j) => ({ s, j })).sort((a, b) => b.s - a.s).slice(0, 3).filter((x) => x.s > 0.6);
      top3.forEach((x) => {
        if (!edges.some((e) =>
          (e.source === scatter[i].district && e.target === scatter[x.j].district) ||
          (e.source === scatter[x.j].district && e.target === scatter[i].district)
        )) {
          edges.push({ source: scatter[i].district, target: scatter[x.j].district, value: Number(x.s.toFixed(2)) });
        }
      });
    });
    const priceRange = allRanges[0];
    const priceColor = (d: DistrictMetric) => {
      const t = priceRange.max === priceRange.min ? 0.5 : (d.avg_price - priceRange.min) / (priceRange.max - priceRange.min);
      return mixHex("#2b83ba", "#d7191c", t);
    };
    return {
      tooltip: {
        formatter: (params: unknown) => {
          const p = params as any;
          if (p.dataType === "edge") return `${p.data.source} ↔ ${p.data.target}<br/>相似度 ${p.data.value ?? ""}`;
          const d = scatter.find((x) => x.district === p.name);
          return d ? `${d.district}<br/>评分 ${d.calibrated_score_life_circle.toFixed(3)}<br/>房价 ${Math.round(d.avg_price).toLocaleString("zh-CN")} 元/㎡` : p.name;
        }
      },
      series: [{
        type: "graph", layout: "force", roam: true, draggable: true,
        force: { repulsion: 600, edgeLength: [120, 280], gravity: 0.12 },
        data: nodes.map((n) => {
          const d = scatter.find((x) => x.district === n.name)!;
          return { ...n, itemStyle: { color: priceColor(d) } };
        }),
        edges: edges.map((e) => ({ ...e, lineStyle: { opacity: e.value * 0.7, width: e.value * 3, curveness: 0.2 } })),
        label: { show: true, fontSize: 11, color: "#4b3b31" },
        emphasis: { focus: "adjacency", lineStyle: { width: 5 } }
      }]
    };
  }, [scatter]);

  // Supply-demand lollipop
  const supplyDemandOption = useMemo<EChartsOption>(() => {
    const selected = selectedMetric ?? buildAverageMetric(scatter);
    const cats = [
      { key: "shopping_per_house" as const, label: "购物/套" },
      { key: "traffic_per_house" as const, label: "交通/套" },
      { key: "healthcare_per_house" as const, label: "医疗/套" },
      { key: "recreation_per_house" as const, label: "休闲/套" },
      { key: "company_per_house" as const, label: "企业/套" }
    ];
    const median = (key: typeof cats[number]["key"]) => {
      const vals = scatter.map((d) => Number(d[key])).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    };
    const data = cats.map((cat) => {
      const val = Number(selected[cat.key]) || 0;
      const med = median(cat.key);
      const diff = med > 0 ? ((val - med) / med * 100) : 0;
      return { label: cat.label, value: Number(diff.toFixed(1)) };
    });
    return {
      grid: { top: 20, left: 54, right: 42, bottom: 60, containLabel: true },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = (p as any)?.dataIndex ?? 0;
          const d = data[idx];
          return `${selected.district}<br/>${d.label}: ${d.value >= 0 ? "+" : ""}${d.value}% vs 全市中位数`;
        }
      },
      xAxis: {
        type: "value",
        axisLabel: { ...axisText, formatter: "{value}%" },
        name: "偏离中位数(%)",
        nameLocation: "middle",
        nameGap: 34,
        nameTextStyle: axisText
      },
      yAxis: { type: "category", data: data.map((d) => d.label), axisLabel: axisText, inverse: true },
      series: [{
        type: "bar",
        barWidth: 16,
        data: data.map((d) => ({
          value: d.value,
          itemStyle: {
            color: d.value >= 0 ? palette.accent : "#ef6f61",
            borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4]
          }
        })),
        label: {
          show: true, position: "right",
          formatter: (p: any) => {
            const v = Number(p.value);
            return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v}%` : "";
          },
          color: "#4b3b31", fontSize: 11
        }
      }]
    };
  }, [scatter, selectedMetric]);

  // Commute distance vs price
  const commutePriceOption = useMemo<EChartsOption>(() => {
    const valid = scatter.filter((d) => d.nearest_traffic_distance !== null && Number.isFinite(d.nearest_traffic_distance));
    if (valid.length < 3) return { grid };
    const sorted = [...valid].sort((a, b) => (a.nearest_traffic_distance ?? 0) - (b.nearest_traffic_distance ?? 0));
    // Simple linear regression for trend line
    const xs = sorted.map((d) => d.nearest_traffic_distance!);
    const ys = sorted.map((d) => d.avg_price);
    const n = xs.length;
    const xMean = xs.reduce((s, v) => s + v, 0) / n;
    const yMean = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (ys[i] - yMean); den += (xs[i] - xMean) ** 2; }
    const slope = den ? num / den : 0;
    const intercept = yMean - slope * xMean;
    return {
      grid: { top: 34, left: 72, right: 34, bottom: 66, containLabel: true },
      tooltip: {
        formatter: (params: unknown) => {
          const p = params as any;
          if (p.seriesName === "trend") return "";
          const data = readPointTooltipData(params);
          return `${data.name}<br/>距交通 ${Math.round(data.value[0])}m<br/>均价 ${Math.round(data.value[1]).toLocaleString("zh-CN")} 元/㎡`;
        }
      },
      xAxis: { type: "value", name: "最近交通距离(m)", ...xAxisName },
      yAxis: { type: "value", name: "均价(元/㎡)", ...yAxisName },
      series: [
        {
          type: "scatter",
          data: sorted.map((d) => ({
            name: d.district,
            value: [
              d.nearest_traffic_distance,
              d.avg_price,
              displayScore(d, "calibrated_score_life_circle")
            ],
            itemStyle: {
              color: d.district === selectedDistrict
                ? selectedColor
                : displayScoreColor(displayScore(d, "calibrated_score_life_circle"))
            }
          })),
          symbolSize: 12
        },
        {
          type: "line", name: "trend", symbol: "none",
          data: [[xs[0], slope * xs[0] + intercept], [xs[n - 1], slope * xs[n - 1] + intercept]],
          lineStyle: { color: "#d8b99a", type: "dashed", width: 2 }, z: 1
        }
      ]
    };
  }, [scatter, selectedDistrict]);

  // ==================== MODULE 4: 评分模型 ====================
  const lifeCircleCompareOption = useMemo<EChartsOption>(() => {
    const city = buildAverageMetric(scatter);
    const selected = selectedMetric ?? city;
    const fields = [
      { key: "life_circle_5min_coverage" as const, label: "5分钟生活圈" },
      { key: "life_circle_10min_coverage" as const, label: "10分钟生活圈" },
      { key: "life_circle_15min_coverage" as const, label: "15分钟生活圈" }
    ];
    return {
      grid: { top: 42, left: 54, right: 18, bottom: 50, containLabel: true },
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: fields.map((f) => f.label), axisLabel: axisText },
      yAxis: { type: "value", name: "覆盖率", ...yAxisName },
      series: [
        { name: selected.district, type: "bar", barMaxWidth: 22, data: fields.map((f) => Number(Number(selected[f.key]).toFixed(3))), itemStyle: { color: palette.primary } },
        { name: "全市均值", type: "bar", barMaxWidth: 22, data: fields.map((f) => Number(Number(city[f.key]).toFixed(3))), itemStyle: { color: "#d8c4aa" } }
      ]
    };
  }, [scatter, selectedMetric]);


  const scoreComponentOption = useMemo<EChartsOption>(() => {
    const city = buildAverageMetric(scatter);
    const selected = selectedMetric ?? city;
    const fields = [
      { key: "affordability_score" as const, label: "负担力" },
      { key: "service_score" as const, label: "服务强度" },
      { key: "vitality_score" as const, label: "区域活力" },
      { key: "life_circle_score" as const, label: "生活圈" },
      { key: "e2sfca_access_score" as const, label: "供需可达" }
    ];
    const selectedValues = fields.map((f) => Number(displayScore(selected, f.key).toFixed(1)));
    const cityValues = fields.map((f) => Number(displayScore(city, f.key).toFixed(1)));
    return {
      color: [palette.primary, palette.accent],
      tooltip: { trigger: "item" },
      legend: { bottom: 0, data: [selected.district, "全市均值"], textStyle: axisText },
      radar: {
        radius: "62%", center: ["50%", "44%"],
        indicator: fields.map((f) => ({ name: f.label, max: 10 })),
        axisName: { color: "#6f5a4c", fontSize: 11 },
        splitLine: { lineStyle: { color: "#ead8c2" } },
        splitArea: { areaStyle: { color: ["rgba(255,248,235,0.65)", "rgba(236,248,240,0.45)"] } }
      },
      series: [{
        type: "radar",
        data: [
          { name: selected.district, value: selectedValues },
          { name: "全市均值", value: cityValues }
        ],
        areaStyle: { opacity: 0.18 },
        emphasis: { focus: "series" }
      }]
    };
  }, [scatter, selectedMetric]);

  // ==================== AI Insight Data ====================
  const chartInsightData = useMemo<Record<string, Record<string, unknown>>>(() => {
    const selected = selectedMetric ?? cityMetric;
    return {
      priceTop10: {
        unit: "元/平方米", top: priceTop10.map((d) => ({ district: d.district, value: Math.round(d.avg_price) })),
        city_average: Math.round(cityMetric.avg_price)
      },
      groupedBoxplot: {
        unit: "元/平方米",
        districts: [...scatter].sort((a, b) => b.avg_price - a.avg_price).slice(0, 12).map((d) => ({
          district: d.district, avg_price: Math.round(d.avg_price), house_count: d.house_count
        })),
        city_average: Math.round(cityMetric.avg_price)
      },
      scoreRanking: {
        unit: "校准+生活圈评分",
        top: scoreRanking.slice(0, 10).map((d) => ({
          district: d.district,
          value: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        })),
        selected: metricSnapshot(selected), city_average: metricSnapshot(cityMetric)
      },
      quadrant: {
        x_axis: "平均房价", y_axis: "商圈活跃度",
        city_average: { avg_price: Math.round(cityMetric.avg_price), business_activity: Number(cityMetric.business_activity.toFixed(1)) },
        points: scatter.map((d) => ({
          district: d.district, avg_price: Math.round(d.avg_price),
          business_activity: Number(d.business_activity.toFixed(1)),
          poi_total: d.poi_total,
          life_circle_score: Number(displayScore(d, "life_circle_score").toFixed(1))
        }))
      },
      districtClustering: {
        method: "K-means (k=4) + PCA降维", clusters: 4,
        features: ["负担力", "服务强度", "区域活力", "供需可达", "生活圈", "房价"],
        points: scatter.map((d) => ({
          district: d.district,
          affordability_score: Number(displayScore(d, "affordability_score").toFixed(1)),
          service_score: Number(displayScore(d, "service_score").toFixed(1)),
          vitality_score: Number(displayScore(d, "vitality_score").toFixed(1)),
          e2sfca_access_score: Number(displayScore(d, "e2sfca_access_score").toFixed(1)),
          life_circle_score: Number(displayScore(d, "life_circle_score").toFixed(1)),
          avg_price: Math.round(d.avg_price)
        }))
      },
      poiShare: {
        scope: "上海市全市",
        top: poiCategories.map((item) => ({ name: item.category, value: item.count }))
      },
      groupedPoi: {
        top: scoreRanking.slice(0, 6).map((d) => ({
          district: d.district, shopping_count: d.shopping_count,
          traffic_count: d.traffic_count, healthcare_count: d.healthcare_count,
          recreation_count: d.recreation_count, company_count: d.company_count,
          score: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      poiStack: {
        top: scoreRanking.slice(0, 10).map((d) => ({
          district: d.district, shopping_count: d.shopping_count,
          traffic_count: d.traffic_count, healthcare_count: d.healthcare_count,
          recreation_count: d.recreation_count, company_count: d.company_count
        }))
      },
      radar: {
        selected: metricSnapshot(selected), city_average: metricSnapshot(cityMetric)
      },
      lifeCircleHeatmap: {
        districts: scoreRanking.slice(0, 12).map((d) => ({
          district: d.district,
          "5min": Number(d.life_circle_5min_coverage.toFixed(2)),
          "10min": Number(d.life_circle_10min_coverage.toFixed(2)),
          "15min": Number(d.life_circle_15min_coverage.toFixed(2)),
          score: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      accessValue: {
        selected: metricSnapshot(selected), city_average: metricSnapshot(cityMetric),
        points: scatter.map((d) => ({
          district: d.district, avg_price: Math.round(d.avg_price),
          e2sfca_access_score: Number(displayScore(d, "e2sfca_access_score").toFixed(1)),
          calibrated_score_life_circle: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      correlation: {
        matrix: relationMetrics.flatMap((row) =>
          relationMetrics.map((col) => ({
            row: row.label, col: col.label, value: Number(pearson(scatter, row.key, col.key).toFixed(2))
          }))
        )
      },
      districtSimilarity: {
        method: "余弦相似度 + 力导向布局",
        features: 20, districts: scatter.length,
        representative_edges: scatter.flatMap((d, i) => {
          const sims = scatter.map((_, j) => i === j ? -1 : 0).filter((v) => v > 0.7);
          return sims.length ? [{ district: d.district, similar_to: scatter[sims[0]].district, similarity: sims[0] }] : [];
        }).slice(0, 10)
      },
      supplyDemand: {
        selected: selected.district,
        deviations: [
          { category: "购物/套", unit: "套", per_house: Number(Number(selected.shopping_per_house).toFixed(4)), median: Number(Number(medianForAi(scatter, "shopping_per_house")).toFixed(4)) },
          { category: "交通/套", unit: "套", per_house: Number(Number(selected.traffic_per_house).toFixed(4)), median: Number(Number(medianForAi(scatter, "traffic_per_house")).toFixed(4)) },
          { category: "医疗/套", unit: "套", per_house: Number(Number(selected.healthcare_per_house).toFixed(4)), median: Number(Number(medianForAi(scatter, "healthcare_per_house")).toFixed(4)) },
          { category: "休闲/套", unit: "套", per_house: Number(Number(selected.recreation_per_house).toFixed(4)), median: Number(Number(medianForAi(scatter, "recreation_per_house")).toFixed(4)) },
          { category: "企业/套", unit: "套", per_house: Number(Number(selected.company_per_house).toFixed(4)), median: Number(Number(medianForAi(scatter, "company_per_house")).toFixed(4)) }
        ]
      },
      commutePrice: {
        selected: metricSnapshot(selected),
        points: scatter.filter((d) => d.nearest_traffic_distance !== null).map((d) => ({
          district: d.district, nearest_traffic_distance: Math.round(d.nearest_traffic_distance ?? 0),
          avg_price: Math.round(d.avg_price)
        }))
      },
      lifeCircleCompare: {
        selected: lifeCircleSnapshot(selected), city_average: lifeCircleSnapshot(cityMetric)
      },
      scoreComponent: {
        selected: scoreComponentSnapshot(selected), city_average: scoreComponentSnapshot(cityMetric)
      },
    };
  }, [cityMetric, poiCategories, priceTop10, scatter, scoreRanking, selectedMetric, shoppingTop5]);

  return (
    <section className="rounded-[24px] border border-[#ead8c2] bg-[#fff8ea]/88 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur">
      <div>
        <h2 className="text-2xl font-black text-[#33251f]">可视化分析</h2>

        <div className="mt-5 flex flex-wrap gap-2">
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => setActiveModule(module.id)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activeModule === module.id
                  ? "border-[#ff9f72] bg-[#fff0df] text-[#a44724] shadow-[0_8px_20px_rgba(255,122,79,0.16)]"
                  : "border-[#ead8c2] bg-white/76 text-[#775f4d] hover:border-[#f3c99a] hover:bg-[#fff9ef]"
              }`}
            >
              {module.label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {activeModule === "market" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="priceTop10" title="房价 Top10 区域" desc="展示各区挂牌均价前 10，点击联动地图。" insightData={chartInsightData.priceTop10} insight={insights.priceTop10} loading={insightLoading.priceTop10} error={insightErrors.priceTop10} onInsight={loadChartInsight}>
                <EChart option={priceOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="groupedBoxplot" title="房价分布（分区分组箱线图）" desc="Top12高价区分组箱线，展示各区房价离散程度与异常值。" insightData={chartInsightData.groupedBoxplot} insight={insights.groupedBoxplot} loading={insightLoading.groupedBoxplot} error={insightErrors.groupedBoxplot} onInsight={loadChartInsight}>
                <EChart option={groupedBoxplotOption} className="h-72 w-full" />
              </ChartCard>
              <ChartCard chartId="scoreRanking" title="校准评分排名" desc="按综合校准评分排序，点击联动地图。" insightData={chartInsightData.scoreRanking} insight={insights.scoreRanking} loading={insightLoading.scoreRanking} error={insightErrors.scoreRanking} onInsight={loadChartInsight}>
                <EChart option={scoreOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="quadrant" title="房价与便利性象限" desc="房价×商圈活跃度，气泡大小=POI总量，颜色=生活圈得分。象限线为均值。" insightData={chartInsightData.quadrant} insight={insights.quadrant} loading={insightLoading.quadrant} error={insightErrors.quadrant} onInsight={loadChartInsight}>
                <EChart option={quadrantOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="districtClustering" title="区域聚类分析（K-means + PCA）" desc="基于负担力、服务强度、活力、供需可达、生活圈、房价6维特征聚类为4类，降维到2D散点。" insightData={chartInsightData.districtClustering} insight={insights.districtClustering} loading={insightLoading.districtClustering} error={insightErrors.districtClustering} onInsight={loadChartInsight}>
                <EChart option={districtClusteringOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "poi" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="poiShare" title="POI类别占比" desc="全市各类 POI 占比，反映上海整体配套结构。" scope="上海市全市" selectedDistrictForInsight={null} insightData={chartInsightData.poiShare} insight={insights.poiShare} loading={insightLoading.poiShare} error={insightErrors.poiShare} onInsight={loadChartInsight}>
                <EChart option={poiOption} className="h-72 w-full" />
              </ChartCard>
              <ChartCard chartId="groupedPoi" title="热门区域 POI 分组柱状图" desc="对比高评分区域中购物、交通、医疗三类 POI，tooltip 显示购物排名。" insightData={chartInsightData.groupedPoi} insight={insights.groupedPoi} loading={insightLoading.groupedPoi} error={insightErrors.groupedPoi} onInsight={loadChartInsight}>
                <EChart option={groupedPoiOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="poiStack" title="高评分区域 POI 结构" desc="展示Top10区域中不同 POI 类型的构成。" insightData={chartInsightData.poiStack} insight={insights.poiStack} loading={insightLoading.poiStack} error={insightErrors.poiStack} onInsight={loadChartInsight}>
                <EChart option={poiStackOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="radar" title="选中区 vs 对标区 vs 全市均值" desc="雷达对比选中区、评分最高区和全市均值各项标准化指标，三线对比。" insightData={chartInsightData.radar} insight={insights.radar} loading={insightLoading.radar} error={insightErrors.radar} onInsight={loadChartInsight}>
                <EChart option={radarOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="lifeCircleHeatmap" title="生活圈覆盖率热力图" desc="Top12区域 × 5/10/15分钟生活圈覆盖率矩阵，颜色越深覆盖越广。" insightData={chartInsightData.lifeCircleHeatmap} insight={insights.lifeCircleHeatmap} loading={insightLoading.lifeCircleHeatmap} error={insightErrors.lifeCircleHeatmap} onInsight={loadChartInsight}>
                <EChart option={lifeCircleHeatmapOption} className="h-80 w-full" />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "relation" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="accessValue" title="可达性与房价性价比" desc="供需可达性分与房价的关系，气泡大小反映校准评分。" insightData={chartInsightData.accessValue} insight={insights.accessValue} loading={insightLoading.accessValue} error={insightErrors.accessValue} onInsight={loadChartInsight}>
                <EChart option={accessValueOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="correlation" title="指标相关性热力图" desc="展示指标间 Pearson 相关系数，颜色越暖相关越强。" insightData={chartInsightData.correlation} insight={insights.correlation} loading={insightLoading.correlation} error={insightErrors.correlation} onInsight={loadChartInsight}>
                <EChart option={correlationOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard chartId="districtSimilarity" title="区域相似度网络图" desc="基于20维特征余弦相似度+力导向布局。节点颜色=房价，连边=相似度>0.6。" insightData={chartInsightData.districtSimilarity} insight={insights.districtSimilarity} loading={insightLoading.districtSimilarity} error={insightErrors.districtSimilarity} onInsight={loadChartInsight}>
                <EChart option={districtSimilarityOption} className="h-[32rem] w-full" />
              </ChartCard>
              <ChartCard chartId="supplyDemand" title={`设施供需偏差（当前区：${selectedDistrict ?? "全市均值"}）`} desc="选中区每套房设施供给量 vs 全市中位数的偏离百分比。绿色向右=高于中位数，红色向左=低于中位数。" insightData={chartInsightData.supplyDemand} insight={insights.supplyDemand} loading={insightLoading.supplyDemand} error={insightErrors.supplyDemand} onInsight={loadChartInsight}>
                <EChart option={supplyDemandOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard chartId="commutePrice" title="通勤距离-房价梯度" desc="各区最近交通距离与均价的关系，虚线为线性趋势。越靠左下越'近且便宜'。" insightData={chartInsightData.commutePrice} insight={insights.commutePrice} loading={insightLoading.commutePrice} error={insightErrors.commutePrice} onInsight={loadChartInsight}>
                <EChart option={commutePriceOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "street" ? <StreetChartsPanel district={selectedDistrict} /> : null}

          {activeModule === "model" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="lifeCircleCompare" title="生活圈覆盖率对比" desc="5/10/15分钟生活圈覆盖率，对比选中区域与全市均值。" insightData={chartInsightData.lifeCircleCompare} insight={insights.lifeCircleCompare} loading={insightLoading.lifeCircleCompare} error={insightErrors.lifeCircleCompare} onInsight={loadChartInsight}>
                <EChart option={lifeCircleCompareOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard chartId="scoreComponent" title="评分维度构成" desc="展示评分子维度构成，对比选中区域与全市均值。" insightData={chartInsightData.scoreComponent} insight={insights.scoreComponent} loading={insightLoading.scoreComponent} error={insightErrors.scoreComponent} onInsight={loadChartInsight}>
                <EChart option={scoreComponentOption} className="h-[28rem] w-full" />
              </ChartCard>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

// ==================== ChartCard ====================

function ChartCard({ title, children, desc, chartId, insightData, scope,
  selectedDistrictForInsight, insight, loading, error, onInsight
}: {
  title: string; children: ReactNode; desc?: string; chartId: string;
  insightData: Record<string, unknown>; scope?: string;
  selectedDistrictForInsight?: string | null;
  insight?: ChartInsight; loading?: boolean; error?: string;
  onInsight: (chartId: string, title: string, description: string | undefined,
    data: Record<string, unknown>, scope?: string, selectedDistrictForInsight?: string | null) => void;
}) {
  const hasInsightContent = Boolean(insight || loading || error);
  const [insightOpen, setInsightOpen] = useState(false);
  const handleInsightClick = () => {
    setInsightOpen(true);
    onInsight(chartId, title, desc, insightData, scope, selectedDistrictForInsight);
  };
  useEffect(() => { if (loading || insight || error) setInsightOpen(true); }, [error, insight, loading]);
  return (
    <Card className="shrink-0 overflow-visible rounded-[18px] border-[#f1dfc9] bg-[#fffdf8]/92 shadow-[0_12px_34px_rgba(104,72,42,0.08)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-black text-[#3c2a20]">{title}</CardTitle>
        {desc ? <p className="mt-1 text-sm text-[#6b5345]">{desc}</p> : null}
      </CardHeader>
      <CardContent className="relative pb-4">
        <div className="min-w-0 pr-0 lg:pr-[25rem]">{children}</div>
        <button type="button" onClick={handleInsightClick} disabled={loading}
          className="absolute bottom-4 right-4 z-10 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#f0d1b5] bg-white/82 px-3 text-sm font-semibold text-[#c65f32] shadow-[0_8px_18px_rgba(104,72,42,0.12)] backdrop-blur transition hover:border-[#ffad7d] hover:bg-[#fff3e5] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {insight || error ? "查看结论" : "生成结论"}
        </button>
        {insightOpen && hasInsightContent ? (
          <aside className="absolute right-4 top-0 z-20 flex max-h-[calc(100%-4rem)] w-[min(24rem,calc(100%-2rem))] flex-col rounded-xl border border-[#efcfb1] bg-[#fffaf0]/82 p-4 text-left shadow-[0_18px_48px_rgba(73,47,28,0.18)] backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-black text-[#3c2a20]">
                  <Sparkles className="h-4 w-4 text-[#d45f34]" /> AI 图表结论
                </div>
                {insight?.is_placeholder ? <p className="mt-1 text-xs font-semibold text-[#a46322]">本地兜底结果</p> : null}
              </div>
              <button type="button" title="关闭" aria-label="关闭 AI 图表结论"
                onClick={() => setInsightOpen(false)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#7a5a45] transition hover:bg-[#f7e7d4] hover:text-[#3c2a20]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 overflow-y-auto pr-1 text-sm leading-7 text-[#5f4a3d]">
              <p className="whitespace-pre-wrap">{error ?? (loading ? "正在生成结论..." : insight?.insight ?? "暂无结论。")}</p>
            </div>
          </aside>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ==================== Utility Functions ====================

function chartMetricValue(item: DistrictMetric, key: keyof DistrictMetric) {
  return displayScoreKeys.has(key) ? displayScore(item, key) : Number(item[key]);
}

function average(items: DistrictMetric[], key: keyof DistrictMetric) {
  const values = items.map((item) => chartMetricValue(item, key)).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(items: DistrictMetric[], xKey: MetricKey, yKey: MetricKey) {
  if (items.length < 2) return 0;
  const xMean = average(items, xKey);
  const yMean = average(items, yKey);
  let numerator = 0, xVariance = 0, yVariance = 0;
  items.forEach((item) => {
    const x = chartMetricValue(item, xKey) - xMean;
    const y = chartMetricValue(item, yKey) - yMean;
    numerator += x * y; xVariance += x * x; yVariance += y * y;
  });
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildRanges(items: DistrictMetric[], keys: MetricKey[]) {
  return keys.reduce((ranges, key) => {
    const values = items.map((item) => chartMetricValue(item, key));
    ranges[key] = { min: Math.min(...values), max: Math.max(...values) };
    return ranges;
  }, {} as Record<MetricKey, { min: number; max: number }>);
}

function normalize(value: number, range: { min: number; max: number }) {
  if (!Number.isFinite(value) || range.max === range.min) return 0.5;
  return (value - range.min) / (range.max - range.min);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readObjectField(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function readNumericField(value: unknown, key: string) {
  const field = readObjectField(value, key);
  return typeof field === "number" ? field : -1;
}

function readPointTooltipData(params: unknown) {
  const data = readObjectField(params, "data");
  if (!isRecord(data)) return { name: "", value: [0, 0, 0] };
  const name = typeof data.name === "string" ? data.name : "";
  const value = Array.isArray(data.value) ? data.value.map((item) => Number(item)) : [0, 0, 0];
  return { name, value };
}

function readMatrixTooltipData(params: unknown) {
  const data = readObjectField(params, "data");
  return Array.isArray(data) ? data.map((item) => Number(item)) : [0, 0, 0];
}

function medianForAi(items: DistrictMetric[], key: keyof DistrictMetric) {
  const vals = items.map((d) => Number(d[key])).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
}

function mixHex(low: string, high: string, ratio: number) {
  const parse = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const a = parse(low), b = parse(high);
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const blue = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${blue})`;
}

function metricSnapshot(metric: DistrictMetric) {
  return {
    district: metric.district, avg_price: Math.round(metric.avg_price),
    poi_total: Math.round(metric.poi_total), shopping_count: Math.round(metric.shopping_count),
    traffic_count: Math.round(metric.traffic_count), healthcare_count: Math.round(metric.healthcare_count),
    business_activity: Number(metric.business_activity.toFixed(2)),
    e2sfca_access_score: Number(displayScore(metric, "e2sfca_access_score").toFixed(1)),
    calibrated_score: Number(displayScore(metric, "calibrated_score").toFixed(1)),
    calibrated_score_life_circle: Number(displayScore(metric, "calibrated_score_life_circle").toFixed(1))
  };
}

function lifeCircleSnapshot(metric: DistrictMetric) {
  return {
    district: metric.district,
    life_circle_5min_coverage: Number(metric.life_circle_5min_coverage.toFixed(3)),
    life_circle_10min_coverage: Number(metric.life_circle_10min_coverage.toFixed(3)),
    life_circle_15min_coverage: Number(metric.life_circle_15min_coverage.toFixed(3))
  };
}

function scoreComponentSnapshot(metric: DistrictMetric) {
  return {
    district: metric.district,
    affordability_score: Number(displayScore(metric, "affordability_score").toFixed(1)),
    service_score: Number(displayScore(metric, "service_score").toFixed(1)),
    vitality_score: Number(displayScore(metric, "vitality_score").toFixed(1)),
    life_circle_score: Number(displayScore(metric, "life_circle_score").toFixed(1)),
    e2sfca_access_score: Number(displayScore(metric, "e2sfca_access_score").toFixed(1))
  };
}

function buildAverageMetric(items: DistrictMetric[]): DistrictMetric {
  const base = items[0];
  return {
    district: "全市均值", avg_price: average(items, "avg_price"),
    avg_total_price: base?.avg_total_price ?? 0, house_count: base?.house_count ?? 0,
    poi_total: average(items, "poi_total"), recreation_count: average(items, "recreation_count"),
    company_count: average(items, "company_count"), residence_count: base?.residence_count ?? 0,
    shopping_count: average(items, "shopping_count"), traffic_count: average(items, "traffic_count"),
    healthcare_count: average(items, "healthcare_count"), business_activity: average(items, "business_activity"),
    activity_norm: base?.activity_norm ?? 0, price_norm: base?.price_norm ?? 0,
    livability_score: average(items, "livability_score"),
    livability_score_display: average(items, "livability_score"),
    poi_diversity: average(items, "poi_diversity"),
    shopping_per_house: average(items, "shopping_per_house"),
    traffic_per_house: average(items, "traffic_per_house"),
    healthcare_per_house: average(items, "healthcare_per_house"),
    recreation_per_house: average(items, "recreation_per_house"),
    company_per_house: average(items, "company_per_house"),
    cost_pressure: average(items, "cost_pressure"),
    affordability_score: average(items, "affordability_score"),
    affordability_score_display: average(items, "affordability_score"),
    service_score: average(items, "service_score"),
    service_score_display: average(items, "service_score"),
    vitality_score: average(items, "vitality_score"),
    vitality_score_display: average(items, "vitality_score"),
    livability_score_v2: average(items, "livability_score_v2"),
    livability_score_v2_display: average(items, "livability_score_v2"),
    shopping_access: average(items, "shopping_access"), traffic_access: average(items, "traffic_access"),
    healthcare_access: average(items, "healthcare_access"), recreation_access: average(items, "recreation_access"),
    company_access: average(items, "company_access"),
    nearest_traffic_distance: average(items, "nearest_traffic_distance"),
    nearest_healthcare_distance: average(items, "nearest_healthcare_distance"),
    access_score: average(items, "access_score"),
    access_score_display: average(items, "access_score"),
    value_score: average(items, "value_score"),
    value_score_display: average(items, "value_score"),
    shopping_e2sfca_access: average(items, "shopping_e2sfca_access"),
    traffic_e2sfca_access: average(items, "traffic_e2sfca_access"),
    healthcare_e2sfca_access: average(items, "healthcare_e2sfca_access"),
    recreation_e2sfca_access: average(items, "recreation_e2sfca_access"),
    company_e2sfca_access: average(items, "company_e2sfca_access"),
    e2sfca_access_score: average(items, "e2sfca_access_score"),
    e2sfca_access_score_display: average(items, "e2sfca_access_score"),
    e2sfca_value_score: average(items, "e2sfca_value_score"),
    e2sfca_value_score_display: average(items, "e2sfca_value_score"),
    sample_reliability_score: average(items, "sample_reliability_score"),
    calibrated_score: average(items, "calibrated_score"),
    calibrated_score_display: average(items, "calibrated_score"),
    life_circle_5min_score: average(items, "life_circle_5min_score"),
    life_circle_5min_score_display: average(items, "life_circle_5min_score"),
    life_circle_10min_score: average(items, "life_circle_10min_score"),
    life_circle_10min_score_display: average(items, "life_circle_10min_score"),
    life_circle_15min_score: average(items, "life_circle_15min_score"),
    life_circle_15min_score_display: average(items, "life_circle_15min_score"),
    life_circle_score: average(items, "life_circle_score"),
    life_circle_score_display: average(items, "life_circle_score"),
    life_circle_5min_coverage: average(items, "life_circle_5min_coverage"),
    life_circle_10min_coverage: average(items, "life_circle_10min_coverage"),
    life_circle_15min_coverage: average(items, "life_circle_15min_coverage"),
    calibrated_score_life_circle: average(items, "calibrated_score_life_circle"),
    calibrated_score_life_circle_display: average(items, "calibrated_score_life_circle"),
    center_lng: null, center_lat: null
  };
}

function lifeCircleColor(score: number) {
  if (score >= 0.5) return "#15803d";
  if (score >= 0.3) return "#31b78f";
  if (score >= 0.15) return "#f59e0b";
  return "#ef6f61";
}

export default ChartsPanel;

