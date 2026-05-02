import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { AIAdvice, DistrictMetric } from "../types/metrics";

type AIAdvicePanelProps = {
  selected: DistrictMetric | null;
};

export default function AIAdvicePanel({ selected }: AIAdvicePanelProps) {
  const [advice, setAdvice] = useState<AIAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAdvice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district: selected?.district ?? null })
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setAdvice((await res.json()) as AIAdvice);
    } catch {
      setError("AI 建议接口暂不可用，请确认后端服务已启动。");
    } finally {
      setLoading(false);
    }
  }, [selected?.district]);

  useEffect(() => {
    void loadAdvice();
  }, [loadAdvice]);

  return (
    <section className="rounded-[24px] border border-[#ead8c2] bg-[#fff8ea]/88 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff0df] text-[#d45f34]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-[#33251f]">AI 居住建议</h2>
            <p className="mt-1 text-sm text-[#806653]">
              {selected ? `${selected.district} 的指标解读` : "默认展示当前推荐区域的指标解读"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {advice?.is_placeholder ? (
            <Badge variant="outline" className="border-[#f3c99a] bg-[#fff4df] text-[#9a5a1d]">待接入大模型</Badge>
          ) : (
            <Badge className="bg-[#33a985] text-white">AI 已生成</Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadAdvice}
            disabled={loading}
            className="border-[#ead8c2] bg-white/70 text-[#6e5543] hover:bg-[#fff4df]"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新建议
          </Button>
        </div>
      </div>

      <Card className="mt-4 border-[#f1dfc9] bg-[#fffdf8]/92 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-black text-[#3c2a20]">
            {advice ? `${advice.district} 分析建议` : "分析建议"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm leading-7 text-[#b45309]">{error}</p>
          ) : loading && !advice ? (
            <p className="text-sm leading-7 text-[#806653]">正在生成建议...</p>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-7 text-[#5f4a3d]">
              {advice?.advice ?? "暂无建议。"}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
