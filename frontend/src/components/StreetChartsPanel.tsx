import { MapPinned, Network } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import EChart from "./charts/EChart";
import { displayScore, formatScore } from "../lib/utils";
import type { EChartsOption } from "echarts";
import type { DistrictMetric, RouteStreetMetric, StreetMetric } from "../types/metrics";

const MIN_HOUSE_COUNT = 50;

const axisText = { color: "#7b6758", fontSize: 11 };
const xAxisName = {
  nameLocation: "middle" as const,
  nameGap: 34,
  nameTextStyle: axisText,
  axisLabel: axisText,
};
const yAxisName = {
  nameLocation: "middle" as const,
  nameGap: 46,
  nameTextStyle: axisText,
  axisLabel: axisText,
};

const gradientColors = ["#22c55e", "#84cc16", "#eab308", "#f97316", "#ef4444"];

function rankPct(rank: number, total: number): number {
  return Math.round((rank / total) * 100);
}

function rankLabel(rank: number, total: number): string {
  const pct = rank / total;
  if (pct <= 0.1) return "优秀";
  if (pct <= 0.25) return "良好";
  if (pct <= 0.5) return "中等";
  if (pct <= 0.75) return "偏弱";
  return "较弱";
}

function rankColor(rank: number, total: number): string {
  const pct = rank / total;
  if (pct <= 0.1) return gradientColors[0];
  if (pct <= 0.25) return gradientColors[1];
  if (pct <= 0.5) return gradientColors[2];
  if (pct <= 0.75) return gradientColors[3];
  return gradientColors[4];
}

function stripPlotOption(
  sorted: StreetMetric[],
  selected: StreetMetric | null,
  metricKey: keyof DistrictMetric,
  label: string,
): EChartsOption {
  if (!selected || sorted.length === 0) return {};
  const total = sorted.length;
  const rank = sorted.findIndex((s) => s.id === selected.id) + 1;
  const values = sorted.map((s) => displayScore(s, metricKey));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const dots = sorted.map((s, i) => {
    const isSel = s.id === selected.id;
    return {
      name: `${s.district} · ${s.street}`,
      value: [displayScore(s, metricKey), 0],
      rank: i + 1,
      district: s.district,
      street: s.street,
      itemStyle: {
        color: isSel ? rankColor(i + 1, total) : "rgba(148, 163, 184, 0.4)",
      },
      symbolSize: isSel ? 14 : 4,
      label: isSel ? {
        show: true,
        position: "top" as const,
        distance: 10,
        formatter: `{b}\n${formatScore(displayScore(s, metricKey))}`,
        color: rankColor(i + 1, total),
        fontSize: 11,
        fontWeight: "bold" as const,
        lineHeight: 16,
      } : undefined,
    };
  });

  const selVal = displayScore(selected, metricKey);

  return {
    grid: { top: 44, left: 52, right: 24, bottom: 28 },
    title: {
      text: `${label}`,
      subtext: `排名 ${rank}/${total}（前 ${rankPct(rank, total)}%）· ${rankLabel(rank, total)}`,
      left: 0, top: 0,
      textStyle: { fontSize: 14, color: "#33251f", fontWeight: "bold" as const },
      subtextStyle: { fontSize: 12, color: rankColor(rank, total), fontWeight: "bold" as const },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: any) => {
        const d = params.data;
        if (!d || d.value[1] !== 0) return "";
        return `<b>#${d.rank}</b> ${d.district} · ${d.street}<br/>${label}: ${formatScore(d.value[0])}`;
      },
    },
    xAxis: {
      type: "value", min: min - range * 0.05, max: max + range * 0.05,
      axisLabel: axisText, splitLine: { lineStyle: { color: "#f0e4d4" } },
    },
    yAxis: { type: "value", show: false, min: -0.5, max: 0.5 },
    series: [
      { type: "scatter", data: dots, z: 1 },
      {
        type: "scatter",
        data: [{
          value: [selVal, 0], symbol: "roundRect", symbolSize: [3, 36],
          itemStyle: { color: rankColor(rank, total) },
          label: {
            show: true, position: "bottom" as const, distance: 8,
            formatter: `#${rank}`,
            color: rankColor(rank, total), fontSize: 12, fontWeight: "bold" as const,
          },
        }],
        z: 10,
      },
    ],
  } as EChartsOption;
}

