import { BarChart3, Building2, Factory, Hospital, MapPinned, ShoppingBag, TrainFront, Trees } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { displayScore, formatPrice, formatScore } from "../lib/utils";
import type { DistrictMetric } from "../types/metrics";

type StatsPanelProps = {
  selected: DistrictMetric | null;
  districts: DistrictMetric[];
  onSelectDistrict: (district: string | null) => void;
};

const ALL_VALUE = "全部区域";

type MetricKey = keyof DistrictMetric;

type MetricItem = {
  key: MetricKey;
  label: string;
  value: string;
  icon: ReactNode;
};

export default function StatsPanel({ selected, districts, onSelectDistrict }: StatsPanelProps) {
  const [showRankings, setShowRankings] = useState(false);
  const citySummary = useMemo(() => buildCitySummary(districts), [districts]);
  const active = selected ?? citySummary;
  const isAll = selected === null;
  const metricItems = useMemo(() => buildMetricItems(active, isAll), [active, isAll]);
  const rankings = useMemo(() => buildDistrictRankings(districts), [districts]);
  const districtTotal = districts.length;

  return (
    <section className="rounded-[20px] border border-[#ead8c2] bg-[#fff8ed]/82 p-4 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur-sm">
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-black text-[#33251f]">区域选择</h2>
          <Select
            value={selected?.district ?? ALL_VALUE}
            onValueChange={(value) => onSelectDistrict(value === ALL_VALUE ? null : value)}
          >
            <SelectTrigger className="h-10 w-44 border-[#ead8c2] bg-white/72 text-[#33251f] shadow-[0_8px_24px_rgba(104,72,42,0.06)]">
              <SelectValue placeholder="选择区域" />
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
        </div>
      </div>

      <Card className="mt-3 border-[#f1dfc9] bg-[#fffdf8]/82 shadow-none">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-[#33251f]">{isAll ? "全市汇总" : `${active.district} 区域详情`}</CardTitle>
              <Badge className="mt-2 bg-[#33a985] text-white">
                {isAll ? "全部" : `评分 ${formatScore(displayScore(active, "calibrated_score_life_circle"))}`}
              </Badge>
            </div>
            {!isAll ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRankings((value) => !value)}
                className="h-8 border-[#f3c99a] bg-[#fff4df] px-3 text-xs font-semibold text-[#9a5a1d] hover:bg-[#ffe9c8]"
              >
                {showRankings ? "隐藏排名" : "显示排名"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-4">
            {metricItems.map((item) => (
              <Metric
                key={String(item.key)}
                label={item.label}
                value={item.value}
                icon={item.icon}
                rank={showRankings && !isAll ? rankings[item.key]?.get(active.district) : undefined}
                total={districtTotal}
              />
            ))}
          </div>
        </CardContent>
      </Card>

    </section>
  );
}

function Metric({
  label,
  value,
  icon,
  rank,
  total,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  rank?: number;
  total: number;
}) {
  return (
    <div className="flex min-h-[76px] flex-col rounded-xl border border-[#f4e3cf] bg-[#fff8ed]/72 p-3">
      <div className="flex items-center gap-2 text-xs text-[#8a6f5a]">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 flex flex-1 items-end justify-between gap-3">
        <div className="min-w-0 text-base font-semibold text-[#33251f]">{value}</div>
        {rank ? (
          <div className="shrink-0 rounded-md border border-[#f3c99a] bg-[#fff4df] px-2 py-1 text-xs font-semibold text-[#9a5a1d]">
            第 {rank}/{total}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildMetricItems(active: DistrictMetric, isAll: boolean): MetricItem[] {
  const items: MetricItem[] = [
    { key: "avg_price", label: "平均房价", value: formatPrice(active.avg_price), icon: <BarChart3 className="h-4 w-4" /> },
    { key: "avg_total_price", label: "平均总价", value: `${active.avg_total_price.toFixed(1)} 万`, icon: <BarChart3 className="h-4 w-4" /> },
    { key: "house_count", label: "房源数量", value: active.house_count.toLocaleString("zh-CN"), icon: <Building2 className="h-4 w-4" /> },
    { key: "poi_total", label: "POI总数", value: active.poi_total.toLocaleString("zh-CN"), icon: <Building2 className="h-4 w-4" /> },
    { key: "shopping_count", label: "购物", value: active.shopping_count.toLocaleString("zh-CN"), icon: <ShoppingBag className="h-4 w-4" /> },
    { key: "traffic_count", label: "交通", value: active.traffic_count.toLocaleString("zh-CN"), icon: <TrainFront className="h-4 w-4" /> },
    { key: "healthcare_count", label: "医疗", value: active.healthcare_count.toLocaleString("zh-CN"), icon: <Hospital className="h-4 w-4" /> },
    { key: "recreation_count", label: "休闲", value: active.recreation_count.toLocaleString("zh-CN"), icon: <Trees className="h-4 w-4" /> },
    { key: "company_count", label: "企业", value: active.company_count.toLocaleString("zh-CN"), icon: <Factory className="h-4 w-4" /> },
    { key: "residence_count", label: "住宅", value: active.residence_count.toLocaleString("zh-CN"), icon: <Building2 className="h-4 w-4" /> },
    {
      key: "business_activity",
      label: "商圈活跃度指数",
      value: active.business_activity.toLocaleString("zh-CN", { maximumFractionDigits: 1 }),
      icon: <MapPinned className="h-4 w-4" />,
    },
    {
      key: "calibrated_score_life_circle",
      label: isAll ? "平均校准评分" : "校准评分",
      value: formatScore(displayScore(active, "calibrated_score_life_circle")),
      icon: <MapPinned className="h-4 w-4" />,
    },
  ];

  return items;
}

function buildDistrictRankings(districts: DistrictMetric[]): Partial<Record<MetricKey, Map<string, number>>> {
  const keys: MetricKey[] = [
    "avg_price",
    "avg_total_price",
    "house_count",
    "poi_total",
    "shopping_count",
    "traffic_count",
    "healthcare_count",
    "recreation_count",
    "company_count",
    "residence_count",
    "business_activity",
    "calibrated_score_life_circle",
    "e2sfca_access_score",
    "sample_reliability_score",
    "price_norm",
    "activity_norm",
  ];

  return keys.reduce<Partial<Record<MetricKey, Map<string, number>>>>((result, key) => {
    const sorted = [...districts].sort((a, b) => {
      const diff = Number(b[key]) - Number(a[key]);
      return diff || a.district.localeCompare(b.district, "zh-CN");
    });
    result[key] = new Map(sorted.map((item, index) => [item.district, index + 1]));
    return result;
  }, {});
}

function buildCitySummary(districts: DistrictMetric[]): DistrictMetric {
  const houseCount = districts.reduce((sum, item) => sum + item.house_count, 0);
  const weighted = (field: "avg_price" | "avg_total_price") =>
    houseCount
      ? districts.reduce((sum, item) => sum + item[field] * item.house_count, 0) / houseCount
      : 0;
  const average = (field: keyof DistrictMetric) => {
    const values = districts.map((item) => Number(item[field])).filter((value) => Number.isFinite(value));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  };

  return {
    district: "全部区域",
    avg_price: weighted("avg_price"),
    avg_total_price: weighted("avg_total_price"),
    house_count: houseCount,
    poi_total: districts.reduce((sum, item) => sum + item.poi_total, 0),
    recreation_count: districts.reduce((sum, item) => sum + item.recreation_count, 0),
    company_count: districts.reduce((sum, item) => sum + item.company_count, 0),
    residence_count: districts.reduce((sum, item) => sum + item.residence_count, 0),
    shopping_count: districts.reduce((sum, item) => sum + item.shopping_count, 0),
    traffic_count: districts.reduce((sum, item) => sum + item.traffic_count, 0),
    healthcare_count: districts.reduce((sum, item) => sum + item.healthcare_count, 0),
    business_activity: average("business_activity"),
    activity_norm: average("activity_norm"),
    price_norm: average("price_norm"),
    livability_score: average("livability_score"),
    livability_score_display: average("livability_score_display"),
    poi_diversity: average("poi_diversity"),
    shopping_per_house: average("shopping_per_house"),
    traffic_per_house: average("traffic_per_house"),
    healthcare_per_house: average("healthcare_per_house"),
    recreation_per_house: average("recreation_per_house"),
    company_per_house: average("company_per_house"),
    cost_pressure: average("cost_pressure"),
    affordability_score: average("affordability_score"),
    affordability_score_display: average("affordability_score_display"),
    service_score: average("service_score"),
    service_score_display: average("service_score_display"),
    vitality_score: average("vitality_score"),
    vitality_score_display: average("vitality_score_display"),
    livability_score_v2: average("livability_score_v2"),
    livability_score_v2_display: average("livability_score_v2_display"),
    shopping_access: average("shopping_access"),
    traffic_access: average("traffic_access"),
    healthcare_access: average("healthcare_access"),
    recreation_access: average("recreation_access"),
    company_access: average("company_access"),
    nearest_traffic_distance: average("nearest_traffic_distance"),
    nearest_healthcare_distance: average("nearest_healthcare_distance"),
    access_score: average("access_score"),
    access_score_display: average("access_score_display"),
    value_score: average("value_score"),
    value_score_display: average("value_score_display"),
    shopping_e2sfca_access: average("shopping_e2sfca_access"),
    traffic_e2sfca_access: average("traffic_e2sfca_access"),
    healthcare_e2sfca_access: average("healthcare_e2sfca_access"),
    recreation_e2sfca_access: average("recreation_e2sfca_access"),
    company_e2sfca_access: average("company_e2sfca_access"),
    e2sfca_access_score: average("e2sfca_access_score"),
    e2sfca_access_score_display: average("e2sfca_access_score_display"),
    e2sfca_value_score: average("e2sfca_value_score"),
    e2sfca_value_score_display: average("e2sfca_value_score_display"),
    sample_reliability_score: average("sample_reliability_score"),
    calibrated_score: average("calibrated_score"),
    calibrated_score_display: average("calibrated_score_display"),
    life_circle_5min_score: average("life_circle_5min_score"),
    life_circle_5min_score_display: average("life_circle_5min_score_display"),
    life_circle_10min_score: average("life_circle_10min_score"),
    life_circle_10min_score_display: average("life_circle_10min_score_display"),
    life_circle_15min_score: average("life_circle_15min_score"),
    life_circle_15min_score_display: average("life_circle_15min_score_display"),
    life_circle_score: average("life_circle_score"),
    life_circle_score_display: average("life_circle_score_display"),
    life_circle_5min_coverage: average("life_circle_5min_coverage"),
    life_circle_10min_coverage: average("life_circle_10min_coverage"),
    life_circle_15min_coverage: average("life_circle_15min_coverage"),
    calibrated_score_life_circle: average("calibrated_score_life_circle"),
    calibrated_score_life_circle_display: average("calibrated_score_life_circle_display"),
    center_lng: null,
    center_lat: null
  };
}
