import { AlertCircle, Loader2, Navigation, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { recommendHouses } from "../lib/agentApi";
import { formatPrice } from "../lib/utils";
import type {
  CommuteMode,
  HouseRecommendRequest,
  HouseRecommendResponse,
  HouseRecommendation,
  StreetRecommendation
} from "../types/agent";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const DEFAULT_FORM: HouseRecommendRequest = {
  budget_wan: 500,
  target_area: 80,
  work_address: "上海市浦东新区张江高科",
  commute_mode: "transit",
  max_commute_minutes: 45,
  top_streets: 5,
  top_houses_per_street: 3,
  max_route_calls: 120
};

const commuteModeOptions: Array<{ label: string; value: CommuteMode }> = [
  { label: "公共交通", value: "transit" },
  { label: "驾车", value: "driving" }
];

export default function PersonalizedAgentPanel() {
  const [form, setForm] = useState<HouseRecommendRequest>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HouseRecommendResponse | null>(null);

  const housesByStreet = useMemo(() => {
    if (!result) return new Map<string, HouseRecommendation[]>();
    const map = new Map<string, HouseRecommendation[]>();
    result.houses.forEach((house) => {
      const key = `${house.district}::${house.sub_district}`;
      const current = map.get(key) ?? [];
      current.push(house);
      map.set(key, current);
    });
    return map;
  }, [result]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: HouseRecommendRequest = {
        ...form,
        budget_wan: Number(form.budget_wan),
        target_area: Number(form.target_area),
        max_commute_minutes: Number(form.max_commute_minutes),
        top_streets: Number(form.top_streets),
        top_houses_per_street: Number(form.top_houses_per_street),
        max_route_calls: Number(form.max_route_calls)
      };
      const response = await recommendHouses(payload);
      setResult(response);
    } catch {
      setError("推荐接口暂不可用，请确认后端服务已启动并检查高德 Key 配置。");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="h-full overflow-y-auto rounded-[18px] border border-[#ead8c2] bg-[#fffaf1]/92 p-4 shadow-[0_18px_56px_rgba(104,72,42,0.10)]">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff0df] text-[#d45f34]">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-black text-[#33251f]">个性化区域与房源推荐</h2>
          <p className="text-xs text-[#806653]">先筛通勤可达街道，再推荐具体房源</p>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <Field label="预算（万元）">
          <input
            className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]"
            type="number"
            min={1}
            step={1}
            value={form.budget_wan}
            onChange={(event) => setForm((prev) => ({ ...prev, budget_wan: Number(event.target.value) || 0 }))}
            required
          />
        </Field>

        <Field label="目标面积（平方米）">
          <input
            className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]"
            type="number"
            min={1}
            step={1}
            value={form.target_area}
            onChange={(event) => setForm((prev) => ({ ...prev, target_area: Number(event.target.value) || 0 }))}
            required
          />
        </Field>

        <Field label="工作地地址">
          <input
            className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]"
            type="text"
            value={form.work_address}
            onChange={(event) => setForm((prev) => ({ ...prev, work_address: event.target.value }))}
            required
          />
        </Field>

        <Field label="通勤方式">
          <Select
            value={form.commute_mode}
            onValueChange={(value) => setForm((prev) => ({ ...prev, commute_mode: value as CommuteMode }))}
          >
            <SelectTrigger className="h-9 w-full border-[#ead8c2] bg-white text-[#33251f]">
              <SelectValue placeholder="选择通勤方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {commuteModeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field label="最大可接受通勤时间（分钟）">
          <input
            className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]"
            type="number"
            min={1}
            step={1}
            value={form.max_commute_minutes}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, max_commute_minutes: Number(event.target.value) || 0 }))
            }
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="街道数量">
            <input
              className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]"
              type="number"
              min={1}
              max={20}
              value={form.top_streets}
              onChange={(event) => setForm((prev) => ({ ...prev, top_streets: Number(event.target.value) || 1 }))}
              required
            />
          </Field>
          <Field label="每街道房源数">
            <input
              className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]"
              type="number"
              min={1}
              max={10}
              value={form.top_houses_per_street}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, top_houses_per_street: Number(event.target.value) || 1 }))
              }
              required
            />
          </Field>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="h-9 w-full bg-[#d45f34] text-white hover:bg-[#bd4f27]"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          生成街道与房源推荐
        </Button>
      </form>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#f3c99a] bg-[#fff3df] p-3 text-sm text-[#9a5a1d]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {result?.work_location ? (
          <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-xs text-[#775f4d]">
            工作地坐标：{result.work_location}
          </div>
        ) : null}

        {result?.summary ? (
          <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-xs text-[#775f4d]">
            候选房源 {result.summary.candidate_houses ?? 0} 套，路线计算 {result.summary.route_calls ?? 0} 次。
          </div>
        ) : null}

        {!loading && result && result.streets.length === 0 ? (
          <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-sm text-[#775f4d]">
            暂无可推荐街道，请放宽预算或通勤约束后重试。
          </div>
        ) : null}

        {result?.streets.map((street) => {
          const key = `${street.district}::${street.sub_district}`;
          const houses = housesByStreet.get(key) ?? [];
          return <StreetCard key={key} street={street} houses={houses} />;
        })}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-[#775f4d]">{label}</div>
      {children}
    </label>
  );
}

function StreetCard({
  street,
  houses
}: {
  street: StreetRecommendation;
  houses: HouseRecommendation[];
}) {
  const scoreLabel = `${Math.round(street.street_score * 100)} 分`;
  const commuteLabel =
    street.median_commute_minutes === null ? "暂无" : `${Math.round(street.median_commute_minutes)} 分钟`;
  const affordableLabel = `${Math.round(street.affordable_ratio * 100)}%`;

  return (
    <Card className="border-[#f1dfc9] bg-[#fffdf8] shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm text-[#3c2a20]">
          <span>
            {street.district} · {street.sub_district}
          </span>
          <Badge className="bg-[#33a985] text-white">{scoreLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-[#5f4a3d]">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="中位通勤" value={commuteLabel} icon={<Navigation className="h-3.5 w-3.5" />} />
          <Metric label="样本房源" value={street.house_count.toLocaleString("zh-CN")} />
          <Metric label="可负担占比" value={affordableLabel} />
        </div>

        <div>
          <div className="font-semibold text-[#33251f]">街道理由</div>
          <p className="mt-1 leading-5">{street.reason}</p>
        </div>

        <div className="space-y-2">
          <div className="font-semibold text-[#33251f]">推荐房源</div>
          {houses.length === 0 ? (
            <p className="text-[#806653]">暂无房源可展示。</p>
          ) : (
            houses.map((house) => <HouseItem key={house.house_id} house={house} />)
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HouseItem({ house }: { house: HouseRecommendation }) {
  const commuteLabel = house.commute_minutes === null ? "暂无" : `${Math.round(house.commute_minutes)} 分钟`;
  const areaLabel = house.area === null ? "面积未知" : `${house.area.toFixed(1)}㎡`;
  return (
    <div className="rounded-md border border-[#f3e1cb] bg-white/75 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12px] font-semibold text-[#33251f] line-clamp-2">
          {house.title || `${house.community_name || "房源"} ${house.house_id}`}
        </div>
        <Badge variant="outline" className="border-[#f3c99a] bg-[#fff4df] text-[#9a5a1d]">
          {Math.round(house.score * 100)}
        </Badge>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-[#6e5543]">
        <span>{formatPrice(house.unit_price)}</span>
        <span>{house.total_price.toFixed(1)} 万</span>
        <span>{commuteLabel}</span>
        <span>{areaLabel}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-[#6a5242]">{house.reason}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[#f3e1cb] bg-white/70 p-2">
      <div className="flex items-center gap-1 text-[11px] text-[#8a6f5a]">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xs font-semibold text-[#33251f]">{value}</div>
    </div>
  );
}
