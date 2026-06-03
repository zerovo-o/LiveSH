import { Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { displayScore, formatScore, normalizeDistrictName } from "../lib/utils";
import type { DistrictMetric, StreetMetric } from "../types/metrics";

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

type MapPanelProps = {
  districts: DistrictMetric[];
  selectedDistrict: string | null;
  recommendations: DistrictMetric[];
  onSelectDistrict: (district: string) => void;
};

type MapMode = "calibrated" | "lifeCircle" | "e2sfca" | "robust" | "access" | "value" | "price" | "poi" | "activity";
type DistrictBoundary = {
  name: string;
  adcode?: string;
  center?: [number, number] | null;
  boundaries: Array<Array<[number, number]>>;
};
type StreetBoundary = {
  name: string;
  district: string;
  center?: [number, number] | null;
  boundaries: Array<Array<[number, number]>>;
};
type StreetPolygonEntry = {
  polygon: any;
  district: string;
  street: string;
};
type DistrictBubblePosition = {
  district: string;
  x: number;
  y: number;
  metric: DistrictMetric;
};

const SHANGHAI_CENTER: [number, number] = [121.4737, 31.2304];
const DEFAULT_SHOW_STREET_BOUNDARIES = true;

const mapModes: Record<
  MapMode,
  {
    label: string;
    unit: string;
    low: string;
    high: string;
    value: (item: DistrictMetric) => number;
    format: (value: number) => string;
  }
> = {
  calibrated: {
    label: "校准评分",
    unit: "",
    low: "#dcfce7",
    high: "#15803d",
    value: (item) => displayScore(item, "calibrated_score_life_circle"),
    format: formatScore
  },
  lifeCircle: {
    label: "生活圈",
    unit: "",
    low: "#ede9fe",
    high: "#7c3aed",
    value: (item) => displayScore(item, "life_circle_score"),
    format: formatScore
  },
  e2sfca: {
    label: "设施供需充足度",
    unit: "",
    low: "#e0f2fe",
    high: "#0284c7",
    value: (item) => displayScore(item, "e2sfca_access_score"),
    format: formatScore
  },
  robust: {
    label: "稳健评分",
    unit: "",
    low: "#fee2e2",
    high: "#ef4444",
    value: (item) => displayScore(item, "livability_score_v2"),
    format: formatScore
  },
  access: {
    label: "可达性",
    unit: "",
    low: "#dbeafe",
    high: "#2563eb",
    value: (item) => displayScore(item, "access_score"),
    format: formatScore
  },
  value: {
    label: "性价比",
    unit: "",
    low: "#dcfce7",
    high: "#16a34a",
    value: (item) => displayScore(item, "value_score"),
    format: formatScore
  },
  price: {
    label: "房价",
    unit: "元/㎡",
    low: "#fee2e2",
    high: "#dc2626",
    value: (item) => item.avg_price,
    format: (value) => `${Math.round(value / 1000)}k`
  },
  poi: {
    label: "POI总量",
    unit: "个",
    low: "#fee2e2",
    high: "#f97316",
    value: (item) => item.poi_total,
    format: (value) => `${Math.round(value / 1000)}k`
  },
  activity: {
    label: "商圈活跃度",
    unit: "",
    low: "#fef3c7",
    high: "#ef4444",
    value: (item) => item.business_activity,
    format: (value) => Math.round(value).toLocaleString("zh-CN")
  }
};

const visibleMapModes: MapMode[] = ["calibrated", "lifeCircle", "price", "poi", "activity"];

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function mixColor(low: string, high: string, ratio: number) {
  const a = hexToRgb(low);
  const b = hexToRgb(high);
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const blue = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${blue})`;
}

function streetKey(district: string, street: string) {
  return `${normalizeDistrictName(district)}::${street}`;
}

function loadAmap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  const key = import.meta.env.VITE_AMAP_KEY as string | undefined;
  const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE as string | undefined;
  if (securityCode) {
    window._AMapSecurityConfig = { securityJsCode: securityCode };
  }
  return new Promise<any>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key ?? ""}&plugin=AMap.DistrictSearch`;
    script.async = true;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error("AMap script failed"));
    document.head.appendChild(script);
  });
}

async function fetchBackendBoundaries(): Promise<DistrictBoundary[]> {
  const res = await fetch("/api/amap/shanghai-districts");
  if (!res.ok) throw new Error("Backend AMap district boundary request failed");
  const json = (await res.json()) as { districts?: DistrictBoundary[] };
  if (!json.districts?.length) throw new Error("No district boundaries from backend");
  return json.districts;
}

