import { Building2, ChevronDown, ChevronRight, Info, List, Loader2, MapPinned, Network, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { displayScore, formatPrice, formatScore } from "../lib/utils";
import type { CommunityMetric, DistrictMetric, RouteStreetMetric, StreetMetric } from "../types/metrics";

type StreetPanelProps = {
  districts: DistrictMetric[];
  selectedDistrict: string | null;
  onSelectDistrict: (district: string | null) => void;
};

const ALL_VALUE = "全部区域";
const STREET_RECOMMENDATION_MIN_HOUSE_COUNT = 50;
const ROUTE_PANEL_TEAR_EFFECT_ENABLED = true;
const ROUTE_PANEL_TEAR_EFFECT_MS = 980;
const ROUTE_LIFE_CIRCLE_ENDPOINTS = [
  "/api/streets/route-life-circle/yangpu",
  "/api/streets/route-life-circle/huangpu",
  "/api/streets/route-life-circle/jiading",
];

const SCORE_HELP: Record<string, string> = {
  calibrated_score_life_circle: "综合生活圈、设施供需充足度、价格和样本可信度后的最终推荐分，越高表示整体越值得优先关注。",
  calibrated_score_life_circle_route: "把生活圈部分替换为真实步行路网结果后的校准评分，越高表示路网口径下整体更值得优先关注。",
  life_circle_score_route: "使用真实步行路线时间重算后的生活圈总分，更能反映道路绕行、过街和阻隔带来的影响。",
  e2sfca_access_score: "衡量周边服务设施是否既离得近，又不会被过多居住需求挤占。",
  affordability_score: "衡量这个街镇的房价相对压力，分数越高表示价格越友好。",
  access_score: "衡量房源到购物、交通、医疗、休闲等服务的距离便利程度。",
  value_score: "把服务可达性和价格友好度放在一起看，分数越高表示综合价值越好。",
};

function formatOptionalScore(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatScore(numeric) : "暂无";
}

function communityKey(item: CommunityMetric) {
  return `${item.district}|${item.street ?? ""}|${item.community_name}`;
}

function matchesKeyword(value: string | null | undefined, keyword: string) {
  return !keyword || String(value ?? "").includes(keyword);
}

function streetKey(district: string, street: string) {
  return `${district}|${street}`;
}

function supportsRouteDistrict(value: string | null) {
  return (
    value === "杨浦" ||
    value === "杨浦区" ||
    value === "黄浦" ||
    value === "黄浦区" ||
    value === "嘉定" ||
    value === "嘉定区"
  );
}

export default function StreetPanel({ districts, selectedDistrict, onSelectDistrict }: StreetPanelProps) {
  const [streets, setStreets] = useState<StreetMetric[]>([]);
  const [routeMetrics, setRouteMetrics] = useState<RouteStreetMetric[]>([]);
  const [communities, setCommunities] = useState<CommunityMetric[]>([]);
  const [selectedStreetId, setSelectedStreetId] = useState<number | null>(null);
  const [selectedCommunityKey, setSelectedCommunityKey] = useState<string | null>(null);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [routeTransitioning, setRouteTransitioning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [communityQuery, setCommunityQuery] = useState("");
  const [expandedScore, setExpandedScore] = useState<string | null>(null);
  const [expandedRouteScore, setExpandedRouteScore] = useState<string | null>(null);
  const routeTransitionTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setCommunityLoading(true);
    setError(null);
    try {
      const [streetRes, communityRes] = await Promise.all([fetch("/api/streets"), fetch("/api/communities")]);
      if (!streetRes.ok) throw new Error(`streets API ${streetRes.status}`);
      if (!communityRes.ok) throw new Error(`communities API ${communityRes.status}`);
      const streetData = (await streetRes.json()) as StreetMetric[];
      const communityData = (await communityRes.json()) as CommunityMetric[];
      setStreets(streetData);
      setCommunities(communityData);
      const routeResponses = await Promise.allSettled(ROUTE_LIFE_CIRCLE_ENDPOINTS.map((endpoint) => fetch(endpoint)));
      const routeData = await Promise.all(
        routeResponses.map(async (item) => {
          if (item.status !== "fulfilled" || !item.value.ok) return [];
          return (await item.value.json()) as RouteStreetMetric[];
        }),
      );
      setRouteMetrics(routeData.flat());
    } catch {
      setError("街道/镇或小区数据暂不可用，请先重新运行后端入库脚本并启动 API。");
    } finally {
      setLoading(false);
      setCommunityLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const communitiesByStreet = useMemo(() => {
    const groups = new Map<string, CommunityMetric[]>();
    for (const item of communities) {
      const key = `${item.district}|${item.street ?? ""}`;
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }
    return groups;
  }, [communities]);

  const routeMetricByStreet = useMemo(() => {
    const map = new Map<string, RouteStreetMetric>();
    for (const item of routeMetrics) {
      map.set(streetKey(item.district, item.street), item);
    }
    return map;
  }, [routeMetrics]);

  const rankedStreets = useMemo(
    () =>
      [...streets]
        .filter((item) => Number(item.house_count) >= STREET_RECOMMENDATION_MIN_HOUSE_COUNT)
        .sort((a, b) => (Number(b.calibrated_score_life_circle) || 0) - (Number(a.calibrated_score_life_circle) || 0)),
    [streets],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim();
    const communityStreetKeys = new Set<string>();

    if (keyword) {
      for (const community of communities) {
        if (matchesKeyword(community.community_name, keyword)) {
          communityStreetKeys.add(`${community.district}|${community.street ?? ""}`);
        }
      }
    }

    return rankedStreets.filter((item) => {
      const districtMatched = !selectedDistrict || item.district === selectedDistrict;
      const streetKey = `${item.district}|${item.street}`;
      const keywordMatched =
        !keyword ||
        item.street.includes(keyword) ||
        item.district.includes(keyword) ||
        communityStreetKeys.has(streetKey);
      return districtMatched && keywordMatched;
    });
  }, [communities, query, rankedStreets, selectedDistrict]);

  const selectedStreet = useMemo(() => {
    if (selectedStreetId) {
      const current = rankedStreets.find((item) => item.id === selectedStreetId);
      if (current && (!selectedDistrict || current.district === selectedDistrict)) return current;
    }
    return filtered[0] ?? null;
  }, [filtered, rankedStreets, selectedDistrict, selectedStreetId]);

  const visibleCommunities = useMemo(() => {
    if (!selectedStreet) return [];
    const keyword = communityQuery.trim();
    const base = communitiesByStreet.get(streetKey(selectedStreet.district, selectedStreet.street)) ?? [];
    return base.filter((item) => matchesKeyword(item.community_name, keyword));
  }, [communitiesByStreet, communityQuery, selectedStreet]);

  const selectedRouteMetric = useMemo(() => {
    if (!selectedStreet) return null;
    return routeMetricByStreet.get(streetKey(selectedStreet.district, selectedStreet.street)) ?? null;
  }, [routeMetricByStreet, selectedStreet]);

  const showRouteToggle = supportsRouteDistrict(selectedDistrict) && Boolean(selectedRouteMetric);

  useEffect(() => {
    if (!showRouteToggle) {
      if (routeTransitionTimerRef.current) {
        window.clearTimeout(routeTransitionTimerRef.current);
        routeTransitionTimerRef.current = null;
      }
      setShowRoutePanel(false);
      setRouteTransitioning(false);
      setExpandedRouteScore(null);
    }
  }, [showRouteToggle]);

  useEffect(() => {
    return () => {
      if (routeTransitionTimerRef.current) {
        window.clearTimeout(routeTransitionTimerRef.current);
      }
    };
  }, []);

  const openRoutePanel = useCallback(() => {
    if (!ROUTE_PANEL_TEAR_EFFECT_ENABLED) {
      setShowRoutePanel(true);
      return;
    }
    if (routeTransitionTimerRef.current) {
      window.clearTimeout(routeTransitionTimerRef.current);
    }
    setRouteTransitioning(true);
    routeTransitionTimerRef.current = window.setTimeout(() => {
      setShowRoutePanel(true);
      setRouteTransitioning(false);
      routeTransitionTimerRef.current = null;
    }, ROUTE_PANEL_TEAR_EFFECT_MS);
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword || !communities.length || !rankedStreets.length) return;

    const communityMatches = communities.filter((item) => matchesKeyword(item.community_name, keyword));
    if (!communityMatches.length) return;

    const street = rankedStreets.find((item) =>
      communityMatches.some((community) => community.district === item.district && community.street === item.street),
    );
    if (!street) return;

    const communityMatch =
      communityMatches.find((item) => item.district === street.district && item.street === street.street) ?? communityMatches[0];

    setSelectedStreetId(street.id);
    setSelectedCommunityKey(communityKey(communityMatch));
    setCommunityQuery(keyword);
    onSelectDistrict(street.district);
  }, [communities, onSelectDistrict, query, rankedStreets]);

  useEffect(() => {
    if (!selectedStreet) return;
    const currentStillVisible = visibleCommunities.some((item) => communityKey(item) === selectedCommunityKey);
    if (!currentStillVisible && !query.trim()) {
      setSelectedCommunityKey(null);
    }
  }, [query, selectedCommunityKey, selectedStreet, visibleCommunities]);

  return (
    <section className="rounded-[24px] border border-[#ead8c2] bg-[#fff8ea]/88 p-5 shadow-[0_18px_56px_rgba(104,72,42,0.10)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f7ef] text-[#1d8f70]">
            <MapPinned className="h-5 w-5" />
          </div>
          <h2 className="text-2xl font-black text-[#33251f]">街道/镇精细分析</h2>
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
            setSelectedCommunityKey(null);
            setCommunityQuery("");
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
              setSelectedCommunityKey(null);
              setCommunityQuery("");
              setQuery(event.target.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-[#33251f] outline-none placeholder:text-[#a58b76]"
            placeholder="搜索街道/镇、行政区或小区"
          />
        </label>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setQuery("");
            setCommunityQuery("");
            setSelectedStreetId(null);
            setSelectedCommunityKey(null);
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
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedStreetId(item.id);
                  setSelectedCommunityKey(null);
                  setCommunityQuery("");
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
                  <span className="block truncate whitespace-nowrap text-sm font-black text-[#33251f]">
                    {item.district} · {item.street}
                  </span>
                  <span className="mt-1 block truncate text-xs text-[#806653]">
                    {formatPrice(item.avg_price)} / POI {item.poi_total.toLocaleString("zh-CN")}
                    {(item.sample_reliability_score ?? 1) < 1 ? " / 样本不足" : ""}
                  </span>
                </span>
                <Badge className="shrink-0 bg-[#33a985] px-2 text-white">
                  {formatOptionalScore(displayScore(item, "calibrated_score_life_circle"))}
                </Badge>
              </button>
            ))}
          </div>

          <div className="min-h-0 min-w-0">
            <Card className="flex h-[520px] min-h-0 flex-col border-[#f1dfc9] bg-[#fffdf8]/92 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-[#33251f]">
                  {selectedStreet.district}
                  <ChevronRight className="h-4 w-4 text-[#a58b76]" />
                  {selectedStreet.street}
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[#33a985] text-white">
                    校准评分 {formatOptionalScore(displayScore(selectedStreet, "calibrated_score_life_circle"))}
                  </Badge>
                  <Badge variant="outline" className="border-[#d8ccff] bg-[#f4f0ff] text-[#6d4fc2]">
                    生活圈总分 {formatOptionalScore(displayScore(selectedStreet, "life_circle_score"))}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-2">
                  <StreetScoreSummary
                    selectedStreet={selectedStreet}
                    expandedScore={expandedScore}
                    onToggleScore={(key) => setExpandedScore((prev) => (prev === key ? null : key))}
                  />
                  <div className="relative h-full min-h-0">
                    {showRoutePanel && selectedRouteMetric ? (
                      <RouteScorePanel
                        selectedStreet={selectedStreet}
                        routeMetric={selectedRouteMetric}
                        expandedScore={expandedRouteScore}
                        onToggleScore={(key) => setExpandedRouteScore((prev) => (prev === key ? null : key))}
                        onBack={() => setShowRoutePanel(false)}
                      />
                    ) : (
                      <CommunityList
                        communities={visibleCommunities}
                        allCommunities={communitiesByStreet.get(streetKey(selectedStreet.district, selectedStreet.street)) ?? []}
                        loading={communityLoading}
                        query={communityQuery}
                        selectedKey={selectedCommunityKey}
                        onQueryChange={setCommunityQuery}
                        onSelect={(item) => setSelectedCommunityKey(communityKey(item))}
                        showRouteToggle={showRouteToggle}
                        onToggleRoutePanel={openRoutePanel}
                      />
                    )}
                    {routeTransitioning ? <TearAwayTransition /> : null}
                  </div>
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

function StreetScoreSummary({
  selectedStreet,
  expandedScore,
  onToggleScore,
}: {
  selectedStreet: StreetMetric;
  expandedScore: string | null;
  onToggleScore: (key: string) => void;
}) {
  const scores = [
    { key: "calibrated_score_life_circle", label: "校准评分", value: displayScore(selectedStreet, "calibrated_score_life_circle") },
    { key: "life_circle_score", label: "生活圈总分", value: displayScore(selectedStreet, "life_circle_score") },
    { key: "e2sfca_access_score", label: "设施供需充足度", value: displayScore(selectedStreet, "e2sfca_access_score") },
    { key: "affordability_score", label: "房价负担分", value: displayScore(selectedStreet, "affordability_score") },
    { key: "access_score", label: "可达性分", value: displayScore(selectedStreet, "access_score") },
    { key: "value_score", label: "性价比分", value: displayScore(selectedStreet, "value_score") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#f4e3cf] bg-[#fff8ed]/60 p-3">
      <div className="relative mb-3 h-8 shrink-0">
        <div className="text-sm font-black text-[#33251f]">核心评分</div>
        <div className="absolute right-0 top-0 text-xs text-[#8a6f5a]">点击查看说明</div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:h-[270px] sm:grid-cols-2 sm:grid-rows-3">
        {scores.map((score) => (
          <ScoreCard
            key={score.key}
            label={score.label}
            value={formatOptionalScore(score.value)}
            active={expandedScore === score.key}
            onClick={() => onToggleScore(score.key)}
          />
        ))}
      </div>
      <div className="mt-3 h-[124px] shrink-0 overflow-hidden rounded-xl border border-[#f4e3cf] bg-white/62 p-3 text-sm leading-6 text-[#6e5543]">
        {expandedScore === "life_circle_score" ? (
          <div>
            <div className="mb-2 flex items-center gap-2 font-semibold text-[#33251f]">
              <Info className="h-4 w-4 text-[#33a985]" />
              生活圈分解
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <MiniScore label="5分钟基础生活" value={formatOptionalScore(displayScore(selectedStreet, "life_circle_5min_score"))} />
              <MiniScore label="10分钟日常生活" value={formatOptionalScore(displayScore(selectedStreet, "life_circle_10min_score"))} />
              <MiniScore label="15分钟城市资源" value={formatOptionalScore(displayScore(selectedStreet, "life_circle_15min_score"))} />
            </div>
          </div>
        ) : expandedScore ? (
          <div className="flex gap-2">
            <Info className="mt-1 h-4 w-4 shrink-0 text-[#33a985]" />
            <span>{SCORE_HELP[expandedScore]}</span>
          </div>
        ) : (
          <div className="flex gap-2 text-[#8a6f5a]">
            <Info className="mt-1 h-4 w-4 shrink-0" />
            <span>选择一个评分查看它代表的含义；生活圈总分可展开 5、10、15 分钟三个层级。</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteScorePanel({
  selectedStreet,
  routeMetric,
  expandedScore,
  onToggleScore,
  onBack,
}: {
  selectedStreet: StreetMetric;
  routeMetric: RouteStreetMetric;
  expandedScore: string | null;
  onToggleScore: (key: string) => void;
  onBack: () => void;
}) {
  const scores = [
    {
      key: "calibrated_score_life_circle_route",
      label: "校准评分2.0",
      value: routeMetric.calibrated_score_life_circle_route_display,
    },
    { key: "life_circle_score_route", label: "生活圈总分2.0", value: routeMetric.life_circle_score_route_display },
    { key: "e2sfca_access_score", label: "设施供需充足度", value: displayScore(selectedStreet, "e2sfca_access_score") },
    { key: "affordability_score", label: "房价负担分", value: displayScore(selectedStreet, "affordability_score") },
    { key: "access_score", label: "可达性分", value: displayScore(selectedStreet, "access_score") },
    { key: "value_score", label: "性价比分", value: displayScore(selectedStreet, "value_score") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#f4e3cf] bg-[#fff8ed]/60 p-3">
      <div className="relative mb-3 h-8 shrink-0">
        <div className="text-sm font-black text-[#33251f]">核心评分2.0</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          className="absolute right-0 top-0 h-6 rounded-md border-[#ead8c2] bg-white/78 px-1.5 text-[11px] leading-none text-[#6e5543] hover:bg-[#fff4df]"
        >
          <List className="mr-1 h-3 w-3" />
          小区
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:h-[270px] sm:grid-cols-2 sm:grid-rows-3">
        {scores.map((score) => (
          <ScoreCard
            key={score.key}
            label={score.label}
            value={formatOptionalScore(score.value)}
            active={expandedScore === score.key}
            onClick={() => onToggleScore(score.key)}
          />
        ))}
      </div>
      <div className="mt-3 h-[124px] shrink-0 overflow-hidden rounded-xl border border-[#f4e3cf] bg-white/62 p-3 text-sm leading-6 text-[#6e5543]">
        {expandedScore === "life_circle_score_route" ? (
          <div>
            <div className="mb-2 flex items-center gap-2 font-semibold text-[#33251f]">
              <Info className="h-4 w-4 text-[#33a985]" />
              生活圈2.0分解
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <MiniScore label="5分钟基础生活" value={formatOptionalScore(routeMetric.life_circle_5min_score_route_display)} />
              <MiniScore label="10分钟日常生活" value={formatOptionalScore(routeMetric.life_circle_10min_score_route_display)} />
              <MiniScore label="15分钟城市资源" value={formatOptionalScore(routeMetric.life_circle_15min_score_route_display)} />
            </div>
          </div>
        ) : expandedScore ? (
          <div className="flex gap-2">
            <Info className="mt-1 h-4 w-4 shrink-0 text-[#33a985]" />
            <span>{SCORE_HELP[expandedScore]}</span>
          </div>
        ) : (
          <div className="flex gap-2 text-[#8a6f5a]">
            <Info className="mt-1 h-4 w-4 shrink-0" />
            <span>真实步行网络已替换生活圈与校准评分；其余四项沿用当前街镇评分。</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TearAwayTransition() {
  return (
    <div className="route-tear-overlay" aria-hidden="true">
      <div className="route-tear-shimmer" />
      <div className="route-tear-card route-tear-card-left">
        <div className="route-tear-card-title" />
        <div className="route-tear-card-line route-tear-card-line-wide" />
        <div className="route-tear-card-line" />
        <div className="route-tear-card-badge" />
      </div>
      <div className="route-tear-card route-tear-card-right">
        <div className="route-tear-card-title" />
        <div className="route-tear-card-line route-tear-card-line-wide" />
        <div className="route-tear-card-line" />
        <div className="route-tear-card-badge" />
      </div>
      <div className="route-tear-hand route-tear-hand-left">
        <span className="route-tear-thumb" />
        <span className="route-tear-fingers" />
      </div>
      <div className="route-tear-hand route-tear-hand-right">
        <span className="route-tear-thumb" />
        <span className="route-tear-fingers" />
      </div>
      <div className="route-tear-new-card">
        <Network className="h-5 w-5" />
        <span>核心评分2.0</span>
      </div>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-[82px] min-h-0 flex-col justify-between rounded-xl border p-3 text-left transition sm:h-full ${
        active ? "border-[#7ed5b8] bg-[#eefbf4]" : "border-[#f4e3cf] bg-[#fff8ed]/72 hover:border-[#f3c99a] hover:bg-white/82"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-[#8a6f5a]">
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${active ? "rotate-180" : ""}`} />
      </div>
      <div className="mt-2 text-base font-semibold text-[#33251f]">{value}</div>
    </button>
  );
}

function MiniScore({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#f4e3cf] bg-[#fff8ed]/80 px-3 py-2">
      <div className="text-[#8a6f5a]">{label}</div>
      <div className="mt-1 font-semibold text-[#33251f]">{value}</div>
    </div>
  );
}

function CommunityList({
  communities,
  allCommunities,
  loading,
  query,
  selectedKey,
  onQueryChange,
  onSelect,
  showRouteToggle,
  onToggleRoutePanel,
}: {
  communities: CommunityMetric[];
  allCommunities: CommunityMetric[];
  loading: boolean;
  query: string;
  selectedKey: string | null;
  onQueryChange: (value: string) => void;
  onSelect: (item: CommunityMetric) => void;
  showRouteToggle: boolean;
  onToggleRoutePanel: () => void;
}) {
  const houseTotal = allCommunities.reduce((sum, item) => sum + Number(item.house_count || 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#f4e3cf] bg-[#fff8ed]/60 p-3">
      <div className="relative mb-3 h-8 shrink-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 pr-14">
            <span className="shrink-0 text-sm font-black text-[#33251f]">小区列表</span>
            <span className="truncate text-xs text-[#8a6f5a]">
              {allCommunities.length.toLocaleString("zh-CN")} 个 / {houseTotal.toLocaleString("zh-CN")} 套
            </span>
          </div>
        </div>
        {showRouteToggle ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleRoutePanel}
            className="absolute right-0 top-0 h-6 rounded-md border-[#d8ccff] bg-[#f4f0ff] px-1.5 text-[11px] leading-none text-[#6d4fc2] hover:bg-[#eee7ff]"
          >
            <Network className="mr-1 h-3 w-3" />
            2.0
          </Button>
        ) : null}
      </div>
      <label className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-[#ead8c2] bg-white/78 px-3 text-sm text-[#806653]">
        <Search className="h-4 w-4 shrink-0" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[#33251f] outline-none placeholder:text-[#a58b76]"
          placeholder="搜索本街道/镇内小区"
        />
      </label>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-36 items-center justify-center text-sm text-[#806653]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载小区
          </div>
        ) : communities.length ? (
          communities.map((item) => {
            const key = communityKey(item);
            const active = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(item)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                  active ? "border-[#7ed5b8] bg-[#eefbf4]" : "border-[#f4e3cf] bg-white/66 hover:border-[#f3c99a] hover:bg-white/86"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-normal text-[#33251f]">{item.community_name}</span>
                  <span className="mt-1 block text-xs text-[#806653]">
                    房源 {Number(item.house_count).toLocaleString("zh-CN")} 套 / {formatPrice(item.avg_price)}
                  </span>
                </span>
                <Badge variant="outline" className="shrink-0 border-[#bfe6d6] bg-[#eefbf4] text-[#21745d]">
                  {Number(item.house_count).toLocaleString("zh-CN")}
                </Badge>
              </button>
            );
          })
        ) : (
          <div className="rounded-xl border border-[#f4e3cf] bg-white/62 p-4 text-sm text-[#806653]">
            当前筛选下没有匹配的小区。
          </div>
        )}
      </div>
    </div>
  );
}