function comboScatterOption(
  streets: StreetMetric[],
  selected: StreetMetric | null,
): EChartsOption {
  if (!selected || streets.length === 0) return {};
  const total = streets.length;
  const calRank = [...streets].sort((a, b) =>
    displayScore(b, "calibrated_score_life_circle") - displayScore(a, "calibrated_score_life_circle")
  ).findIndex((s) => s.id === selected.id) + 1;
  const lcRank = [...streets].sort((a, b) =>
    displayScore(b, "life_circle_score") - displayScore(a, "life_circle_score")
  ).findIndex((s) => s.id === selected.id) + 1;

  const data = streets.map((s) => {
    const isSel = s.id === selected.id;
    return {
      name: `${s.district} · ${s.street}`,
      value: [displayScore(s, "calibrated_score_life_circle"), displayScore(s, "life_circle_score")],
      itemStyle: {
        color: isSel ? "#1d4ed8" : "rgba(148, 163, 184, 0.45)",
      },
      symbolSize: isSel ? 14 : 5,
      label: isSel ? {
        show: true,
        position: "top" as const,
        distance: 8,
        formatter: `${s.street}\n校准 ${formatScore(displayScore(s, "calibrated_score_life_circle"))} · 生活圈 ${formatScore(displayScore(s, "life_circle_score"))}`,
        color: "#1d4ed8",
        fontSize: 11,
        fontWeight: "bold" as const,
        lineHeight: 16,
      } : undefined,
    };
  });

  return {
    grid: { top: 76, left: 68, right: 34, bottom: 66, containLabel: true },
    title: {
      text: "校准评分 vs 生活圈总分",
      subtext: `校准排名 ${calRank}/${total} · 生活圈排名 ${lcRank}/${total}`,
      left: 0, top: 0,
      textStyle: { fontSize: 14, color: "#33251f", fontWeight: "bold" as const },
      subtextStyle: { fontSize: 12, color: "#6b5345" },
    },
    tooltip: {
      formatter: (params: any) => {
        const d = params.data;
        if (!d) return "";
        return `<b>${d.name}</b><br/>校准评分 ${formatScore(d.value[0])}<br/>生活圈总分 ${formatScore(d.value[1])}`;
      },
    },
    xAxis: {
      type: "value", name: "校准评分", ...xAxisName,
      splitLine: { lineStyle: { color: "#f0e4d4" } },
    },
    yAxis: {
      type: "value", name: "生活圈总分", ...yAxisName,
      splitLine: { lineStyle: { color: "#f0e4d4" } },
    },
    series: [{ type: "scatter", data, emphasis: { focus: "series" } }],
  } as EChartsOption;
}

// --------------- 2.0 route-based chart helpers ---------------

function deltaBarOption(
  streets: StreetMetric[],
  routeMap: Map<string, RouteStreetMetric>,
  selected: StreetMetric | null,
  scoreKey: "calibrated_score_life_circle" | "life_circle_score",
  routeDisplayKey: "calibrated_score_life_circle_route_display" | "life_circle_score_route_display",
  title: string,
): EChartsOption {
  const withRoute = streets.filter((s) => routeMap.has(streetKey(s.district, s.street)));
  if (withRoute.length === 0) return {};
  const sorted = [...withRoute].sort((a, b) => {
    const ra = routeMap.get(streetKey(a.district, a.street))!;
    const rb = routeMap.get(streetKey(b.district, b.street))!;
    return (Number(rb[routeDisplayKey]) || 0) - (Number(ra[routeDisplayKey]) || 0);
  });
  const original = sorted.map((s) => displayScore(s, scoreKey));
  const route = sorted.map((s) => {
    const r = routeMap.get(streetKey(s.district, s.street))!;
    return Number(r[routeDisplayKey]) || 0;
  });
  const labels = sorted.map((s) => s.street);

  return {
    grid: { top: 52, left: 52, right: 24, bottom: 76, containLabel: true },
    title: { text: title, left: 0, top: 0, textStyle: { fontSize: 13, color: "#33251f", fontWeight: "bold" as const } },
    tooltip: { trigger: "axis" },
    legend: { top: 0, right: 8, data: ["默认版", "步行路网2.0"], textStyle: axisText },
    xAxis: { type: "category", data: labels, axisLabel: { ...axisText, rotate: 35 }, axisTick: { alignWithLabel: true } },
    yAxis: { type: "value", axisLabel: axisText, splitLine: { lineStyle: { color: "#f0e4d4" } } },
    series: [
      { name: "默认版", type: "bar", barMaxWidth: 14, data: original.map((v) => Number(formatScore(v))), itemStyle: { color: "#94a3b8" } },
      { name: "步行路网2.0", type: "bar", barMaxWidth: 14, data: route, itemStyle: { color: "#7c3aed" } },
    ],
  };
}

