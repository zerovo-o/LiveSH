import { Building2, ChevronRight, Loader2, MapPinned, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatPrice, formatScore } from "../lib/utils";
import type { DistrictMetric, StreetMetric } from "../types/metrics";

type StreetPanelProps = {
  districts: DistrictMetric[];
  selectedDistrict: string | null;
  onSelectDistrict: (district: string | null) => void;
};

const ALL_VALUE = "全部区域";

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
    return streets.filter((item) => {
      const districtMatched = !selectedDistrict || item.district === selectedDistrict;
      const keywordMatched = !keyword || item.street.includes(keyword) || item.district.includes(keyword);
      return districtMatched && keywordMatched;
    });
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
                  </span>
                </span>
                <Badge className="shrink-0 bg-[#33a985] text-white">{formatScore(item.livability_score)}</Badge>
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
                <Badge className="bg-[#ff7a4f] text-white">评分 {formatScore(selectedStreet.livability_score)}</Badge>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-4">
                  <StreetMetricCard label="平均房价" value={formatPrice(selectedStreet.avg_price)} />
                  <StreetMetricCard label="平均总价" value={`${selectedStreet.avg_total_price.toFixed(1)} 万`} />
                  <StreetMetricCard label="房源数量" value={selectedStreet.house_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="POI总数" value={selectedStreet.poi_total.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="购物" value={selectedStreet.shopping_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="交通" value={selectedStreet.traffic_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="医疗" value={selectedStreet.healthcare_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="休闲" value={selectedStreet.recreation_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="企业" value={selectedStreet.company_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="住宅" value={selectedStreet.residence_count.toLocaleString("zh-CN")} />
                  <StreetMetricCard label="活跃度" value={selectedStreet.business_activity.toFixed(1)} />
                  <StreetMetricCard label="房价标准化" value={formatScore(selectedStreet.price_norm)} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-[#f1dfc9] bg-[#fffdf8]/80 p-5 text-sm text-[#806653]">
          没有匹配到街道/镇数据。
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
