import type { EChartsOption } from "echarts";
import type { ComponentProps, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import EChart from "./charts/EChart";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { displayScore, formatPercent, formatScore, scoreColor } from "../lib/utils";
import type { ChartInsight, DistrictMetric, PoiCategory } from "../types/metrics";

type ModuleId = "overview" | "poi" | "relation" | "model";

const modules: { id: ModuleId; label: string }[] = [
  { id: "overview", label: "城市概览" },
  { id: "poi", label: "设施结构" },
  { id: "relation", label: "关系洞察" },
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
  { key: "e2sfca_access_score", label: "设施供需充足度" },
  { key: "calibrated_score_life_circle", label: "校准评分" }
];

const selectedDependentChartIds = new Set([
  "priceTop10",
  "scoreRanking",
  "quadrant",
  "groupedPoi",
  "poiStack",
  "shoppingTop5",
  "radar",
  "accessValue",
  "parallel",
  "perHouse",
  "scoreModelCompare",
  "lifeCircleCompare",
  "sampleReliability",
  "scoreComponent"
]);

const ChartsPanel = memo(function ChartsPanel({
  priceTop10,
  poiCategories,
  shoppingTop5,
  scatter,
  scoreRanking,
  selectedDistrict,
  onSelectDistrict
}: ChartsPanelProps) {
  const [activeModule, setActiveModule] = useState<ModuleId>("overview");
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
      selectedDependentChartIds.forEach((chartId) => {
        delete next[chartId];
      });
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
    async (
      chartId: string,
      title: string,
      description: string | undefined,
      data: Record<string, unknown>,
      scope?: string,
      selectedDistrictForInsight?: string | null
    ) => {
      if (insights[chartId]) return;
      setInsightLoading((prev) => ({ ...prev, [chartId]: true }));
      setInsightErrors((prev) => {
        const next = { ...prev };
        delete next[chartId];
        return next;
      });
      try {
        const res = await fetch("/api/ai/chart-insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chart_id: chartId,
            title,
            description,
            scope,
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
    },
    [insights, selectedDistrict, selectedMetric?.district]
  );

  const priceOption = useMemo<EChartsOption>(
    () => ({
      grid,
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: priceTop10.map((d) => d.district), axisLabel: { ...axisText, rotate: 35 } },
      yAxis: { type: "value", axisLabel: axisText },
      series: [
        {
          type: "bar",
          data: priceTop10.map((d) => ({
            name: d.district,
            value: Math.round(d.avg_price),
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : palette.primary }
          })),
          barMaxWidth: 22
        }
      ]
    }),
    [priceTop10, selectedDistrict]
  );

  const poiOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "item" },
      legend: { bottom: 0, textStyle: axisText },
      color: [palette.primary, "#f7c948", palette.accent, palette.blue, palette.purple, palette.pink],
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          center: ["50%", "44%"],
          data: poiCategories.map((item) => ({ name: item.category, value: item.count })),
          label: { formatter: "{b}", color: "#4b3b31" }
        }
      ]
    }),
    [poiCategories]
  );

  const shoppingOption = useMemo<EChartsOption>(
    () => ({
      grid,
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: shoppingTop5.map((d) => d.district), axisLabel: axisText },
      yAxis: { type: "value", axisLabel: axisText },
      series: [
        {
          type: "bar",
          data: shoppingTop5.map((d) => ({
            name: d.district,
            value: d.shopping_count,
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : palette.accent }
          })),
          barMaxWidth: 26
        }
      ]
    }),
    [shoppingTop5, selectedDistrict]
  );

  const scoreOption = useMemo<EChartsOption>(
    () => ({
      grid: { top: 10, left: 48, right: 20, bottom: 22 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "value", axisLabel: axisText },
      yAxis: {
        type: "category",
        inverse: true,
        data: scoreRanking.map((d) => d.district),
        axisLabel: axisText
      },
      series: [
        {
          type: "bar",
          data: scoreRanking.map((d) => ({
            name: d.district,
            value: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1)),
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : scoreColor(displayScore(d, "calibrated_score_life_circle")) }
          })),
          barMaxWidth: 18
        }
      ]
    }),
    [scoreRanking, selectedDistrict]
  );

  const quadrantOption = useMemo<EChartsOption>(() => {
    const avgPrice = average(scatter, "avg_price");
    const avgActivity = average(scatter, "business_activity");
    return {
      grid: { top: 24, left: 54, right: 22, bottom: 46 },
      tooltip: {
        formatter: (params: unknown) => {
          const data = readPointTooltipData(params);
          return `${data.name}<br/>房价 ${Math.round(data.value[0]).toLocaleString("zh-CN")} 元/㎡<br/>商圈活跃度 ${data.value[1].toFixed(1)}<br/>POI ${Math.round(data.value[2]).toLocaleString("zh-CN")}`;
        }
      },
      xAxis: { type: "value", name: "平均房价", nameTextStyle: axisText, axisLabel: axisText },
      yAxis: { type: "value", name: "商圈活跃度", nameTextStyle: axisText, axisLabel: axisText },
      series: [
        {
          type: "scatter",
          symbolSize: (value: number[]) => Math.max(10, Math.min(34, Math.sqrt(value[2]) / 12)),
          data: scatter.map((d) => ({
            name: d.district,
            value: [d.avg_price, d.business_activity, d.poi_total],
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : scoreColor(displayScore(d, "calibrated_score_life_circle")) }
          })),
          markLine: {
            silent: true,
            symbol: "none",
            label: { color: "#8a6d5a" },
            lineStyle: { color: "#d8b99a", type: "dashed" },
            data: [{ xAxis: avgPrice }, { yAxis: avgActivity }]
          }
        }
      ]
    };
  }, [scatter, selectedDistrict]);

  const poiStackOption = useMemo<EChartsOption>(() => {
    const rows = [...scoreRanking].slice(0, 10);
    return {
      grid: { top: 42, left: 46, right: 18, bottom: 46 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: { ...axisText, rotate: 30 } },
      yAxis: { type: "value", axisLabel: axisText },
      series: poiStackFields.map((field) => ({
        name: field.label,
        type: "bar",
        stack: "poi",
        emphasis: { focus: "series" },
        itemStyle: { color: field.color },
        data: rows.map((d) => ({ name: d.district, value: Number(d[field.key]) }))
      }))
    };
  }, [scoreRanking]);

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
        min: -1,
        max: 1,
        right: 4,
        top: "middle",
        calculable: false,
        textStyle: axisText,
        inRange: { color: ["#3b82f6", "#fff8eb", "#ef6f61"] }
      },
      series: [
        {
          type: "heatmap",
          data,
          label: { show: true, color: "#4b3b31", fontSize: 10 },
          emphasis: { itemStyle: { borderColor: palette.dark, borderWidth: 1 }, label: { show: true } }
        }
      ]
    };
  }, [scatter]);

  // 箱线图用于展示房价分布（min, Q1, median, Q3, max）
  const boxplotOption = useMemo<EChartsOption>(() => {
    const prices = scatter.map((d) => Number(d.avg_price)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!prices.length) return { grid };
    const q = (arr: number[], p: number) => {
      const idx = (arr.length - 1) * p;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return lo === hi ? arr[lo] : arr[lo] * (hi - idx) + arr[hi] * (idx - lo);
    };
    const min = prices[0];
    const max = prices[prices.length - 1];
    const q1 = q(prices, 0.25);
    const median = q(prices, 0.5);
    const q3 = q(prices, 0.75);
    const boxData = [[min, q1, median, q3, max]];
    return {
      grid,
      tooltip: { formatter: () => `房价箱线图<br/>最小 ${Math.round(min)} 元/㎡<br/>Q1 ${Math.round(q1)} 元/㎡<br/>中位数 ${Math.round(median)} 元/㎡<br/>Q3 ${Math.round(q3)} 元/㎡<br/>最大 ${Math.round(max)} 元/㎡` },
      xAxis: { type: "category", data: ["房价分布"], axisLabel: axisText },
      yAxis: { type: "value", axisLabel: axisText },
      series: [
        { name: "boxplot", type: "boxplot", data: boxData, itemStyle: { color: palette.primary }, tooltip: { formatter: undefined } }
      ]
    };
  }, [scatter]);

  const groupedPoiOption = useMemo<EChartsOption>(() => {
    const rows = [...scoreRanking].slice(0, 6);
    const seriesFields = [
      { key: "shopping_count" as const, label: "购物", color: palette.primary },
      { key: "traffic_count" as const, label: "交通", color: palette.blue },
      { key: "healthcare_count" as const, label: "医疗", color: palette.accent }
    ];
    return {
      grid: { top: 38, left: 46, right: 18, bottom: 50 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: { ...axisText, rotate: 28 } },
      yAxis: { type: "value", axisLabel: axisText },
      series: seriesFields.map((field) => ({
        name: field.label,
        type: "bar",
        barMaxWidth: 16,
        emphasis: { focus: "series" },
        itemStyle: { color: field.color },
        data: rows.map((d) => ({ name: d.district, value: Number(d[field.key]) }))
      }))
    };
  }, [scoreRanking]);

  const scoreHistogramOption = useMemo<EChartsOption>(() => {
    const bins = [
      { name: "低分", min: -Infinity, max: 5.5, color: "#ef6f61" },
      { name: "中低", min: 5.5, max: 6.5, color: palette.warm },
      { name: "中高", min: 6.5, max: 8, color: palette.accent },
      { name: "高分", min: 8, max: Infinity, color: palette.teal }
    ];
    return {
      grid,
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: bins.map((bin) => bin.name), axisLabel: axisText },
      yAxis: { type: "value", axisLabel: axisText, minInterval: 1 },
      series: [
        {
          type: "bar",
          barMaxWidth: 34,
          data: bins.map((bin) => ({
            value: scatter.filter((d) => {
              const value = displayScore(d, "calibrated_score_life_circle");
              return value >= bin.min && value < bin.max;
            }).length,
            itemStyle: { color: bin.color }
          }))
        }
      ]
    };
  }, [scatter]);

  const radarOption = useMemo<EChartsOption>(() => {
    const city = buildAverageMetric(scatter);
    const selected = selectedMetric ?? city;
    const ranges = buildRanges(scatter, radarFields.map((field) => field.key));
    const toRadar = (metric: DistrictMetric) =>
      radarFields.map((field) => {
        const value = normalize(chartMetricValue(metric, field.key), ranges[field.key]);
        return Number((field.inverse ? 1 - value : value).toFixed(3));
      });

    return {
      color: [palette.primary, palette.accent],
      tooltip: { trigger: "item" },
      legend: { bottom: 0, data: [selected?.district ?? "当前区域", "全市均值"], textStyle: axisText },
      radar: {
        radius: "62%",
        center: ["50%", "46%"],
        indicator: radarFields.map((field) => ({ name: field.label, max: 1 })),
        axisName: { color: "#6f5a4c", fontSize: 11 },
        splitLine: { lineStyle: { color: "#ead8c2" } },
        splitArea: { areaStyle: { color: ["rgba(255,248,235,0.65)", "rgba(236,248,240,0.45)"] } }
      },
      series: [
        {
          type: "radar",
          data: [
            { name: selected?.district ?? "当前区域", value: toRadar(selected) },
            { name: "全市均值", value: toRadar(city) }
          ],
          areaStyle: { opacity: 0.18 },
          emphasis: { focus: "series", lineStyle: { width: 3 }, itemStyle: { borderColor: palette.dark, borderWidth: 1 } }
        }
      ]
    };
  }, [scatter, selectedMetric]);

  const parallelOption = useMemo<EChartsOption>(() => {
    const fields: { key: MetricKey; label: string }[] = [
      { key: "avg_price", label: "房价" },
      { key: "poi_total", label: "POI" },
      { key: "business_activity", label: "活跃度" },
      { key: "calibrated_score_life_circle", label: "校准评分" }
    ];
    const ranges = buildRanges(scatter, fields.map((field) => field.key));
    return {
      parallelAxis: fields.map((field, index) => ({
        dim: index,
        name: field.label,
        min: ranges[field.key].min,
        max: ranges[field.key].max,
        nameTextStyle: axisText,
        axisLabel: axisText
      })),
      parallel: { left: 48, right: 42, top: 34, bottom: 24, parallelAxisDefault: { type: "value" } },
      tooltip: {
        formatter: (params: unknown) => {
          const row = scatter[readNumericField(params, "dataIndex")];
          return row ? `${row.district}<br/>房价 ${Math.round(row.avg_price).toLocaleString("zh-CN")} 元/㎡<br/>POI ${row.poi_total.toLocaleString("zh-CN")}<br/>活跃度 ${row.business_activity.toFixed(1)}<br/>校准评分 ${formatScore(displayScore(row, "calibrated_score_life_circle"))}` : "";
        }
      },
      series: [
        {
          type: "parallel",
          lineStyle: { width: 2, opacity: 0.46 },
          emphasis: { focus: "series", lineStyle: { width: 3, opacity: 0.95 } },
          data: scatter.map((d) => ({
            name: d.district,
            value: fields.map((field) => chartMetricValue(d, field.key)),
            lineStyle: {
              color: d.district === selectedDistrict ? selectedColor : scoreColor(displayScore(d, "calibrated_score_life_circle")),
              opacity: d.district === selectedDistrict ? 0.95 : 0.42,
              width: d.district === selectedDistrict ? 4 : 2
            }
          }))
        }
      ]
    };
  }, [scatter, selectedDistrict]);

  const perHouseOption = useMemo<EChartsOption>(() => {
    const rows = [...scoreRanking].slice(0, 8);
    const fields = [
      { key: "shopping_per_house" as const, label: "购物/套", color: palette.primary },
      { key: "traffic_per_house" as const, label: "交通/套", color: palette.blue },
      { key: "healthcare_per_house" as const, label: "医疗/套", color: palette.accent }
    ];
    return {
      grid: { top: 38, left: 54, right: 18, bottom: 50 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: rows.map((d) => d.district), axisLabel: { ...axisText, rotate: 28 } },
      yAxis: { type: "value", axisLabel: axisText },
      series: fields.map((field) => ({
        name: field.label,
        type: "bar",
        barMaxWidth: 16,
        emphasis: { focus: "series" },
        itemStyle: { color: field.color },
        data: rows.map((d) => ({ name: d.district, value: Number(Number(d[field.key]).toFixed(4)) }))
      }))
    };
  }, [scoreRanking]);

  const accessValueOption = useMemo<EChartsOption>(() => {
    return {
      grid: { top: 24, left: 58, right: 22, bottom: 46 },
      tooltip: {
        formatter: (params: unknown) => {
          const data = readPointTooltipData(params);
          return `${data.name}<br/>房价 ${Math.round(data.value[0]).toLocaleString("zh-CN")} 元/㎡<br/>设施供需充足度 ${formatScore(data.value[1])}<br/>校准评分 ${formatScore(data.value[2])}`;
        }
      },
      xAxis: { type: "value", name: "平均房价 (元/㎡)", nameTextStyle: axisText, axisLabel: axisText },
      yAxis: { type: "value", name: "设施供需充足度", nameTextStyle: axisText, axisLabel: axisText },
      series: [
        {
          type: "scatter",
          symbolSize: (value: number[]) => Math.max(10, Math.min(32, value[2] * 3)),
          data: scatter.map((d) => ({
            name: d.district,
            value: [d.avg_price, displayScore(d, "e2sfca_access_score"), displayScore(d, "calibrated_score_life_circle")],
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : scoreColor(displayScore(d, "calibrated_score_life_circle")) }
          }))
        }
      ]
    };
  }, [scatter, selectedDistrict]);

  const scoreModelCompareOption = useMemo<EChartsOption>(() => {
    const city = buildAverageMetric(scatter);
    const selected = selectedMetric ?? city;
    const fields = [
      { key: "livability_score" as const, label: "宜居分v1" },
      { key: "livability_score_v2" as const, label: "宜居分v2" },
      { key: "calibrated_score" as const, label: "校准分" },
      { key: "calibrated_score_life_circle" as const, label: "校准+生活圈" }
    ];
    return {
      grid: { top: 38, left: 50, right: 18, bottom: 46 },
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: fields.map((f) => f.label), axisLabel: axisText },
      yAxis: { type: "value", axisLabel: axisText },
      series: [
        { name: selected.district, type: "bar", barMaxWidth: 20, data: fields.map((f) => Number(displayScore(selected, f.key).toFixed(1))), itemStyle: { color: palette.primary } },
        { name: "全市均值", type: "bar", barMaxWidth: 20, data: fields.map((f) => Number(displayScore(city, f.key).toFixed(1))), itemStyle: { color: "#d8c4aa" } }
      ]
    };
  }, [scatter, selectedMetric]);

  const lifeCircleCompareOption = useMemo<EChartsOption>(() => {
    const city = buildAverageMetric(scatter);
    const selected = selectedMetric ?? city;
    const fields = [
      { key: "life_circle_5min_coverage" as const, label: "5分钟生活圈" },
      { key: "life_circle_10min_coverage" as const, label: "10分钟生活圈" },
      { key: "life_circle_15min_coverage" as const, label: "15分钟生活圈" }
    ];
    return {
      grid: { top: 38, left: 46, right: 18, bottom: 46 },
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: axisText },
      xAxis: { type: "category", data: fields.map((f) => f.label), axisLabel: axisText },
      yAxis: { type: "value", axisLabel: axisText, name: "覆盖率", nameTextStyle: axisText },
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
      { key: "e2sfca_access_score" as const, label: "设施供需充足度" }
    ];
    const selectedValues = fields.map((f) => Number(displayScore(selected, f.key).toFixed(1)));
    const cityValues = fields.map((f) => Number(displayScore(city, f.key).toFixed(1)));
    return {
      color: [palette.primary, palette.accent],
      tooltip: { trigger: "item" },
      legend: { bottom: 0, data: [selected.district, "全市均值"], textStyle: axisText },
      radar: {
        radius: "62%",
        center: ["50%", "44%"],
        indicator: fields.map((f) => ({ name: f.label, max: 10 })),
        axisName: { color: "#6f5a4c", fontSize: 11 },
        splitLine: { lineStyle: { color: "#ead8c2" } },
        splitArea: { areaStyle: { color: ["rgba(255,248,235,0.65)", "rgba(236,248,240,0.45)"] } }
      },
      series: [
        {
          type: "radar",
          data: [
            { name: selected.district, value: selectedValues },
            { name: "全市均值", value: cityValues }
          ],
          areaStyle: { opacity: 0.18 },
          emphasis: { focus: "series" }
        }
      ]
    };
  }, [scatter, selectedMetric]);

  const sampleReliabilityOption = useMemo<EChartsOption>(() => {
    const valid = scatter.filter((d) => d.house_count > 0);
    return {
      grid: { top: 24, left: 58, right: 22, bottom: 46 },
      tooltip: {
        formatter: (params: unknown) => {
          const data = readPointTooltipData(params);
          return `${data.name}<br/>样本量 ${Math.round(data.value[0])} 套<br/>可靠性 ${formatPercent(data.value[1])}<br/>校准评分 ${formatScore(data.value[2])}`;
        }
      },
      xAxis: { type: "value", name: "挂牌样本量 (套)", nameTextStyle: axisText, axisLabel: axisText },
      yAxis: { type: "value", name: "样本可靠性评分", nameTextStyle: axisText, axisLabel: axisText, min: 0, max: 1 },
      series: [
        {
          type: "scatter",
          symbolSize: (value: number[]) => Math.max(8, Math.min(28, Math.sqrt(value[0]) / 4)),
          data: valid.map((d) => ({
            name: d.district,
            value: [d.house_count, d.sample_reliability_score, displayScore(d, "calibrated_score_life_circle")],
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : scoreColor(displayScore(d, "calibrated_score_life_circle")) }
          }))
        }
      ]
    };
  }, [scatter, selectedDistrict]);

  const chartInsightData = useMemo<Record<string, Record<string, unknown>>>(() => {
    const selected = selectedMetric ?? cityMetric;
    return {
      priceTop10: {
        unit: "元/平方米",
        top: priceTop10.map((d) => ({ district: d.district, value: Math.round(d.avg_price) })),
        city_average: Math.round(cityMetric.avg_price)
      },
      boxplot: {
        unit: "元/平方米",
        values: percentileSummary(scatter.map((d) => d.avg_price)),
        city_average: Math.round(cityMetric.avg_price)
      },
      scoreRanking: {
        unit: "校准+生活圈评分",
        top: scoreRanking.slice(0, 10).map((d) => ({ district: d.district, value: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1)) })),
        selected: metricSnapshot(selected),
        city_average: metricSnapshot(cityMetric)
      },
      scoreHistogram: {
        bins: [
          { name: "低分", count: scatter.filter((d) => displayScore(d, "calibrated_score_life_circle") < 5.5).length },
          { name: "中低", count: scatter.filter((d) => displayScore(d, "calibrated_score_life_circle") >= 5.5 && displayScore(d, "calibrated_score_life_circle") < 6.5).length },
          { name: "中高", count: scatter.filter((d) => displayScore(d, "calibrated_score_life_circle") >= 6.5 && displayScore(d, "calibrated_score_life_circle") < 8).length },
          { name: "高分", count: scatter.filter((d) => displayScore(d, "calibrated_score_life_circle") >= 8).length }
        ]
      },
      quadrant: {
        x_axis: "平均房价",
        y_axis: "商圈活跃度",
        city_average: { avg_price: Math.round(cityMetric.avg_price), business_activity: Number(cityMetric.business_activity.toFixed(1)) },
        points: scatter.map((d) => ({
          district: d.district,
          avg_price: Math.round(d.avg_price),
          business_activity: Number(d.business_activity.toFixed(1)),
          poi_total: d.poi_total
        }))
      },
      poiShare: {
        scope: "上海市全市",
        top: poiCategories.map((item) => ({ name: item.category, value: item.count }))
      },
      groupedPoi: {
        top: scoreRanking.slice(0, 6).map((d) => ({
          district: d.district,
          shopping_count: d.shopping_count,
          traffic_count: d.traffic_count,
          healthcare_count: d.healthcare_count,
          score: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      poiStack: {
        top: scoreRanking.slice(0, 10).map((d) => ({
          district: d.district,
          shopping_count: d.shopping_count,
          traffic_count: d.traffic_count,
          healthcare_count: d.healthcare_count,
          recreation_count: d.recreation_count,
          company_count: d.company_count
        }))
      },
      shoppingTop5: {
        top: shoppingTop5.map((d) => ({ district: d.district, value: d.shopping_count }))
      },
      radar: {
        selected: metricSnapshot(selected),
        city_average: metricSnapshot(cityMetric)
      },
      accessValue: {
        selected: metricSnapshot(selected),
        city_average: metricSnapshot(cityMetric),
        points: scatter.map((d) => ({
          district: d.district,
          avg_price: Math.round(d.avg_price),
          e2sfca_access_score: Number(displayScore(d, "e2sfca_access_score").toFixed(1)),
          calibrated_score_life_circle: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      correlation: {
        matrix: relationMetrics.flatMap((row) =>
          relationMetrics.map((col) => ({
            row: row.label,
            col: col.label,
            value: Number(pearson(scatter, row.key, col.key).toFixed(2))
          }))
        )
      },
      parallel: {
        points: scatter.map((d) => ({
          district: d.district,
          avg_price: Math.round(d.avg_price),
          poi_total: d.poi_total,
          business_activity: Number(d.business_activity.toFixed(1)),
          calibrated_score_life_circle: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      perHouse: {
        top: scoreRanking.slice(0, 8).map((d) => ({
          district: d.district,
          shopping_per_house: Number(d.shopping_per_house.toFixed(4)),
          traffic_per_house: Number(d.traffic_per_house.toFixed(4)),
          healthcare_per_house: Number(d.healthcare_per_house.toFixed(4))
        }))
      },
      scoreModelCompare: {
        selected: scoreModelSnapshot(selected),
        city_average: scoreModelSnapshot(cityMetric)
      },
      lifeCircleCompare: {
        selected: lifeCircleSnapshot(selected),
        city_average: lifeCircleSnapshot(cityMetric)
      },
      sampleReliability: {
        points: scatter.map((d) => ({
          district: d.district,
          house_count: d.house_count,
          sample_reliability_score: Number(d.sample_reliability_score.toFixed(3)),
          calibrated_score_life_circle: Number(displayScore(d, "calibrated_score_life_circle").toFixed(1))
        }))
      },
      scoreComponent: {
        selected: scoreComponentSnapshot(selected),
        city_average: scoreComponentSnapshot(cityMetric)
      }
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
          {activeModule === "overview" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="priceTop10" title="房价 Top10 区域" desc="展示各区挂牌均价前 10，点击柱状或区名联动地图。" insightData={chartInsightData.priceTop10} insight={insights.priceTop10} loading={insightLoading.priceTop10} error={insightErrors.priceTop10} onInsight={loadChartInsight}>
                <EChart option={priceOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="boxplot" title="房价分布（箱线图）" desc="展示全市房价分布的箱线，便于查看离散与异常值。" insightData={chartInsightData.boxplot} insight={insights.boxplot} loading={insightLoading.boxplot} error={insightErrors.boxplot} onInsight={loadChartInsight}>
                <EChart option={boxplotOption} className="h-72 w-full" />
              </ChartCard>
              <ChartCard chartId="scoreRanking" title="校准评分排名" desc="按综合校准评分排序，支持点击选中区域联动。" insightData={chartInsightData.scoreRanking} insight={insights.scoreRanking} loading={insightLoading.scoreRanking} error={insightErrors.scoreRanking} onInsight={loadChartInsight}>
                <EChart option={scoreOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="scoreHistogram" title="校准评分区间分布" desc="展示区域评分分布，帮助识别高/低分簇群。" insightData={chartInsightData.scoreHistogram} insight={insights.scoreHistogram} loading={insightLoading.scoreHistogram} error={insightErrors.scoreHistogram} onInsight={loadChartInsight}>
                <EChart option={scoreHistogramOption} className="h-64 w-full" />
              </ChartCard>
              <ChartCard chartId="quadrant" title="房价与便利性象限" desc="按房价与商圈活跃度分象限，象限线为均值。" insightData={chartInsightData.quadrant} insight={insights.quadrant} loading={insightLoading.quadrant} error={insightErrors.quadrant} onInsight={loadChartInsight}>
                <EChart option={quadrantOption} className="h-64 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "poi" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="poiShare" title="POI类别占比" desc="全市各类 POI 占比，反映上海整体配套结构。" scope="上海市全市" selectedDistrictForInsight={null} insightData={chartInsightData.poiShare} insight={insights.poiShare} loading={insightLoading.poiShare} error={insightErrors.poiShare} onInsight={loadChartInsight}>
                <EChart option={poiOption} className="h-72 w-full" />
              </ChartCard>
              <ChartCard chartId="groupedPoi" title="热门区域 POI 分组柱状图" desc="对比高评分区域中购物、交通、医疗三类 POI。" insightData={chartInsightData.groupedPoi} insight={insights.groupedPoi} loading={insightLoading.groupedPoi} error={insightErrors.groupedPoi} onInsight={loadChartInsight}>
                <EChart option={groupedPoiOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="poiStack" title="校准评分较高区域 POI 结构" desc="展示高评分区域中不同 POI 类型的构成。" insightData={chartInsightData.poiStack} insight={insights.poiStack} loading={insightLoading.poiStack} error={insightErrors.poiStack} onInsight={loadChartInsight}>
                <EChart option={poiStackOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="shoppingTop5" title="购物数量 Top5 区域" desc="展示购物类 POI 数量排名前 5 的区域。" insightData={chartInsightData.shoppingTop5} insight={insights.shoppingTop5} loading={insightLoading.shoppingTop5} error={insightErrors.shoppingTop5} onInsight={loadChartInsight}>
                <EChart option={shoppingOption} className="h-64 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="radar" title="选中区域 vs 全市均值" desc="雷达对比选中区域与全市均值各项标准化指标。" insightData={chartInsightData.radar} insight={insights.radar} loading={insightLoading.radar} error={insightErrors.radar} onInsight={loadChartInsight}>
                <EChart option={radarOption} className="h-64 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "relation" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="accessValue" title="设施供需充足度与房价" desc="设施供需充足度与房价的关系，气泡大小反映校准评分。" insightData={chartInsightData.accessValue} insight={insights.accessValue} loading={insightLoading.accessValue} error={insightErrors.accessValue} onInsight={loadChartInsight}>
                <EChart option={accessValueOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="correlation" title="指标相关性热力图" desc="展示指标间 Pearson 相关系数，颜色越暖相关越强。" insightData={chartInsightData.correlation} insight={insights.correlation} loading={insightLoading.correlation} error={insightErrors.correlation} onInsight={loadChartInsight}>
                <EChart option={correlationOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard chartId="parallel" title="多指标平行坐标" desc="展示多维指标分布，点击线条可联动选中区域。" insightData={chartInsightData.parallel} insight={insights.parallel} loading={insightLoading.parallel} error={insightErrors.parallel} onInsight={loadChartInsight}>
                <EChart option={parallelOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard chartId="perHouse" title="人均设施供给强度" desc="每套房的购物/交通/医疗 POI 供给数，反映设施密度。" insightData={chartInsightData.perHouse} insight={insights.perHouse} loading={insightLoading.perHouse} error={insightErrors.perHouse} onInsight={loadChartInsight}>
                <EChart option={perHouseOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "model" ? (
            <div className="grid grid-cols-1 gap-4">
              <ChartCard chartId="scoreModelCompare" title="评分体系迭代对比" desc="对比不同阶段评分模型在选中区域的表现差异。" insightData={chartInsightData.scoreModelCompare} insight={insights.scoreModelCompare} loading={insightLoading.scoreModelCompare} error={insightErrors.scoreModelCompare} onInsight={loadChartInsight}>
                <EChart option={scoreModelCompareOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard chartId="lifeCircleCompare" title="生活圈覆盖率对比" desc="5/10/15分钟生活圈覆盖率，对比选中区域与全市均值。" insightData={chartInsightData.lifeCircleCompare} insight={insights.lifeCircleCompare} loading={insightLoading.lifeCircleCompare} error={insightErrors.lifeCircleCompare} onInsight={loadChartInsight}>
                <EChart option={lifeCircleCompareOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard chartId="sampleReliability" title="样本量与评分可靠性" desc="挂牌样本量与可靠性评分的关系，气泡大小反映校准评分。" insightData={chartInsightData.sampleReliability} insight={insights.sampleReliability} loading={insightLoading.sampleReliability} error={insightErrors.sampleReliability} onInsight={loadChartInsight}>
                <EChart option={sampleReliabilityOption} className="h-[28rem] w-full" onClick={handleChartClick} />
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

function ChartCard({
  title,
  children,
  desc,
  chartId,
  insightData,
  scope,
  selectedDistrictForInsight,
  insight,
  loading,
  error,
  onInsight
}: {
  title: string;
  children: ReactNode;
  desc?: string;
  chartId: string;
  insightData: Record<string, unknown>;
  scope?: string;
  selectedDistrictForInsight?: string | null;
  insight?: ChartInsight;
  loading?: boolean;
  error?: string;
  onInsight: (
    chartId: string,
    title: string,
    description: string | undefined,
    data: Record<string, unknown>,
    scope?: string,
    selectedDistrictForInsight?: string | null
  ) => void;
}) {
  const hasInsightContent = Boolean(insight || loading || error);
  const [insightOpen, setInsightOpen] = useState(false);
  const handleInsightClick = () => {
    setInsightOpen(true);
    onInsight(chartId, title, desc, insightData, scope, selectedDistrictForInsight);
  };

  useEffect(() => {
    if (loading || insight || error) setInsightOpen(true);
  }, [error, insight, loading]);

  return (
    <Card className="shrink-0 rounded-[18px] border-[#f1dfc9] bg-[#fffdf8]/92 shadow-[0_12px_34px_rgba(104,72,42,0.08)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-black text-[#3c2a20]">{title}</CardTitle>
        {desc ? <p className="mt-1 text-sm text-[#6b5345]">{desc}</p> : null}
      </CardHeader>
      <CardContent className="relative pb-4">
        <div className="min-w-0 pr-0 lg:pr-[25rem]">{children}</div>
        <button
          type="button"
          onClick={handleInsightClick}
          disabled={loading}
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
                  <Sparkles className="h-4 w-4 text-[#d45f34]" />
                  AI 图表结论
                </div>
                {insight?.is_placeholder ? <p className="mt-1 text-xs font-semibold text-[#a46322]">本地兜底结果</p> : null}
              </div>
              <button
                type="button"
                title="关闭"
                aria-label="关闭 AI 图表结论"
                onClick={() => setInsightOpen(false)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#7a5a45] transition hover:bg-[#f7e7d4] hover:text-[#3c2a20]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 overflow-y-auto pr-1 text-sm leading-7 text-[#5f4a3d]">
              <p className="whitespace-pre-wrap">
                {error ?? (loading ? "正在生成结论..." : insight?.insight ?? "暂无结论。")}
              </p>
            </div>
          </aside>
        ) : null}
      </CardContent>
    </Card>
  );
}

function average(items: DistrictMetric[], key: keyof DistrictMetric) {
  const values = items.map((item) => chartMetricValue(item, key)).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function chartMetricValue(item: DistrictMetric, key: keyof DistrictMetric) {
  return displayScoreKeys.has(key) ? displayScore(item, key) : Number(item[key]);
}

function pearson(items: DistrictMetric[], xKey: MetricKey, yKey: MetricKey) {
  if (items.length < 2) return 0;
  const xMean = average(items, xKey);
  const yMean = average(items, yKey);
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  items.forEach((item) => {
    const x = chartMetricValue(item, xKey) - xMean;
    const y = chartMetricValue(item, yKey) - yMean;
    numerator += x * y;
    xVariance += x * x;
    yVariance += y * y;
  });
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildRanges(items: DistrictMetric[], keys: MetricKey[]) {
  return keys.reduce(
    (ranges, key) => {
      const values = items.map((item) => chartMetricValue(item, key));
      ranges[key] = {
        min: Math.min(...values),
        max: Math.max(...values)
      };
      return ranges;
    },
    {} as Record<MetricKey, { min: number; max: number }>
  );
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

function percentileSummary(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  };
  return {
    min: Math.round(sorted[0]),
    q1: Math.round(q(0.25)),
    median: Math.round(q(0.5)),
    q3: Math.round(q(0.75)),
    max: Math.round(sorted[sorted.length - 1])
  };
}

function metricSnapshot(metric: DistrictMetric) {
  return {
    district: metric.district,
    avg_price: Math.round(metric.avg_price),
    poi_total: Math.round(metric.poi_total),
    shopping_count: Math.round(metric.shopping_count),
    traffic_count: Math.round(metric.traffic_count),
    healthcare_count: Math.round(metric.healthcare_count),
    business_activity: Number(metric.business_activity.toFixed(2)),
    e2sfca_access_score: Number(displayScore(metric, "e2sfca_access_score").toFixed(1)),
    calibrated_score: Number(displayScore(metric, "calibrated_score").toFixed(1)),
    calibrated_score_life_circle: Number(displayScore(metric, "calibrated_score_life_circle").toFixed(1))
  };
}

function scoreModelSnapshot(metric: DistrictMetric) {
  return {
    district: metric.district,
    livability_score: Number(displayScore(metric, "livability_score").toFixed(1)),
    livability_score_v2: Number(displayScore(metric, "livability_score_v2").toFixed(1)),
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
    district: "全市均值",
    avg_price: average(items, "avg_price"),
    avg_total_price: base?.avg_total_price ?? 0,
    house_count: base?.house_count ?? 0,
    poi_total: average(items, "poi_total"),
    recreation_count: average(items, "recreation_count"),
    company_count: average(items, "company_count"),
    residence_count: base?.residence_count ?? 0,
    shopping_count: average(items, "shopping_count"),
    traffic_count: average(items, "traffic_count"),
    healthcare_count: average(items, "healthcare_count"),
    business_activity: average(items, "business_activity"),
    activity_norm: base?.activity_norm ?? 0,
    price_norm: base?.price_norm ?? 0,
    livability_score: average(items, "livability_score"),
    livability_score_display: average(items, "livability_score_display"),
    poi_diversity: average(items, "poi_diversity"),
    shopping_per_house: average(items, "shopping_per_house"),
    traffic_per_house: average(items, "traffic_per_house"),
    healthcare_per_house: average(items, "healthcare_per_house"),
    recreation_per_house: average(items, "recreation_per_house"),
    company_per_house: average(items, "company_per_house"),
    cost_pressure: average(items, "cost_pressure"),
    affordability_score: average(items, "affordability_score"),
    affordability_score_display: average(items, "affordability_score_display"),
    service_score: average(items, "service_score"),
    service_score_display: average(items, "service_score_display"),
    vitality_score: average(items, "vitality_score"),
    vitality_score_display: average(items, "vitality_score_display"),
    livability_score_v2: average(items, "livability_score_v2"),
    livability_score_v2_display: average(items, "livability_score_v2_display"),
    shopping_access: average(items, "shopping_access"),
    traffic_access: average(items, "traffic_access"),
    healthcare_access: average(items, "healthcare_access"),
    recreation_access: average(items, "recreation_access"),
    company_access: average(items, "company_access"),
    nearest_traffic_distance: average(items, "nearest_traffic_distance"),
    nearest_healthcare_distance: average(items, "nearest_healthcare_distance"),
    access_score: average(items, "access_score"),
    access_score_display: average(items, "access_score_display"),
    value_score: average(items, "value_score"),
    value_score_display: average(items, "value_score_display"),
    shopping_e2sfca_access: average(items, "shopping_e2sfca_access"),
    traffic_e2sfca_access: average(items, "traffic_e2sfca_access"),
    healthcare_e2sfca_access: average(items, "healthcare_e2sfca_access"),
    recreation_e2sfca_access: average(items, "recreation_e2sfca_access"),
    company_e2sfca_access: average(items, "company_e2sfca_access"),
    e2sfca_access_score: average(items, "e2sfca_access_score"),
    e2sfca_access_score_display: average(items, "e2sfca_access_score_display"),
    e2sfca_value_score: average(items, "e2sfca_value_score"),
    e2sfca_value_score_display: average(items, "e2sfca_value_score_display"),
    sample_reliability_score: average(items, "sample_reliability_score"),
    calibrated_score: average(items, "calibrated_score"),
    calibrated_score_display: average(items, "calibrated_score_display"),
    life_circle_5min_score: average(items, "life_circle_5min_score"),
    life_circle_5min_score_display: average(items, "life_circle_5min_score_display"),
    life_circle_10min_score: average(items, "life_circle_10min_score"),
    life_circle_10min_score_display: average(items, "life_circle_10min_score_display"),
    life_circle_15min_score: average(items, "life_circle_15min_score"),
    life_circle_15min_score_display: average(items, "life_circle_15min_score_display"),
    life_circle_score: average(items, "life_circle_score"),
    life_circle_score_display: average(items, "life_circle_score_display"),
    life_circle_5min_coverage: average(items, "life_circle_5min_coverage"),
    life_circle_10min_coverage: average(items, "life_circle_10min_coverage"),
    life_circle_15min_coverage: average(items, "life_circle_15min_coverage"),
    calibrated_score_life_circle: average(items, "calibrated_score_life_circle"),
    calibrated_score_life_circle_display: average(items, "calibrated_score_life_circle_display"),
    center_lng: null,
    center_lat: null
  };
}

export default ChartsPanel;