function streetKey(d: string, s: string) { return `${d}|${s}`; }

function routeLifeCircleEndpoint(district: string | null) {
  if (district === "杨浦" || district === "杨浦区") return "/api/streets/route-life-circle/yangpu";
  if (district === "黄浦" || district === "黄浦区") return "/api/streets/route-life-circle/huangpu";
  if (district === "嘉定" || district === "嘉定区") return "/api/streets/route-life-circle/jiading";
  return null;
}

// --------------- Props & Component ---------------

type Props = { district: string | null };

export default function StreetChartsPanel({ district }: Props) {
  const [allStreets, setAllStreets] = useState<StreetMetric[]>([]);
  const [routeMetrics, setRouteMetrics] = useState<RouteStreetMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStreetId, setSelectedStreetId] = useState<number | null>(null);

  const routeEndpoint = routeLifeCircleEndpoint(district);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [streetRes, routeRes] = await Promise.all([
        fetch("/api/streets"),
        routeEndpoint ? fetch(routeEndpoint) : Promise.resolve(null),
      ]);
      if (!streetRes.ok) throw new Error(`streets API ${streetRes.status}`);
      setAllStreets((await streetRes.json()) as StreetMetric[]);
      if (routeRes) {
        setRouteMetrics(routeRes.ok ? ((await routeRes.json()) as RouteStreetMetric[]) : []);
      } else {
        setRouteMetrics([]);
      }
    } catch {
      setError("街道数据加载失败，请确认后端 API 已启动。");
    } finally {
      setLoading(false);
    }
  }, [routeEndpoint]);

  useEffect(() => { load(); }, [load]);

  // All qualified streets across Shanghai — ranking baseline
  const qualified = useMemo(
    () => allStreets.filter((s) => s.house_count >= MIN_HOUSE_COUNT),
    [allStreets],
  );

  // Only streets in the selected district — for the picker list
  const districtStreets = useMemo(() => {
    if (!district) return [];
    return qualified.filter((s) => s.district === district);
  }, [qualified, district]);

  // Reset selection when district changes, auto-pick first street
  useEffect(() => {
    setSelectedStreetId(null);
  }, [district]);

  const selected = useMemo(() => {
    if (selectedStreetId) return districtStreets.find((s) => s.id === selectedStreetId) ?? null;
    return districtStreets[0] ?? null;
  }, [districtStreets, selectedStreetId]);

  const sortedByE2sfca = useMemo(
    () => [...qualified].sort((a, b) => displayScore(b, "e2sfca_access_score") - displayScore(a, "e2sfca_access_score")),
    [qualified],
  );
  const sortedByAffordability = useMemo(
    () => [...qualified].sort((a, b) => displayScore(b, "affordability_score") - displayScore(a, "affordability_score")),
    [qualified],
  );
  const sortedByAccess = useMemo(
    () => [...qualified].sort((a, b) => displayScore(b, "access_score") - displayScore(a, "access_score")),
    [qualified],
  );
  const sortedByValue = useMemo(
    () => [...qualified].sort((a, b) => displayScore(b, "value_score") - displayScore(a, "value_score")),
    [qualified],
  );

  const comboOption = useMemo<EChartsOption>(
    () => comboScatterOption(qualified, selected), [qualified, selected],
  );
  const e2sfcaOption = useMemo<EChartsOption>(
    () => stripPlotOption(sortedByE2sfca, selected, "e2sfca_access_score", "设施供需充足度"),
    [sortedByE2sfca, selected],
  );
  const affordabilityOption = useMemo<EChartsOption>(
    () => stripPlotOption(sortedByAffordability, selected, "affordability_score", "房价负担分"),
    [sortedByAffordability, selected],
  );
  const accessOption = useMemo<EChartsOption>(
    () => stripPlotOption(sortedByAccess, selected, "access_score", "可达性分"),
    [sortedByAccess, selected],
  );
  const valueOption = useMemo<EChartsOption>(
    () => stripPlotOption(sortedByValue, selected, "value_score", "性价比分"),
    [sortedByValue, selected],
  );

  // ---------- 2.0 route charts ----------
  const routeMap = useMemo(() => {
    const map = new Map<string, RouteStreetMetric>();
    for (const r of routeMetrics) map.set(streetKey(r.district, r.street), r);
    return map;
  }, [routeMetrics]);

  const routeCalCompareOption = useMemo<EChartsOption>(
    () => deltaBarOption(qualified, routeMap, selected, "calibrated_score_life_circle", "calibrated_score_life_circle_route_display", "校准评分 1.0 vs 2.0"),
    [qualified, routeMap, selected],
  );
  const routeLcCompareOption = useMemo<EChartsOption>(
    () => deltaBarOption(qualified, routeMap, selected, "life_circle_score", "life_circle_score_route_display", "生活圈总分 1.0 vs 2.0"),
    [qualified, routeMap, selected],
  );

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[#806653]">
        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#d4c0a8] border-t-[#b25332]" />
        正在加载街道数据...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[#f2c798] bg-[#fff7e7] p-4 text-sm text-[#9a5a1d]">{error}</div>
    );
  }

  if (!district) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 text-sm text-[#806653]">
        请先在「街道/镇精细分析」面板中选择一个行政区。
      </div>
    );
  }

  if (districtStreets.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 text-sm text-[#806653]">
        {district}当前没有达到推荐门槛（≥{MIN_HOUSE_COUNT}房源）的街道/镇。
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 p-3">
        <div className="flex items-center gap-2">
          <MapPinned className="h-4 w-4 text-[#ff7a4f]" />
          <span className="text-sm font-semibold text-[#33251f]">{district}</span>
          <span className="text-xs text-[#8a6f5a]">
            {districtStreets.length} 个街镇
          </span>
        </div>
      </div>

      {/* Street List + Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        {/* Left: Street list (scoped to district) */}
        <div className="max-h-[520px] space-y-1 overflow-y-auto rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 p-2">
          {districtStreets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedStreetId(s.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                selected?.id === s.id
                  ? "bg-[#eefbf4] font-semibold text-[#176b50]"
                  : "text-[#33251f] hover:bg-[#fff9ef]"
              }`}
            >
              <span className="block truncate">{s.street}</span>
            </button>
          ))}
        </div>

        {/* Right: Charts */}
        <div className="min-h-0 space-y-4">
          {!selected ? (
            <div className="flex h-48 items-center justify-center rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 text-sm text-[#806653]">
              请从左侧选择一个街道/镇。
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 p-4">
                <EChart option={comboOption} className="h-80 w-full" />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartBox option={e2sfcaOption} />
                <ChartBox option={affordabilityOption} />
                <ChartBox option={accessOption} />
                <ChartBox option={valueOption} />
              </div>

              {routeEndpoint && routeMetrics.length > 0 ? (
                <div className="space-y-4 rounded-xl border border-[#d8ccff] bg-[#faf8ff]/88 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#ede4ff]">
                      <Network className="h-5 w-5 text-[#7c3aed]" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-[#33251f]">核心评分 2.0 对比</h3>
                      <p className="text-xs text-[#8a6f5a]">基于高德步行路网实际路径时间重算 · 当前行政区</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#e9dffa] bg-white/72 p-4">
                    <EChart option={routeCalCompareOption} className="h-[30rem] w-full" />
                  </div>
                  <div className="rounded-xl border border-[#e9dffa] bg-white/72 p-4">
                    <EChart option={routeLcCompareOption} className="h-[30rem] w-full" />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartBox({ option }: { option: EChartsOption }) {
  return (
    <div className="rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/88 p-4">
      <EChart option={option} className="h-52 w-full" />
    </div>
  );
}
