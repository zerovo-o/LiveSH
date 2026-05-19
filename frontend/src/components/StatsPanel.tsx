import { BarChart3, Building2, Factory, Hospital, MapPinned, ShoppingBag, TrainFront, Trees } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { formatPrice, formatScore } from "../lib/utils";
import type { DistrictMetric } from "../types/metrics";

type StatsPanelProps = {
  selected: DistrictMetric | null;
  districts: DistrictMetric[];
  onSelectDistrict: (district: string | null) => void;
};

const ALL_VALUE = "全部区域";

export default function StatsPanel({ selected, districts, onSelectDistrict }: StatsPanelProps) {
  const citySummary = useMemo(() => buildCitySummary(districts), [districts]);
  const active = selected ?? citySummary;
  const isAll = selected === null;

  return (
    <section className="rounded-[20px] border border-[#ead8c2] bg-[#fff8ed]/82 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur-sm">
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
          <Badge variant="outline" className="ml-auto border-[#f3c99a] bg-[#fff4df] text-[#9a5a1d]">{districts.length} 个区</Badge>
        </div>
      </div>

      <Card className="mt-4 border-[#f1dfc9] bg-[#fffdf8]/82 shadow-none">
        <CardHeader>
          <CardTitle className="text-[#33251f]">{isAll ? "全市汇总" : `${active.district} 区域详情`}</CardTitle>
          <Badge className="bg-[#33a985] text-white">{isAll ? "全部" : `评分 ${formatScore(active.calibrated_score_life_circle)}`}</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 xl:grid-cols-4">
            <Metric label="平均房价" value={formatPrice(active.avg_price)} icon={<BarChart3 className="h-4 w-4" />} />
            <Metric label="平均总价" value={`${active.avg_total_price.toFixed(1)} 万`} icon={<BarChart3 className="h-4 w-4" />} />
            <Metric label="房源数量" value={active.house_count.toLocaleString("zh-CN")} icon={<Building2 className="h-4 w-4" />} />
            <Metric label="POI总数" value={active.poi_total.toLocaleString("zh-CN")} icon={<Building2 className="h-4 w-4" />} />
            <Metric label="购物" value={active.shopping_count.toLocaleString("zh-CN")} icon={<ShoppingBag className="h-4 w-4" />} />
            <Metric label="交通" value={active.traffic_count.toLocaleString("zh-CN")} icon={<TrainFront className="h-4 w-4" />} />
            <Metric label="医疗" value={active.healthcare_count.toLocaleString("zh-CN")} icon={<Hospital className="h-4 w-4" />} />
            <Metric label="休闲" value={active.recreation_count.toLocaleString("zh-CN")} icon={<Trees className="h-4 w-4" />} />
            <Metric label="企业" value={active.company_count.toLocaleString("zh-CN")} icon={<Factory className="h-4 w-4" />} />
            <Metric label="住宅" value={active.residence_count.toLocaleString("zh-CN")} icon={<Building2 className="h-4 w-4" />} />
            <Metric label="活跃度" value={active.business_activity.toFixed(1)} icon={<MapPinned className="h-4 w-4" />} />
            <Metric label={isAll ? "平均校准评分" : "校准评分"} value={formatScore(active.calibrated_score_life_circle)} icon={<MapPinned className="h-4 w-4" />} />
            <Metric label={isAll ? "平均供需可达性" : "供需可达性"} value={formatScore(active.e2sfca_access_score)} icon={<MapPinned className="h-4 w-4" />} />
            <Metric label="样本可信度" value={formatScore(active.sample_reliability_score)} icon={<Building2 className="h-4 w-4" />} />
            {!isAll ? (
              <>
                <Metric label="房价标准化" value={formatScore(active.price_norm)} icon={<BarChart3 className="h-4 w-4" />} />
                <Metric label="活跃度标准化" value={formatScore(active.activity_norm)} icon={<MapPinned className="h-4 w-4" />} />
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#f4e3cf] bg-[#fff8ed]/72 p-3">
      <div className="flex items-center gap-2 text-xs text-[#8a6f5a]">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-[#33251f]">{value}</div>
    </div>
  );
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
    poi_diversity: average("poi_diversity"),
    shopping_per_house: average("shopping_per_house"),
    traffic_per_house: average("traffic_per_house"),
    healthcare_per_house: average("healthcare_per_house"),
    recreation_per_house: average("recreation_per_house"),
    company_per_house: average("company_per_house"),
    cost_pressure: average("cost_pressure"),
    affordability_score: average("affordability_score"),
    service_score: average("service_score"),
    vitality_score: average("vitality_score"),
    livability_score_v2: average("livability_score_v2"),
    shopping_access: average("shopping_access"),
    traffic_access: average("traffic_access"),
    healthcare_access: average("healthcare_access"),
    recreation_access: average("recreation_access"),
    company_access: average("company_access"),
    nearest_traffic_distance: average("nearest_traffic_distance"),
    nearest_healthcare_distance: average("nearest_healthcare_distance"),
    access_score: average("access_score"),
    value_score: average("value_score"),
    shopping_e2sfca_access: average("shopping_e2sfca_access"),
    traffic_e2sfca_access: average("traffic_e2sfca_access"),
    healthcare_e2sfca_access: average("healthcare_e2sfca_access"),
    recreation_e2sfca_access: average("recreation_e2sfca_access"),
    company_e2sfca_access: average("company_e2sfca_access"),
    e2sfca_access_score: average("e2sfca_access_score"),
    e2sfca_value_score: average("e2sfca_value_score"),
    sample_reliability_score: average("sample_reliability_score"),
    calibrated_score: average("calibrated_score"),
    life_circle_5min_score: average("life_circle_5min_score"),
    life_circle_10min_score: average("life_circle_10min_score"),
    life_circle_15min_score: average("life_circle_15min_score"),
    life_circle_score: average("life_circle_score"),
    life_circle_5min_coverage: average("life_circle_5min_coverage"),
    life_circle_10min_coverage: average("life_circle_10min_coverage"),
    life_circle_15min_coverage: average("life_circle_15min_coverage"),
    calibrated_score_life_circle: average("calibrated_score_life_circle"),
    center_lng: null,
    center_lat: null
  };
}
