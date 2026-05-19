import { Building2, ChevronRight, Loader2, MapPinned, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPrice, formatScore } from "../lib/utils";
import type { DistrictMetric, StreetMetric } from "../types/metrics";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatPrice } from "../lib/utils";
import type { DistrictMetric, StreetMetric } from "../types/metrics";

type StreetPanelProps = {
  districts: DistrictMetric[];
  selectedDistrict: string | null;
  onSelectDistrict: (district: string | null) => void;
};

const ALL_VALUE = "全部区域";
const STREET_RECOMMENDATION_MIN_HOUSE_COUNT = 50;

function formatOptionalScore(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : "暂无";
}

function formatDistance(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "暂无";
  return `${Math.round(numeric).toLocaleString("zh-CN")} m`;
}

function formatPercent(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : "暂无";
}

export default function StreetPanel({ districts, selectedDistrict, onSelectDistrict }: StreetPanelProps) {
  const [streets, setStreets] = useState<StreetMetric[]>([]);
  const [selectedStreetId, setSelectedStreetId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/streets");
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as StreetMetric[];
      setStreets(data);
    } catch {
      setError("街道/镇数据暂不可用，请先重新运行后端入库脚本。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim();
    return streets
      .filter((item) => {
        const districtMatched = !selectedDistrict || item.district === selectedDistrict;
        const keywordMatched = !keyword || item.street.includes(keyword) || item.district.includes(keyword);
        const houseCountMatched = Number(item.house_count) >= STREET_RECOMMENDATION_MIN_HOUSE_COUNT;
        return districtMatched && keywordMatched && houseCountMatched;
      })
      .sort((a, b) => (Number(b.calibrated_score_life_circle) || 0) - (Number(a.calibrated_score_life_circle) || 0));
  }, [query, selectedDistrict, streets]);

  const selectedStreet = useMemo(() => {
    if (selectedStreetId) {
      const current = filtered.find((item) => item.id === selectedStreetId);
      if (current) return current;
    }
    return filtered[0] ?? null;
  }, [filtered, selectedStreetId]);

  return (
    <section className="rounded-[24px] border border-[#ead8c2] bg-[#fff8ea]/88 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f7ef] text-[#1d8f70]">
              <MapPinned className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-[#33251f]">街道/镇精细分析</h2>
            </div>
          </div>
        </div>
        <Badge variant="outline" className="border-[#bfe6d6] bg-[#eefbf4] text-[#21745d]">
          {loading ? "加载中" : `${filtered.length} 个街道/镇`}
        </Badge>
        <Badge variant="outline" className="border-[#f3c99a] bg-[#fff4df] text-[#9a5a1d]">
          推荐门槛 ≥50 房源
        </Badge>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Select
          value={selectedDistrict ?? ALL_VALUE}
          onValueChange={(value) => {
            setSelectedStreetId(null);
            onSelectDistrict(value === ALL_VALUE ? null : value);
          }}
        >
          <SelectTrigger className="h-10 w-44 border-[#ead8c2] bg-white/78 text-[#33251f]">
            <SelectValue placeholder="选择行政区" />
          </SelectTrigger>
          <SelectContent className="w-44 min-w-44">
            <SelectGroup>
              <SelectItem value={ALL_VALUE}>全部区域</SelectItem>
              {districts.map((item) => (
                <SelectItem key={item.district} value={item.district}>
                  {item.district}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <label className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-[#ead8c2] bg-white/78 px-3 text-sm text-[#806653]">
          <Search className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => {
              setSelectedStreetId(null);
              setQuery(event.target.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-[#33251f] outline-none placeholder:text-[#a58b76]"
            placeholder="搜索街道/镇或行政区"
          />
        </label>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setQuery("");
            setSelectedStreetId(null);
          }}
          className="h-10 border-[#ead8c2] bg-white/78 text-[#6e5543] hover:bg-[#fff4df]"
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          重置
        </Button>
      </div>

      {loading ? (
        <div className="mt-5 flex h-48 items-center justify-center rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/80 text-sm text-[#806653]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载街道/镇指标
        </div>
      ) : error ? (
        <div className="mt-5 rounded-xl border border-[#f2c798] bg-[#fff7e7] p-4 text-sm text-[#9a5a1d]">{error}</div>
      ) : selectedStreet ? (
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
            {filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedStreetId(item.id);
                  onSelectDistrict(item.district);
                }}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                  selectedStreet.id === item.id
                    ? "border-[#7ed5b8] bg-[#eefbf4]"
                    : "border-[#f1dfc9] bg-[#fffdf8]/88 hover:border-[#f3c99a] hover:bg-[#fff9ef]"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff0df] text-sm font-black text-[#b25332]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-[#33251f]">
                    {item.district} · {item.street}
                  </span>
                  <span className="mt-1 block text-xs text-[#806653]">
                    {formatPrice(item.avg_price)} / POI {item.poi_total.toLocaleString("zh-CN")}
                    {(item.sample_reliability_score ?? 1) < 1 ? " / 样本不足" : ""}
                  </span>
                </span>
                <Badge className="shrink-0 bg-[#33a985] text-white">
                  {formatOptionalScore(item.calibrated_score_life_circle)}
                </Badge>
              </button>
            ))}
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="border-[#f1dfc9] bg-[#fffdf8]/92 shadow-none">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-[#33251f]">
                  {selectedStreet.district}
                  <ChevronRight className="h-4 w-4 text-[#a58b76]" />
                  {selectedStreet.street}
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[#33a985] text-white">
                    校准评分 {formatOptionalScore(selectedStreet.calibrated_score_life_circle)}
                  </Badge>
                  <Badge variant="outline" className="border-[#d8ccff] bg-[#f4f0ff] text-[#6d4fc2]">
                    生活圈 {formatOptionalScore(selectedStreet.life_circle_score)}
                  </Badge>
                  {(selectedStreet.sample_reliability_score ?? 1) < 1 ? (
                    <Badge variant="outline" className="border-[#f3c99a] bg-[#fff4df] text-[#9a5a1d]">
                      样本不足，评分已降权
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-4">
                  <StreetMetricCard label="校准评分" value={formatOptionalScore(selectedStreet.calibrated_score_life_circle)} />
                  <StreetMetricCard label="生活圈总分" value={formatOptionalScore(selectedStreet.life_circle_score)} />
                  <StreetMetricCard label="5分钟基础生活" value={formatOptionalScore(selectedStreet.life_circle_5min_score)} />
                  <StreetMetricCard label="10分钟日常生活" value={formatOptionalScore(selectedStreet.life_circle_10min_score)} />
                  <StreetMetricCard label="15分钟城市资源" value={formatOptionalScore(selectedStreet.life_circle_15min_score)} />
                  <StreetMetricCard label="5分钟覆盖率" value={formatPercent(selectedStreet.life_circle_5min_coverage)} />
                  <StreetMetricCard label="10分钟覆盖率" value={formatPercent(selectedStreet.life_circle_10min_coverage)} />
                  <StreetMetricCard label="15分钟覆盖率" value={formatPercent(selectedStreet.life_circle_15min_coverage)} />
                  <StreetMetricCard label="样本可信度" value={formatOptionalScore(selectedStreet.sample_reliability_score)} />
                  <StreetMetricCard label="供需可达性" value={formatOptionalScore(selectedStreet.e2sfca_access_score)} />
                  <StreetMetricCard label="房价负担分" value={formatOptionalScore(selectedStreet.affordability_score)} />
                  <StreetMetricCard label="POI多样性" value={formatOptionalScore(selectedStreet.poi_diversity)} />
                  <StreetMetricCard label="可达性分" value={formatOptionalScore(selectedStreet.access_score)} />
                  <StreetMetricCard label="性价比分" value={formatOptionalScore(selectedStreet.value_score)} />
                  <StreetMetricCard label="最近交通" value={formatDistance(selectedStreet.nearest_traffic_distance)} />
                  <StreetMetricCard label="最近医疗" value={formatDistance(selectedStreet.nearest_healthcare_distance)} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/80 p-5 text-sm text-[#806653]">
          当前筛选下没有达到推荐门槛的街道/镇。
        </div>
      )}
    </section>
  );
}

function StreetMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#f4e3cf] bg-[#fff8ed]/72 p-3">
      <div className="flex items-center gap-2 text-xs text-[#8a6f5a]">
        <Building2 className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-[#33251f]">{value}</div>
    </div>
  );
}
