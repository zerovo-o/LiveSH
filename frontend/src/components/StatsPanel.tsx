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
    <section className="rounded-lg border border-slate-200 bg-white/90 p-4 shadow-soft">
      <div className="shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">区域选择</h2>
          <Badge>{districts.length} 个区</Badge>
        </div>
        <Select
          value={selected?.district ?? ALL_VALUE}
          onValueChange={(value) => onSelectDistrict(value === ALL_VALUE ? null : value)}
        >
          <SelectTrigger className="mt-3 w-full bg-white">
            <SelectValue placeholder="选择区域" />
          </SelectTrigger>
          <SelectContent>
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

      <Card className="mt-4 shadow-none">
        <CardHeader>
          <CardTitle>{isAll ? "全市汇总" : `${active.district} 区域详情`}</CardTitle>
          <Badge>{isAll ? "全部" : `评分 ${formatScore(active.livability_score)}`}</Badge>
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
            <Metric label={isAll ? "平均评分" : "宜居评分"} value={formatScore(active.livability_score)} icon={<MapPinned className="h-4 w-4" />} />
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
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-base font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function buildCitySummary(districts: DistrictMetric[]): DistrictMetric {
  const houseCount = districts.reduce((sum, item) => sum + item.house_count, 0);
  const weighted = (field: "avg_price" | "avg_total_price") =>
    houseCount
      ? districts.reduce((sum, item) => sum + item[field] * item.house_count, 0) / houseCount
      : 0;
  const average = (field: "livability_score" | "business_activity" | "price_norm" | "activity_norm") =>
    districts.length ? districts.reduce((sum, item) => sum + item[field], 0) / districts.length : 0;

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
    center_lng: null,
    center_lat: null
  };
}
