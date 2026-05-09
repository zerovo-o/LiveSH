import { AlertCircle, Loader2, Navigation, Sparkles } from "lucide-react";
import { useState } from "react";
import { recommendDistricts } from "../lib/agentApi";
import { formatPrice } from "../lib/utils";
import type {
  AgentRecommendRequest,
  AgentRecommendResponse,
  CommuteMode,
  DistrictRecommendation
} from "../types/agent";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const DEFAULT_FORM: AgentRecommendRequest = {
  budget_wan: 500,
  target_area: 80,
  work_address: "上海市浦东新区张江高科",
  commute_mode: "transit",
  max_commute_minutes: 45,
  top_k: 5
};

const commuteModeOptions: Array<{ label: string; value: CommuteMode }> = [
  { label: "公共交通", value: "transit" },
  { label: "驾车", value: "driving" }
];

export default function PersonalizedAgentPanel() {
  const [form, setForm] = useState<AgentRecommendRequest>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentRecommendResponse | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: AgentRecommendRequest = {
        ...form,
        budget_wan: Number(form.budget_wan),
        target_area: Number(form.target_area),
        max_commute_minutes: Number(form.max_commute_minutes),
        top_k: Number(form.top_k)
      };
      const response = await recommendDistricts(payload);
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
          <h2 className="text-base font-black text-[#33251f]">个性化区域推荐 Agent</h2>
          <p className="text-xs text-[#806653]">基于预算、通勤与区级指标生成推荐</p>
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

        <Button
          type="submit"
          disabled={loading}
          className="h-9 w-full bg-[#d45f34] text-white hover:bg-[#bd4f27]"
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          生成推荐
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

        {!loading && result && result.recommendations.length === 0 ? (
          <div className="rounded-lg border border-[#f3e1cb] bg-white/80 p-3 text-sm text-[#775f4d]">
            暂无可推荐区域，请检查数据是否已初始化。
          </div>
        ) : null}

        {result?.recommendations.map((item) => (
          <RecommendationCard key={item.district} item={item} />
        ))}
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

function RecommendationCard({ item }: { item: DistrictRecommendation }) {
  const scoreLabel = `${Math.round(item.score * 100)} 分`;
  const commuteLabel = item.commute_minutes === null ? "暂无" : `${Math.round(item.commute_minutes)} 分钟`;
  const avgPriceLabel = item.avg_price === null ? "暂无" : formatPrice(item.avg_price);
  const avgTotalPriceLabel =
    item.avg_total_price === null ? "暂无" : `${item.avg_total_price.toFixed(1)} 万`;
  const houseCountLabel = item.house_count === null ? "暂无" : item.house_count.toLocaleString("zh-CN");

  return (
    <Card className="border-[#f1dfc9] bg-[#fffdf8] shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm text-[#3c2a20]">
          <span>{item.district}</span>
          <Badge className="bg-[#33a985] text-white">{scoreLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-[#5f4a3d]">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="预计通勤" value={commuteLabel} icon={<Navigation className="h-3.5 w-3.5" />} />
          <Metric label="平均单价" value={avgPriceLabel} />
          <Metric label="平均总价" value={avgTotalPriceLabel} />
          <Metric label="房源数量" value={houseCountLabel} />
        </div>

        <div>
          <div className="font-semibold text-[#33251f]">推荐理由</div>
          <p className="mt-1 leading-5">{item.reason}</p>
        </div>

        <div>
          <div className="font-semibold text-[#33251f]">风险提示</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {item.risks.map((risk, index) => (
              <li key={`${item.district}-risk-${index}`}>{risk}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
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

