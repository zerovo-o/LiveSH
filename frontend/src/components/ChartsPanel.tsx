import type { EChartsOption } from "echarts";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import EChart from "./charts/EChart";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { DistrictMetric, PoiCategory } from "../types/metrics";

type ModuleId = "overview" | "poi" | "relation" | "ranking";

const modules: { id: ModuleId; label: string }[] = [
  { id: "overview", label: "房价概览" },
  { id: "poi", label: "POI结构" },
  { id: "relation", label: "关系分析" },
  { id: "ranking", label: "宜居排名" }
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

const axisText = { color: "#64748b", fontSize: 11 };
const grid = { top: 18, left: 42, right: 16, bottom: 44 };

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
  const selectedColor = "#111827";
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
            value: Math.round(d.avg_price),
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : "#3b82f6" }
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
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          center: ["50%", "44%"],
          data: poiCategories.map((item) => ({ name: item.category, value: item.count })),
          label: { formatter: "{b}", color: "#334155" }
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
            value: d.shopping_count,
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : "#10b981" }
          })),
          barMaxWidth: 26
        }
      ]
    }),
    [shoppingTop5, selectedDistrict]
  );

  const scatterOption = useMemo<EChartsOption>(
    () => ({
      grid: { top: 18, left: 50, right: 18, bottom: 44 },
      tooltip: {
        formatter: (params: any) => {
          const data = params.data as { name: string; value: number[] };
          return `${data.name}<br/>活跃度 ${data.value[0].toFixed(1)}<br/>房价 ${Math.round(data.value[1]).toLocaleString("zh-CN")} 元/㎡`;
        }
      },
      xAxis: { type: "value", name: "商圈活跃度", nameTextStyle: axisText, axisLabel: axisText },
      yAxis: { type: "value", name: "房价", nameTextStyle: axisText, axisLabel: axisText },
      series: [
        {
          type: "scatter",
          symbolSize: (value: number[]) => Math.max(8, Math.min(24, value[2] / 30000)),
          data: scatter.map((d) => ({
            name: d.district,
            value: [d.business_activity, d.avg_price, d.poi_total],
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : "#f59e0b" }
          }))
        }
      ]
    }),
    [scatter, selectedDistrict]
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
            value: Number(d.livability_score.toFixed(3)),
            itemStyle: { color: d.district === selectedDistrict ? selectedColor : d.livability_score >= 0 ? "#14b8a6" : "#ef4444" }
          })),
          barMaxWidth: 18
        }
      ]
    }),
    [scoreRanking, selectedDistrict]
  );

  return (
    <section className="rounded-[20px] border border-[#ead8c2] bg-white/82 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)]">
      <div>
        <h2 className="text-lg font-semibold text-[#33251f]">可视化分析</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => setActiveModule(module.id)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                activeModule === module.id
                  ? "border-[#ff9f72] bg-[#fff0df] text-[#a44724] shadow-[0_8px_20px_rgba(255,122,79,0.16)]"
                  : "border-[#ead8c2] bg-white text-[#775f4d] hover:border-[#f3c99a] hover:bg-[#fff9ef]"
              }`}
            >
              {module.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {activeModule === "overview" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="房价 Top10 区域">
              <EChart option={priceOption} className="h-64 w-full" onClick={handleChartClick} />
            </ChartCard>
            <ChartCard title="房价 vs 商圈活跃度">
              <EChart option={scatterOption} className="h-64 w-full" onClick={handleChartClick} />
            </ChartCard>
          </div>
          ) : null}

          {activeModule === "poi" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="POI类别占比">
              <EChart option={poiOption} className="h-64 w-full" />
            </ChartCard>
            <ChartCard title="购物数量 Top5 区域">
              <EChart option={shoppingOption} className="h-56 w-full" onClick={handleChartClick} />
            </ChartCard>
          </div>
          ) : null}

          {activeModule === "relation" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="房价 vs 商圈活跃度">
              <EChart option={scatterOption} className="h-72 w-full" onClick={handleChartClick} />
            </ChartCard>
            <ChartCard title="房价 Top10 区域">
              <EChart option={priceOption} className="h-56 w-full" onClick={handleChartClick} />
            </ChartCard>
          </div>
          ) : null}

          {activeModule === "ranking" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="宜居性评分排名">
              <EChart option={scoreOption} className="h-[28rem] w-full" onClick={handleChartClick} />
            </ChartCard>
            <ChartCard title="购物数量 Top5 区域">
              <EChart option={shoppingOption} className="h-56 w-full" onClick={handleChartClick} />
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
    <Card className="shrink-0 border-[#f1dfc9] bg-[#fffdf8] shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default ChartsPanel;
