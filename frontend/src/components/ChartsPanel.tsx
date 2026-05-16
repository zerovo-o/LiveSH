import type { EChartsOption } from "echarts";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import EChart from "./charts/EChart";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { DistrictMetric, PoiCategory } from "../types/metrics";

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

const axisText = { color: "#7b6758", fontSize: 11 };
const grid = { top: 20, left: 46, right: 18, bottom: 46 };
const selectedColor = "#2f241c";

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
  { key: "shopping_count", label: "购物", color: "#ff8a5c" },
  { key: "traffic_count", label: "交通", color: "#3b82f6" },
  { key: "healthcare_count", label: "医疗", color: "#10b981" },
  { key: "recreation_count", label: "休闲", color: "#f59e0b" },
  { key: "company_count", label: "企业", color: "#8b5cf6" }
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
  const selectedMetric = useMemo(
    () => scatter.find((item) => item.district === selectedDistrict) ?? scoreRanking[0] ?? scatter[0],
    [scatter, scoreRanking, selectedDistrict]
  );

  const handleChartClick = useCallback(
    (params: any) => {
      const name = typeof params.name === "string" ? params.name : params.data?.name;
      if (name) onSelectDistrict(name);
    },
    [onSelectDistrict]
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
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : "#ff8a5c" }
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
      color: ["#ff8a5c", "#f7c948", "#31b78f", "#3b82f6", "#8b5cf6", "#ef6f8f"],
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
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : "#31b78f" }
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
            value: Number(d.calibrated_score_life_circle.toFixed(3)),
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : scoreColor(d.calibrated_score_life_circle) }
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
        formatter: (params: any) => {
          const data = params.data as { name: string; value: number[] };
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
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : scoreColor(d.calibrated_score_life_circle) }
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
        formatter: (params: any) => {
          const [x, y, value] = params.data as number[];
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
          emphasis: { itemStyle: { borderColor: "#2f241c", borderWidth: 1 } }
        }
      ]
    };
  }, [scatter]);

  const scoreHistogramOption = useMemo<EChartsOption>(() => {
    const bins = [
      { name: "低分", min: -Infinity, max: 0.15, color: "#ef6f61" },
      { name: "中低", min: 0.15, max: 0.3, color: "#f59e0b" },
      { name: "中高", min: 0.3, max: 0.45, color: "#31b78f" },
      { name: "高分", min: 0.45, max: Infinity, color: "#16a3b8" }
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
            value: scatter.filter((d) => d.calibrated_score_life_circle >= bin.min && d.calibrated_score_life_circle < bin.max).length,
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
        const value = normalize(Number(metric[field.key]), ranges[field.key]);
        return Number((field.inverse ? 1 - value : value).toFixed(3));
      });

    return {
      color: ["#ff8a5c", "#31b78f"],
      tooltip: {},
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
          areaStyle: { opacity: 0.18 }
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
        formatter: (params: any) => {
          const row = scatter[params.dataIndex];
          return row ? `${row.district}<br/>房价 ${Math.round(row.avg_price).toLocaleString("zh-CN")} 元/㎡<br/>POI ${row.poi_total.toLocaleString("zh-CN")}<br/>活跃度 ${row.business_activity.toFixed(1)}<br/>校准评分 ${row.calibrated_score_life_circle.toFixed(3)}` : "";
        }
      },
      series: [
        {
          type: "parallel",
          lineStyle: { width: 2, opacity: 0.46 },
          data: scatter.map((d) => ({
            name: d.district,
            value: fields.map((field) => Number(d[field.key])),
            lineStyle: {
              color: d.district === selectedDistrict ? selectedColor : scoreColor(d.calibrated_score_life_circle),
              opacity: d.district === selectedDistrict ? 0.95 : 0.42,
              width: d.district === selectedDistrict ? 4 : 2
            }
          }))
        }
      ]
    };
  }, [scatter, selectedDistrict]);

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
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCard title="房价 Top10 区域">
                <EChart option={priceOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="校准评分排名">
                <EChart option={scoreOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="校准评分区间分布">
                <EChart option={scoreHistogramOption} className="h-64 w-full" />
              </ChartCard>
              <ChartCard title="房价与便利性象限">
                <EChart option={quadrantOption} className="h-64 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "poi" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCard title="POI类别占比">
                <EChart option={poiOption} className="h-72 w-full" />
              </ChartCard>
              <ChartCard title="校准评分较高区域 POI 结构">
                <EChart option={poiStackOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="购物数量 Top5 区域">
                <EChart option={shoppingOption} className="h-64 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="选中区域 vs 全市均值">
                <EChart option={radarOption} className="h-64 w-full" />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "relation" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCard title="房价与便利性象限">
                <EChart option={quadrantOption} className="h-80 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="指标相关性热力图">
                <EChart option={correlationOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard title="多指标平行坐标">
                <EChart option={parallelOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="房价 Top10 区域">
                <EChart option={priceOption} className="h-72 w-full" onClick={handleChartClick} />
              </ChartCard>
            </div>
          ) : null}

          {activeModule === "model" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCard title="选中区域 vs 全市均值">
                <EChart option={radarOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard title="校准评分区间分布">
                <EChart option={scoreHistogramOption} className="h-80 w-full" />
              </ChartCard>
              <ChartCard title="校准评分排名">
                <EChart option={scoreOption} className="h-[28rem] w-full" onClick={handleChartClick} />
              </ChartCard>
              <ChartCard title="指标相关性热力图">
                <EChart option={correlationOption} className="h-[28rem] w-full" />
              </ChartCard>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
});

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="shrink-0 rounded-[18px] border-[#f1dfc9] bg-[#fffdf8]/92 shadow-[0_12px_34px_rgba(104,72,42,0.08)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-black text-[#3c2a20]">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function average(items: DistrictMetric[], key: keyof DistrictMetric) {
  const values = items.map((item) => Number(item[key])).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(items: DistrictMetric[], xKey: MetricKey, yKey: MetricKey) {
  if (items.length < 2) return 0;
  const xMean = average(items, xKey);
  const yMean = average(items, yKey);
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  items.forEach((item) => {
    const x = Number(item[xKey]) - xMean;
    const y = Number(item[yKey]) - yMean;
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
      const values = items.map((item) => Number(item[key]));
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
    poi_diversity: average(items, "poi_diversity"),
    shopping_per_house: average(items, "shopping_per_house"),
    traffic_per_house: average(items, "traffic_per_house"),
    healthcare_per_house: average(items, "healthcare_per_house"),
    recreation_per_house: average(items, "recreation_per_house"),
    company_per_house: average(items, "company_per_house"),
    cost_pressure: average(items, "cost_pressure"),
    affordability_score: average(items, "affordability_score"),
    service_score: average(items, "service_score"),
    vitality_score: average(items, "vitality_score"),
    livability_score_v2: average(items, "livability_score_v2"),
    shopping_access: average(items, "shopping_access"),
    traffic_access: average(items, "traffic_access"),
    healthcare_access: average(items, "healthcare_access"),
    recreation_access: average(items, "recreation_access"),
    company_access: average(items, "company_access"),
    nearest_traffic_distance: average(items, "nearest_traffic_distance"),
    nearest_healthcare_distance: average(items, "nearest_healthcare_distance"),
    access_score: average(items, "access_score"),
    value_score: average(items, "value_score"),
    shopping_e2sfca_access: average(items, "shopping_e2sfca_access"),
    traffic_e2sfca_access: average(items, "traffic_e2sfca_access"),
    healthcare_e2sfca_access: average(items, "healthcare_e2sfca_access"),
    recreation_e2sfca_access: average(items, "recreation_e2sfca_access"),
    company_e2sfca_access: average(items, "company_e2sfca_access"),
    e2sfca_access_score: average(items, "e2sfca_access_score"),
    e2sfca_value_score: average(items, "e2sfca_value_score"),
    sample_reliability_score: average(items, "sample_reliability_score"),
    calibrated_score: average(items, "calibrated_score"),
    life_circle_5min_score: average(items, "life_circle_5min_score"),
    life_circle_10min_score: average(items, "life_circle_10min_score"),
    life_circle_15min_score: average(items, "life_circle_15min_score"),
    life_circle_score: average(items, "life_circle_score"),
    life_circle_5min_coverage: average(items, "life_circle_5min_coverage"),
    life_circle_10min_coverage: average(items, "life_circle_10min_coverage"),
    life_circle_15min_coverage: average(items, "life_circle_15min_coverage"),
    calibrated_score_life_circle: average(items, "calibrated_score_life_circle"),
    center_lng: null,
    center_lat: null
  };
}

function scoreColor(score: number) {
  if (score >= 0.2) return "#16a3b8";
  if (score >= 0) return "#31b78f";
  if (score >= -0.2) return "#f59e0b";
  return "#ef6f61";
}

export default ChartsPanel;
