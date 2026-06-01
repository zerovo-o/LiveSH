import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { recommendHouses } from "../lib/agentApi";
import type {
  CommuteMode,
  CommunityRecommendation,
  HouseRecommendRequest,
  HouseRecommendResponse,
} from "../types/agent";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const DEFAULT_FORM: HouseRecommendRequest = {
  budget_wan: 500,
  target_area: 80,
  work_address: "上海火车站",
  commute_mode: "transit",
  max_commute_minutes: 45,
  top_streets: 5,
  top_houses_per_street: 3,
  top_communities: 3,
  top_houses_per_community: 3,
  daily_life_weight: 1.0,
  commute_facility_weight: 1.0,
  medical_weight: 1.0,
  education_weight: 0.8,
  recreation_weight: 0.8,
  employment_weight: 0.6,
  max_route_calls: 120,
};

const commuteModeOptions: Array<{ label: string; value: CommuteMode }> = [
  { label: "公共交通", value: "transit" },
  { label: "驾驶", value: "driving" },
];

export default function PersonalizedAgentPanel() {
  const [form, setForm] = useState<HouseRecommendRequest>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HouseRecommendResponse | null>(null);

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
        top_communities: Number(form.top_communities),
        top_houses_per_community: Number(form.top_houses_per_community),
        daily_life_weight: Number(form.daily_life_weight),
        commute_facility_weight: Number(form.commute_facility_weight),
        medical_weight: Number(form.medical_weight),
        education_weight: Number(form.education_weight),
        recreation_weight: Number(form.recreation_weight),
        employment_weight: Number(form.employment_weight),
        max_route_calls: Number(form.max_route_calls),
      };
      setResult(await recommendHouses(payload));
    } catch {
      setError("推荐失败，请检查后端服务和配置。");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-[24px] border border-[#ead8c2] bg-[#fff8ea]/88 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff0df] text-[#d45f34]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-black text-[#33251f]">个性化 Agent 推荐</h2>
        </div>
      </div>

      <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={onSubmit}>
        <Field label="预算（万元）">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={1} step={1} value={form.budget_wan} onChange={(event) => setForm((prev) => ({ ...prev, budget_wan: Number(event.target.value) || 0 }))} required />
        </Field>

        <Field label="目标面积（㎡）">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={1} step={1} value={form.target_area} onChange={(event) => setForm((prev) => ({ ...prev, target_area: Number(event.target.value) || 0 }))} required />
        </Field>

        <Field label="通勤方式">
          <Select value={form.commute_mode} onValueChange={(value) => setForm((prev) => ({ ...prev, commute_mode: value as CommuteMode }))}>
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

        <Field label="最大通勤（分钟）">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={1} step={1} value={form.max_commute_minutes} onChange={(event) => setForm((prev) => ({ ...prev, max_commute_minutes: Number(event.target.value) || 0 }))} required />
        </Field>

        <Field label="工作地点">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="text" value={form.work_address} onChange={(event) => setForm((prev) => ({ ...prev, work_address: event.target.value }))} required />
        </Field>

        <Field label="医疗权重">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={0} max={3} step={0.1} value={form.medical_weight} onChange={(event) => setForm((prev) => ({ ...prev, medical_weight: Number(event.target.value) || 0 }))} />
        </Field>

        <Field label="教育权重">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={0} max={3} step={0.1} value={form.education_weight} onChange={(event) => setForm((prev) => ({ ...prev, education_weight: Number(event.target.value) || 0 }))} />
        </Field>

        <Field label="休闲权重">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={0} max={3} step={0.1} value={form.recreation_weight} onChange={(event) => setForm((prev) => ({ ...prev, recreation_weight: Number(event.target.value) || 0 }))} />
        </Field>

        <Field label="Top 小区数">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={1} max={10} value={form.top_communities} onChange={(event) => setForm((prev) => ({ ...prev, top_communities: Number(event.target.value) || 1 }))} required />
        </Field>

        <Field label="每小区房源数">
          <input className="h-9 w-full rounded-lg border border-[#ead8c2] bg-white px-3 text-sm text-[#33251f] outline-none focus:border-[#f3c99a]" type="number" min={1} max={10} value={form.top_houses_per_community} onChange={(event) => setForm((prev) => ({ ...prev, top_houses_per_community: Number(event.target.value) || 1 }))} required />
        </Field>

        <div className="md:col-span-2 xl:col-span-2">
          <Button type="submit" disabled={loading} className="h-9 w-full bg-[#d45f34] text-white hover:bg-[#bd4f27]">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            生成推荐
          </Button>
        </div>
      </form>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#f3c99a] bg-[#fff3df] p-3 text-sm text-[#9a5a1d]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {result?.work_location ? <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-xs text-[#775f4d]">工作地点坐标：{result.work_location}</div> : null}

        {result?.summary ? (
          <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-xs text-[#775f4d]">
            候选房源：{String(result.summary.candidate_houses ?? 0)}；
            路线调用：{String(result.summary.route_calls ?? 0)}；
            小区 LLM 重排：{String(result.summary.community_rerank_applied ?? false)}；
            电梯命中率：{Math.round(Number(result.summary.constraint_hit_rate_elevator ?? 0) * 100)}%；
            近地铁命中率：{Math.round(Number(result.summary.constraint_hit_rate_near_subway ?? 0) * 100)}%；
            偏好一致性：{Math.round(Number(result.summary.preference_consistency_score ?? 0) * 100)}；
            Top5变化：{String(result.summary.house_rerank_top5_change_count ?? 0)}
          </div>
        ) : null}

        {!loading && result?.communities.length === 0 ? (
          <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-sm text-[#775f4d]">没有得到可展示的小区，建议放宽预算/通勤条件后重试。</div>
        ) : null}

        {result?.communities.map((community, index) => {
          const key = `${community.district}|${community.sub_district}|${community.community_name}`;
          return <CommunityCard key={key} rank={index + 1} community={community} />;
        })}
      </div>
    </section>
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

function CommunityCard({
  rank,
  community,
}: {
  rank: number;
  community: CommunityRecommendation;
}) {
  const commuteLabel = community.median_commute_minutes === null ? "缺失" : `${Math.round(community.median_commute_minutes)} 分钟`;

  return (
    <Card className="border-[#f1dfc9] bg-[#fffdf8] shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-start justify-between gap-2 text-sm text-[#3c2a20]">
          <span>
            Top {rank} / {community.community_name}
          </span>
          <Badge className="bg-[#33a985] text-white">{Math.round(community.score * 100)} 分</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-[#5f4a3d]">
        <div className="rounded-md border border-[#f3e1cb] bg-white/75 p-2">
          <div className="text-[11px] text-[#806653]">
            {community.district} / {community.sub_district}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-[#6e5543]">
            <span>{community.avg_unit_price.toFixed(0)} 元/㎡</span>
            <span>{community.avg_total_price.toFixed(1)} 万元</span>
            <span>通勤 {commuteLabel}</span>
            <span>房源 {community.house_count} 套</span>
          </div>
        </div>
        <div>
          <div className="font-semibold text-[#33251f]">推荐理由</div>
          <p className="mt-1 leading-5">{community.reason}</p>
        </div>
        <div className="text-[11px] text-[#6e5543]">
          预算 {Math.round(community.budget_match_score * 100)} / POI {Math.round(community.poi_score * 100)} / 通勤 {Math.round(community.traffic_score * 100)}
        </div>
        <div className="rounded-md border border-[#ecdcc6] bg-white/80 p-2 text-[11px] text-[#6e5543]">
          <div className="font-medium text-[#33251f]">房源 ID</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {community.house_ids.length > 0
              ? community.house_ids.map((houseId) => {
                  const tags = community.house_feature_tags?.[houseId] ?? [];
                  return (
                    <div key={houseId} className="rounded-md border border-[#ead8c2] bg-[#fff9ef] px-2 py-1">
                      <div className="text-[11px] font-medium text-[#8c5b2e]">{houseId}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tags.length > 0 ? (
                          tags.map((tag) => (
                            <Badge key={`${houseId}-${tag}`} variant="outline" className="border-[#d9c5a3] px-1.5 py-0 text-[10px] text-[#6e5543]">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[10px] text-[#9b7d66]">暂无标签</span>
                        )}
                      </div>
                    </div>
                  );
                })
              : <span>暂无</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