async function fetchStreetBoundaries(): Promise<StreetBoundary[]> {
  const res = await fetch("/api/amap/shanghai-streets");
  if (!res.ok) throw new Error("Backend street boundary request failed");
  const json = (await res.json()) as { streets?: StreetBoundary[] };
  return json.streets ?? [];
}

async function fetchStreetMetrics(): Promise<StreetMetric[]> {
  const res = await fetch("/api/streets");
  if (!res.ok) throw new Error("Backend street metrics request failed");
  return (await res.json()) as StreetMetric[];
}

const MapPanel = memo(function MapPanel({ districts, selectedDistrict, recommendations, onSelectDistrict }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const polygonsRef = useRef<Record<string, any[]>>({});
  const districtOutlineRef = useRef<Record<string, any[]>>({});
  const streetPolygonsRef = useRef<StreetPolygonEntry[]>([]);
  const infoWindowRef = useRef<any>(null);
  const bubbleFrameRef = useRef<number | null>(null);
  const selectedDistrictRef = useRef<string | null>(selectedDistrict);
  const mapModeRef = useRef<MapMode>("calibrated");
  const showStreetBoundariesRef = useRef(DEFAULT_SHOW_STREET_BOUNDARIES);
  const metricByNameRef = useRef<Map<string, DistrictMetric>>(new Map());
  const streetMetricByKeyRef = useRef<Map<string, StreetMetric>>(new Map());
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("calibrated");
  const [streetMetrics, setStreetMetrics] = useState<StreetMetric[]>([]);
  const [showStreetBoundaries, setShowStreetBoundaries] = useState(DEFAULT_SHOW_STREET_BOUNDARIES);
  const [districtBubbles, setDistrictBubbles] = useState<DistrictBubblePosition[]>([]);
  const [infoWindowOpen, setInfoWindowOpen] = useState(false);

  const metricByName = useMemo(() => {
    const map = new Map<string, DistrictMetric>();
    districts.forEach((item) => map.set(item.district, item));
    return map;
  }, [districts]);

  const streetMetricByKey = useMemo(() => {
    const map = new Map<string, StreetMetric>();
    streetMetrics.forEach((item) => map.set(streetKey(item.district, item.street), item));
    return map;
  }, [streetMetrics]);

  const heatmapMetrics = useMemo(
    () => (showStreetBoundaries && streetMetrics.length > 0 ? streetMetrics : districts),
    [districts, showStreetBoundaries, streetMetrics]
  );

  const modeStats = useMemo(() => {
    const config = mapModes[mapMode];
    const values = heatmapMetrics.map(config.value).filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    return { min, max, config };
  }, [heatmapMetrics, mapMode]);

  const recommendationNames = useMemo(() => new Set(recommendations.map((item) => item.district)), [recommendations]);

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict;
  }, [selectedDistrict]);

  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  useEffect(() => {
    showStreetBoundariesRef.current = showStreetBoundaries;
  }, [showStreetBoundaries]);

  useEffect(() => {
    metricByNameRef.current = metricByName;
  }, [metricByName]);

  useEffect(() => {
    streetMetricByKeyRef.current = streetMetricByKey;
  }, [streetMetricByKey]);

  const getModeRatio = (item: DistrictMetric, mode: MapMode, source: DistrictMetric[]) => {
    const config = mapModes[mode];
    const values = source.map(config.value).filter((value) => Number.isFinite(value));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    if (max === min) return 0.5;
    return (config.value(item) - min) / (max - min);
  };

  const getModeColor = (item: DistrictMetric, mode: MapMode, source: DistrictMetric[]) => {
    const config = mapModes[mode];
    if (!Number.isFinite(config.value(item))) return "#f3f4f6";
    return mixColor(config.low, config.high, getModeRatio(item, mode, source));
  };

  const getBubbleSize = (item: DistrictMetric, mode: MapMode, source: DistrictMetric[]) => {
    const ratio = getModeRatio(item, mode, source);
    return Math.round(36 + ratio * 28);
  };

  const getPixelXY = (pixel: any) => ({
    x: typeof pixel.getX === "function" ? pixel.getX() : pixel.x,
    y: typeof pixel.getY === "function" ? pixel.getY() : pixel.y
  });

  const updateDistrictBubblePositions = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.AMap) return;
    const next = districts.flatMap((metric) => {
      if (metric.center_lng === null || metric.center_lat === null) return [];
      const pixel = map.lngLatToContainer(new window.AMap.LngLat(metric.center_lng, metric.center_lat));
      const { x, y } = getPixelXY(pixel);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [{ district: metric.district, x, y, metric }];
    });
    setDistrictBubbles(next);
  }, [districts]);

  const scheduleDistrictBubbleUpdate = useCallback(() => {
    if (bubbleFrameRef.current !== null) return;
    bubbleFrameRef.current = window.requestAnimationFrame(() => {
      bubbleFrameRef.current = null;
      updateDistrictBubblePositions();
    });
  }, [updateDistrictBubblePositions]);

  const getBubbleLabel = (item: DistrictMetric, mode: MapMode) => {
    const config = mapModes[mode];
    return config.format(config.value(item));
  };

  useEffect(() => {
    if (!containerRef.current || districts.length === 0 || mapRef.current) return;
    let cancelled = false;
    let boundaryTimer: number | undefined;
    loadAmap()
      .then((AMap) => {
        if (cancelled || !containerRef.current) return;
        try {
          const map = new AMap.Map(containerRef.current, {
            center: SHANGHAI_CENTER,
            zoom: 10,
            viewMode: "2D",
            mapStyle: "amap://styles/normal"
          });
          mapRef.current = map;
          infoWindowRef.current = new AMap.InfoWindow({
            offset: new AMap.Pixel(0, -18),
            closeWhenClickMap: true
          });
          infoWindowRef.current.on("close", () => setInfoWindowOpen(false));

          const clearPolygons = (items: any[]) => {
            items.forEach((polygon) => map.remove(polygon));
          };
          const refreshDistrictBubbles = () => scheduleDistrictBubbleUpdate();
          map.on("mapmove", refreshDistrictBubbles);
          map.on("moveend", refreshDistrictBubbles);
          map.on("zoomchange", refreshDistrictBubbles);
          map.on("zoomend", refreshDistrictBubbles);
          map.on("resize", refreshDistrictBubbles);
          window.setTimeout(refreshDistrictBubbles, 0);

          const drawDistrictOutlines = (districtList: DistrictBoundary[]) => {
            if (cancelled) return;
            clearPolygons(Object.values(districtOutlineRef.current).flat());
            districtOutlineRef.current = {};
            districtList.forEach((district) => {
              const name = normalizeDistrictName(district.name);
              if (!district.boundaries) return;
              const outlines = district.boundaries.map((boundary: any) => {
                const polygon = new AMap.Polygon({
                  path: boundary,
                  strokeColor: "#cbd5e1",
                  strokeWeight: 1,
                  strokeOpacity: 0.45,
                  fillOpacity: 0,
                  cursor: "default",
                  zIndex: 2
                });
                map.add(polygon);
                return polygon;
              });
              districtOutlineRef.current[name] = outlines;
            });
          };

          const drawStreetHeatmap = (streetList: StreetBoundary[], metricsForDraw?: StreetMetric[]) => {
            if (cancelled) return;
            clearPolygons(streetPolygonsRef.current.map((entry) => entry.polygon));
            streetPolygonsRef.current = [];
            if (!streetList.length) return;

            const metricMap =
              metricsForDraw && metricsForDraw.length > 0
                ? new Map(metricsForDraw.map((item) => [streetKey(item.district, item.street), item]))
                : streetMetricByKeyRef.current;
            const source = metricsForDraw && metricsForDraw.length > 0 ? metricsForDraw : districts;
            streetList.forEach((street) => {
              const districtName = normalizeDistrictName(street.district);
              const metric = metricMap.get(streetKey(districtName, street.name));
              street.boundaries.forEach((boundary: any) => {
                const polygon = new AMap.Polygon({
                  path: boundary,
                  strokeColor: metric ? "#ffffff" : "#d6d3d1",
                  strokeWeight: 0.7,
                  strokeOpacity: metric ? 0.55 : 0.4,
                  fillColor: metric ? getModeColor(metric, mapModeRef.current, source) : "#f3f4f6",
                  fillOpacity: metric ? 0.42 : 0.18,
                  cursor: "pointer",
                  zIndex: 12
                });
                polygon.on("click", (event: any) => {
                  const mode = mapModeRef.current;
                  const modeConfig = mapModes[mode];
                  onSelectDistrict(districtName);
                  infoWindowRef.current?.setContent(
                    metric
                      ? `<div class="map-tooltip">
                          <div class="map-tooltip-title">${districtName} · ${street.name}</div>
                          <div>${modeConfig.label}: <b>${modeConfig.format(modeConfig.value(metric))}${modeConfig.unit ? ` ${modeConfig.unit}` : ""}</b></div>
                          <div>房价: <b>${Math.round(metric.avg_price).toLocaleString("zh-CN")} 元/㎡</b></div>
                          <div>POI: <b>${metric.poi_total.toLocaleString("zh-CN")}</b></div>
                          <div>商圈活跃度: <b>${metric.business_activity.toFixed(1)}</b></div>
                          <div>校准评分: <b>${formatScore(displayScore(metric, "calibrated_score_life_circle"))}</b></div>
                          <div>生活圈总分: <b>${formatScore(displayScore(metric, "life_circle_score"))}</b></div>
                          <div>5/10/15分钟: <b>${formatScore(displayScore(metric, "life_circle_5min_score"))} / ${formatScore(displayScore(metric, "life_circle_10min_score"))} / ${formatScore(displayScore(metric, "life_circle_15min_score"))}</b></div>
                          <div>设施供需充足度: <b>${formatScore(displayScore(metric, "e2sfca_access_score"))}</b></div>
                          <div>可达性分: <b>${formatScore(displayScore(metric, "access_score"))}</b></div>
                          <div>性价比分: <b>${formatScore(displayScore(metric, "value_score"))}</b></div>
                          ${(metric.sample_reliability_score ?? 1) < 1 ? `<div>样本不足，评分已降权</div>` : ""}
                        </div>`
                      : `<div class="map-tooltip">
                          <div class="map-tooltip-title">${districtName} · ${street.name}</div>
                          <div>暂无街镇级指标数据</div>
                        </div>`
                  );
                  infoWindowRef.current?.open(map, event.lnglat);
                  setInfoWindowOpen(true);
                });
                polygon.on("mouseover", () => {
                  polygon.setOptions({ fillOpacity: metric ? 0.72 : 0.3, strokeWeight: 1.2, strokeOpacity: 0.9 });
                });
                polygon.on("mouseout", () => {
                  polygon.setOptions({
                    fillOpacity: metric ? 0.42 : 0.18,
                    strokeWeight: 0.7,
                    strokeOpacity: metric ? 0.55 : 0.4
                  });
                });
                if (showStreetBoundariesRef.current) map.add(polygon);
                streetPolygonsRef.current.push({ polygon, district: districtName, street: street.name });
              });
            });
          };

          const drawDistricts = (districtList: DistrictBoundary[]) => {
            if (cancelled) return;
            clearPolygons(Object.values(polygonsRef.current).flat());
            polygonsRef.current = {};
            if (districtList.length === 0) {
              setMapError("没有获取到上海行政区边界，请检查高德行政区查询服务权限。");
              setLoading(false);
              return;
            }

            districtList.forEach((district) => {
              const name = normalizeDistrictName(district.name);
              const metric = metricByName.get(name);
              if (!metric || !district.boundaries) return;
              const polygons = district.boundaries.map((boundary: any) => {
                const polygon = new AMap.Polygon({
                  path: boundary,
                  strokeColor: recommendationNames.has(name) ? "#0f766e" : "#334155",
                  strokeWeight: recommendationNames.has(name) ? 2 : 1,
                  strokeOpacity: 0.75,
                  fillColor: "#ffffff",
                  fillOpacity: 0.03,
                  cursor: "pointer",
                  zIndex: recommendationNames.has(name) ? 14 : 10
                });
                polygon.on("click", () => onSelectDistrict(name));
                polygon.on("mouseover", (event: any) => {
                  polygon.setOptions({ fillOpacity: 0.12, strokeWeight: 2.2 });
                  infoWindowRef.current?.setContent(
                    `<div class="map-tooltip">
                      <div class="map-tooltip-title">${name}</div>
                      <div>平均房价: <b>${Math.round(metric.avg_price).toLocaleString("zh-CN")} 元/㎡</b></div>
                      <div>POI: <b>${metric.poi_total.toLocaleString("zh-CN")}</b></div>
                      <div>稳健评分: <b>${formatScore(displayScore(metric, "livability_score_v2"))}</b></div>
                      <div>校准评分: <b>${formatScore(displayScore(metric, "calibrated_score_life_circle"))}</b></div>
                      <div>生活圈总分: <b>${formatScore(displayScore(metric, "life_circle_score"))}</b></div>
                      <div>5/10/15分钟: <b>${formatScore(displayScore(metric, "life_circle_5min_score"))} / ${formatScore(displayScore(metric, "life_circle_10min_score"))} / ${formatScore(displayScore(metric, "life_circle_15min_score"))}</b></div>
                      <div>设施供需充足度: <b>${formatScore(displayScore(metric, "e2sfca_access_score"))}</b></div>
                      <div>可达性分: <b>${formatScore(displayScore(metric, "access_score"))}</b></div>
                      ${(metric.sample_reliability_score ?? 1) < 1 ? `<div>样本不足，评分已降权</div>` : ""}
                    </div>`
                  );
                  infoWindowRef.current?.open(map, event.lnglat);
                });
                polygon.on("mouseout", () => {
                  const active = selectedDistrictRef.current === name;
                  polygon.setOptions({ fillOpacity: active ? 0.18 : 0.03, strokeWeight: active ? 3 : recommendationNames.has(name) ? 2 : 1 });
                });
                map.add(polygon);
                return polygon;
              });
              polygonsRef.current[name] = polygons;
            });

            drawStreetHeatmap(streetListCache.current ?? [], streetMetricsRef.current);
            refreshDistrictBubbles();
            setLoading(false);
          };

          const loadBackendBoundaries = () => {
            fetchBackendBoundaries()
              .then(drawDistricts)
              .catch(() => {
                if (cancelled) return;
                setMapError("行政区边界加载失败。高德官方边界与本地边界都不可用，请检查高德 Key 或本地边界文件。");
                setLoading(false);
              });
          };

          const loadOfficialDistrictBoundaries = () => {
            const districtSearch = new AMap.DistrictSearch({
              level: "district",
              subdistrict: 1,
              extensions: "all"
            });
            boundaryTimer = window.setTimeout(() => {
              if (cancelled) return;
              loadBackendBoundaries();
            }, 10000);
            districtSearch.search("上海市", (status: string, result: any) => {
              if (cancelled) return;
              if (boundaryTimer) window.clearTimeout(boundaryTimer);
              if (status !== "complete") {
                loadBackendBoundaries();
                return;
              }
              const districtList = (result?.districtList?.[0]?.districtList ?? []).map((district: any) => ({
                name: normalizeDistrictName(district.name),
                adcode: district.adcode,
                center: null,
                boundaries: district.boundaries ?? []
              }));
              drawDistricts(districtList);
            });
          };

          const streetListCache: { current: StreetBoundary[] } = { current: [] };
          const streetMetricsRef: { current: StreetMetric[] } = { current: [] };
          Promise.all([fetchStreetBoundaries(), fetchStreetMetrics()])
            .then(([streetBoundaries, metrics]) => {
              streetListCache.current = streetBoundaries;
              streetMetricsRef.current = metrics;
              setStreetMetrics(metrics);
              streetMetricByKeyRef.current = new Map(
                metrics.map((item) => [streetKey(item.district, item.street), item])
              );
              drawStreetHeatmap(streetBoundaries, metrics);
            })
            .catch(() => undefined);
          loadOfficialDistrictBoundaries();
        } catch {
          setMapError("高德地图初始化失败，请检查 VITE_AMAP_KEY、VITE_AMAP_SECURITY_CODE 和浏览器控制台错误。");
          setLoading(false);
        }
      })
      .catch(() => {
        setMapError("高德地图加载失败，请检查 VITE_AMAP_KEY。");
        setLoading(false);
      });
    return () => {
      cancelled = true;
      if (boundaryTimer) window.clearTimeout(boundaryTimer);
      if (bubbleFrameRef.current !== null) {
        window.cancelAnimationFrame(bubbleFrameRef.current);
        bubbleFrameRef.current = null;
      }
    };
  }, [districts, metricByName, onSelectDistrict, recommendationNames, recommendations, scheduleDistrictBubbleUpdate, selectedDistrict]);

  useEffect(() => {
    scheduleDistrictBubbleUpdate();
  }, [mapMode, scheduleDistrictBubbleUpdate, showStreetBoundaries]);

  useEffect(() => {
    Object.entries(polygonsRef.current).forEach(([name, polygons]) => {
      const metric = metricByName.get(name);
      polygons.forEach((polygon) => {
        const active = selectedDistrict === name;
        polygon.setOptions({
          fillColor: metric ? getModeColor(metric, mapMode, districts) : "#cbd5e1",
          fillOpacity: active ? 0.9 : 0.62,
          strokeColor: active ? "#111827" : recommendationNames.has(name) ? "#0f766e" : "#334155",
          strokeWeight: active ? 3 : recommendationNames.has(name) ? 2.5 : 1,
          zIndex: active ? 30 : recommendationNames.has(name) ? 18 : 10
        });
      });
    });
    const source = showStreetBoundaries && streetMetrics.length > 0 ? streetMetrics : districts;
    streetPolygonsRef.current.forEach(({ polygon, district, street }) => {
      const metric = streetMetricByKey.get(streetKey(district, street));
      polygon.setOptions({
        fillColor: metric ? getModeColor(metric, mapMode, source) : "#f3f4f6",
        fillOpacity: metric ? (selectedDistrict === district ? 0.58 : 0.42) : 0.18,
        strokeOpacity: metric ? 0.55 : 0.4
      });
    });
  }, [districts, mapMode, metricByName, recommendationNames, selectedDistrict, showStreetBoundaries, streetMetricByKey, streetMetrics]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    streetPolygonsRef.current.forEach((polygon) => {
      if (showStreetBoundaries) {
        map.add(polygon);
      } else {
        map.remove(polygon);
      }
    });
    if (!showStreetBoundaries) {
      infoWindowRef.current?.close();
      setInfoWindowOpen(false);
    }
  }, [showStreetBoundaries]);

  return (
    <section className="relative h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <div className="absolute right-4 top-4 z-20 rounded-lg border border-[#ead8c2]/70 bg-white/80 px-3 py-3 text-sm shadow-soft backdrop-blur-md">
        <div className="flex flex-nowrap gap-2">
          {visibleMapModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMapMode(mode)}
              className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                mapMode === mode
                  ? "border-[#ff9f72] bg-[#fff0df] text-[#a44724]"
                  : "border-[#ead8c2] bg-white text-[#775f4d] hover:border-[#f3c99a] hover:bg-[#fff9ef]"
              }`}
            >
              {mapModes[mode].label}
            </button>
          ))}
        </div>
        <div className="mt-3 border-t border-[#ead8c2] pt-3 text-xs text-[#775f4d]">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-[#33251f]">{modeStats.config.label}</span>
            <span>{modeStats.config.unit || "指数"}</span>
          </div>
          <div
            className="h-2 rounded-full"
            style={{
              background: `linear-gradient(90deg,${modeStats.config.low},${modeStats.config.high})`
            }}
          />
          <div className="mt-2 flex justify-between">
            <span>{modeStats.config.format(modeStats.min)}</span>
            <span>{modeStats.config.format(modeStats.max)}</span>
          </div>
        </div>
        <div className="mt-3 border-t border-[#ead8c2] pt-3">
          <button
            type="button"
            onClick={() => setShowStreetBoundaries((value) => !value)}
            className={`w-full rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              showStreetBoundaries
                ? "border-[#7cc4a4] bg-[#ecfdf3] text-[#176b50]"
                : "border-[#ead8c2] bg-white text-[#775f4d] hover:border-[#f3c99a] hover:bg-[#fff9ef]"
            }`}
          >
            {showStreetBoundaries ? "隐藏街道边界" : "显示街道边界"}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="h-full w-full" />
      <div className={`pointer-events-none absolute inset-0 z-[8] transition-opacity ${infoWindowOpen ? "opacity-0" : "opacity-100"}`}>
        {districtBubbles.map(({ district, x, y, metric }) => {
          const color = getModeColor(metric, mapMode, districts);
          const size = getBubbleSize(metric, mapMode, districts);
          return (
            <button
              key={district}
              type="button"
              title={district}
              onClick={() => onSelectDistrict(district)}
              className="metric-bubble pointer-events-auto absolute"
              style={
                {
                  "--bubble-color": color,
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${size}px`,
                  height: `${size}px`,
                  transform: "translate(-50%, -50%)"
                } as CSSProperties
              }
            >
              <span className="metric-bubble-name">{district}</span>
              <span className="metric-bubble-value">{getBubbleLabel(metric, mapMode)}</span>
            </button>
          );
        })}
      </div>
      {(loading || mapError) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 text-sm text-slate-600 backdrop-blur-sm">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {mapError ?? "正在加载高德地图与行政区边界"}
        </div>
      )}
    </section>
  );
});

export default MapPanel;
