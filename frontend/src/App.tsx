import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronsDown, MapPinned, RefreshCw, Sparkles } from "lucide-react";
import AIAdvicePanel from "./components/AIAdvicePanel";
import ChartsPanel from "./components/ChartsPanel";
import MapPanel from "./components/MapPanel";
import StatsPanel from "./components/StatsPanel";
import StreetPanel from "./components/StreetPanel";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { formatPrice, formatScore } from "./lib/utils";
import type { DistrictMetric, Summary } from "./types/metrics";
import "./index.css";

function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/summary");
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = (await res.json()) as Summary;
      setSummary(data);
      setSelectedDistrict((prev) =>
        prev && data.districts.some((item) => item.district === prev) ? prev : null
      );
    } catch {
      setError("后端 API 不可用。请先运行数据入库脚本并启动 FastAPI。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(() => {
    if (!summary || !selectedDistrict) return null;
    return summary.districts.find((item) => item.district === selectedDistrict) ?? null;
  }, [selectedDistrict, summary]);

  if (loading) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-50 text-slate-600">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        正在加载宜居性分析数据
      </main>
    );
  }

  if (error || !summary) {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <AlertCircle className="h-5 w-5 text-red-500" />
            数据服务未就绪
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
          <pre className="mt-4 rounded-lg bg-slate-950 p-3 text-xs text-slate-100">cd backend{"\n"}python3 -m app.process_data{"\n"}uvicorn app.main:app --reload</pre>
          <Button className="mt-4" onClick={load}>
            重试
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-[#33251f]">
      <section className="relative flex min-h-screen overflow-hidden px-4 py-12 md:px-8 md:py-16">
        <div className="absolute right-[-8rem] top-[-9rem] h-80 w-80 rounded-full bg-[#ffb37d]/35 blur-3xl" />
        <div className="absolute left-[-9rem] top-[12rem] h-80 w-80 rounded-full bg-[#6bd0b5]/18 blur-3xl" />

        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col justify-between text-center">
          <div className="pt-4">
            <h1 className="mx-auto max-w-5xl bg-[linear-gradient(105deg,#ff6b4a_0%,#ffb23f_34%,#20b486_66%,#2f80ed_100%)] bg-clip-text text-7xl font-black leading-none tracking-[-0.08em] text-transparent drop-shadow-[0_18px_36px_rgba(255,122,79,0.18)] md:text-9xl">
              LiveSH
            </h1>
            <div className="mx-auto mt-3 h-2 w-40 rounded-full bg-[linear-gradient(90deg,#ff6b4a,#ffc85c,#28c19a,#5b8cff)] opacity-80" />
            <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/38 px-4 py-2 text-base font-medium text-[#9a5a1d] backdrop-blur-sm">
                <Sparkles className="h-4 w-4" />
                让地图先回答：哪里住得更划算，也更方便
            </div>
            <p className="mx-auto mt-7 max-w-3xl text-lg leading-8 text-[#6e5543]">
              把二手房挂牌价格与购物、交通、医疗、休闲、企业等 POI 数据放到同一张城市空间底图上，
              用区级尺度衡量“生活便利”与“居住成本”的相对关系
            </p>
          </div>

          <div className="mx-auto max-w-3xl py-10">
              <div className="mb-4 flex items-center justify-center gap-2 text-lg font-semibold text-[#33251f]">
                <MapPinned className="h-5 w-5 text-[#ff7a4f]" />
                打分逻辑
              </div>
              <div className="space-y-3 text-base leading-7 text-[#6e5543]">
                <p>商圈活跃度由购物、交通、医疗、休闲与企业 POI 加权得到</p>
                <p>综合评分 = 标准化商圈活跃度 - 标准化房价</p>
                <p>分数越高，代表生活便利性相对更强，同时居住成本压力相对更低</p>
              </div>
              <div className="mx-auto mt-8 flex max-w-2xl flex-wrap justify-center gap-4 text-2xl font-black md:text-4xl">
                <div className="rounded-[1.35rem] bg-[#fff4df]/82 px-8 py-4 text-[#c06a1a] shadow-[0_14px_34px_rgba(192,106,26,0.12)]">成本</div>
                <div className="rounded-[1.35rem] bg-[#e8f7ef]/82 px-8 py-4 text-[#23916f] shadow-[0_14px_34px_rgba(35,145,111,0.12)]">便利</div>
                <div className="rounded-[1.35rem] bg-[#fff0ea]/82 px-8 py-4 text-[#d85435] shadow-[0_14px_34px_rgba(216,84,53,0.12)]">评分</div>
              </div>
          </div>

          <button
            type="button"
            onClick={() => document.getElementById("map-gis")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="mx-auto -mt-6 flex h-20 w-28 items-center justify-center text-[#b25332] transition hover:translate-y-1 hover:text-[#ff7a4f]"
            aria-label="进入地图 GIS"
          >
            <ChevronsDown className="h-16 w-16 stroke-[2.8]" />
          </button>
        </div>
      </section>

      <div className="mx-auto max-w-[1440px] px-4 pb-6 pt-4 md:px-8 xl:px-10">
      <section id="map-gis" className="mx-auto grid h-[calc(100vh-4rem)] min-h-[560px] max-w-[1360px] scroll-mt-5 grid-cols-1 gap-3 rounded-[22px] border border-[#ead8c2] bg-white/70 p-3 shadow-[0_24px_80px_rgba(104,72,42,0.12)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <RecommendationSection
          recommendations={summary.score_ranking.slice(0, 5)}
          onSelectDistrict={setSelectedDistrict}
          compact
        />
        <div className="min-h-0">
          <MapPanel
            districts={summary.districts}
            selectedDistrict={selectedDistrict}
            recommendations={summary.score_ranking.slice(0, 5)}
            onSelectDistrict={setSelectedDistrict}
          />
        </div>
      </section>

      <div className="mt-5 space-y-5">
        <StatsPanel
          selected={selected}
          districts={summary.score_ranking}
          onSelectDistrict={setSelectedDistrict}
        />

        <StreetPanel
          districts={summary.score_ranking}
          selectedDistrict={selectedDistrict}
          onSelectDistrict={setSelectedDistrict}
        />

        <ChartsPanel
          priceTop10={summary.price_top10}
          poiCategories={summary.poi_categories}
          shoppingTop5={summary.shopping_top5}
          scatter={summary.scatter}
          scoreRanking={summary.score_ranking}
          selectedDistrict={selectedDistrict}
          onSelectDistrict={setSelectedDistrict}
        />

        <AIAdvicePanel selected={selected} />
      </div>
      </div>
    </main>
  );
}

function RecommendationSection({
  recommendations,
  onSelectDistrict,
  compact = false
}: {
  recommendations: DistrictMetric[];
  onSelectDistrict: (district: string) => void;
  compact?: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-[18px] border border-[#ead8c2] bg-[#fffaf1]/92 p-4 shadow-[0_18px_56px_rgba(104,72,42,0.10)]">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#33251f]">推荐区域 Top5</h2>
        <Badge variant="outline" className="border-[#f3c99a] bg-[#fff4df] text-[#9a5a1d]">综合评分排序</Badge>
      </div>
      <div className={`mt-4 min-h-0 gap-3 ${compact ? "flex flex-1 flex-col overflow-y-auto pr-1" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5"}`}>
        {recommendations.map((item, index) => (
          <Card
            key={item.district}
            className="cursor-pointer border-[#f1dfc9] bg-[#fffdf8] shadow-none transition hover:border-[#f3c99a] hover:bg-[#fff9ef]"
            onClick={() => onSelectDistrict(item.district)}
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>
                  {index + 1}. {item.district}
                </span>
                <Badge className="shrink-0 bg-[#33a985] text-white">评分 {formatScore(item.livability_score)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm text-[#775f4d]">
                <span>平均房价</span>
                <span className="font-medium text-[#33251f]">{formatPrice(item.avg_price)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default App;
