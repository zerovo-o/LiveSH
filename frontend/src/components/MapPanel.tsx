import { Loader2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { normalizeDistrictName, scoreColor } from "../lib/utils";
import type { DistrictMetric } from "../types/metrics";

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

type MapMode = "score" | "price" | "poi" | "activity";
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

const SHANGHAI_CENTER: [number, number] = [121.4737, 31.2304];

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
  score: {
    label: "综合评分",
    unit: "",
    low: "#ef4444",
    high: "#16a34a",
    value: (item) => item.livability_score,
    format: (value) => value.toFixed(3)
  },
  price: {
    label: "房价",
    unit: "元/㎡",
    low: "#fed7aa",
    high: "#dc2626",
    value: (item) => item.avg_price,
    format: (value) => `${Math.round(value / 1000)}k`
  },
  poi: {
    label: "POI总量",
    unit: "个",
    low: "#dbeafe",
    high: "#2563eb",
    value: (item) => item.poi_total,
    format: (value) => `${Math.round(value / 1000)}k`
  },
  activity: {
    label: "商圈活跃度",
    unit: "",
    low: "#ede9fe",
    high: "#7c3aed",
    value: (item) => item.business_activity,
    format: (value) => Math.round(value).toLocaleString("zh-CN")
  }
};

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

const MapPanel = memo(function MapPanel({ districts, selectedDistrict, recommendations, onSelectDistrict }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const polygonsRef = useRef<Record<string, any[]>>({});
  const streetPolygonsRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any>(null);
  const selectedDistrictRef = useRef<string | null>(selectedDistrict);
  const mapModeRef = useRef<MapMode>("score");
  const metricByNameRef = useRef<Map<string, DistrictMetric>>(new Map());
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>("score");
  const [showStreetBoundaries, setShowStreetBoundaries] = useState(true);

  const metricByName = useMemo(() => {
    const map = new Map<string, DistrictMetric>();
    districts.forEach((item) => map.set(item.district, item));
    return map;
  }, [districts]);

  const modeStats = useMemo(() => {
    const config = mapModes[mapMode];
    const values = districts.map(config.value);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    return { min, max, config };
  }, [districts, mapMode]);

  const recommendationNames = useMemo(() => new Set(recommendations.map((item) => item.district)), [recommendations]);

  useEffect(() => {
    selectedDistrictRef.current = selectedDistrict;
  }, [selectedDistrict]);

  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  useEffect(() => {
    metricByNameRef.current = metricByName;
  }, [metricByName]);

  const getModeRatio = (item: DistrictMetric, mode: MapMode) => {
    const config = mapModes[mode];
    const values = districts.map(config.value);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    if (max === min) return 0.5;
    return (config.value(item) - min) / (max - min);
  };

  const getModeColor = (item: DistrictMetric, mode: MapMode) => {
    if (mode === "score") return scoreColor(item.livability_score);
    const config = mapModes[mode];
    return mixColor(config.low, config.high, getModeRatio(item, mode));
  };

  const getBubbleSize = (item: DistrictMetric, mode: MapMode) => {
    const ratio = getModeRatio(item, mode);
    return Math.round(36 + ratio * 28);
  };

  const getBubbleHtml = (item: DistrictMetric, mode: MapMode) => {
    const config = mapModes[mode];
    const color = getModeColor(item, mode);
    const size = getBubbleSize(item, mode);
    return `<button class="metric-bubble" style="--bubble-color:${color};width:${size}px;height:${size}px" title="${item.district}">
      <span class="metric-bubble-name">${item.district}</span>
      <span class="metric-bubble-value">${config.format(config.value(item))}</span>
    </button>`;
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

          const drawDistricts = (districtList: DistrictBoundary[]) => {
            if (cancelled) return;
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
                  strokeWeight: recommendationNames.has(name) ? 2.5 : 1,
                  strokeOpacity: 0.8,
                  fillColor: getModeColor(metric, mapModeRef.current),
                  fillOpacity: 0.62,
                  cursor: "pointer",
                  zIndex: recommendationNames.has(name) ? 14 : 10
                });
                polygon.on("click", () => onSelectDistrict(name));
                polygon.on("mouseover", (event: any) => {
                  const mode = mapModeRef.current;
                  const config = mapModes[mode];
                  polygon.setOptions({ fillOpacity: 0.82, strokeWeight: 2.5 });
                  infoWindowRef.current?.setContent(
                    `<div class="map-tooltip">
                      <div class="map-tooltip-title">${name}</div>
                      <div>${config.label}: <b>${config.format(config.value(metric))}${config.unit ? ` ${config.unit}` : ""}</b></div>
                      <div>房价: <b>${Math.round(metric.avg_price).toLocaleString("zh-CN")} 元/㎡</b></div>
                      <div>POI: <b>${metric.poi_total.toLocaleString("zh-CN")}</b></div>
                      <div>宜居评分: <b>${metric.livability_score.toFixed(3)}</b></div>
                    </div>`
                  );
                  infoWindowRef.current?.open(map, event.lnglat);
                });
                polygon.on("mouseout", () => {
                  const active = selectedDistrictRef.current === name;
                  polygon.setOptions({ fillOpacity: active ? 0.88 : 0.62, strokeWeight: active ? 3 : recommendationNames.has(name) ? 2.5 : 1 });
                });
                map.add(polygon);
                return polygon;
              });
              polygonsRef.current[name] = polygons;
            });
            markersRef.current = districts
              .filter((item) => item.center_lng && item.center_lat)
              .map((item) => {
                const size = getBubbleSize(item, mapModeRef.current);
                const marker = new AMap.Marker({
                  position: [item.center_lng, item.center_lat],
                  content: getBubbleHtml(item, mapModeRef.current),
                  offset: new AMap.Pixel(-size / 2, -size / 2),
                  zIndex: 60,
                  extData: item.district
                });
                marker.on("click", () => onSelectDistrict(item.district));
                map.add(marker);
                return marker;
              });
            setLoading(false);
          };

          const drawStreetBoundaries = (streetList: StreetBoundary[]) => {
            if (cancelled || streetList.length === 0) return;
            streetPolygonsRef.current.forEach((polygon) => map.remove(polygon));
            streetPolygonsRef.current = streetList.flatMap((street) =>
              street.boundaries.map((boundary: any) => {
                const polygon = new AMap.Polygon({
                  path: boundary,
                  strokeColor: "#075985",
                  strokeWeight: 1.1,
                  strokeOpacity: 0.55,
                  fillOpacity: 0,
                  cursor: "default",
                  zIndex: 36,
                  extData: {
                    district: street.district,
                    street: street.name
                  }
                });
                polygon.on("mouseover", (event: any) => {
                  polygon.setOptions({ strokeOpacity: 0.95, strokeWeight: 2 });
                  infoWindowRef.current?.setContent(
                    `<div class="map-tooltip">
                      <div class="map-tooltip-title">${street.district} · ${street.name}</div>
                      <div>街道/镇边界</div>
                    </div>`
                  );
                  infoWindowRef.current?.open(map, event.lnglat);
                });
                polygon.on("mouseout", () => {
                  polygon.setOptions({ strokeOpacity: 0.55, strokeWeight: 1.1 });
                });
                if (showStreetBoundaries) map.add(polygon);
                return polygon;
              })
            );
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

          fetchStreetBoundaries().then(drawStreetBoundaries).catch(() => undefined);
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
    };
  }, [districts, metricByName, onSelectDistrict, recommendationNames, recommendations, selectedDistrict]);

  useEffect(() => {
    Object.entries(polygonsRef.current).forEach(([name, polygons]) => {
      const metric = metricByName.get(name);
      polygons.forEach((polygon) => {
        const active = selectedDistrict === name;
        polygon.setOptions({
          fillColor: metric ? getModeColor(metric, mapMode) : "#cbd5e1",
          fillOpacity: active ? 0.9 : 0.62,
          strokeColor: active ? "#111827" : recommendationNames.has(name) ? "#0f766e" : "#334155",
          strokeWeight: active ? 3 : recommendationNames.has(name) ? 2.5 : 1,
          zIndex: active ? 30 : recommendationNames.has(name) ? 18 : 10
        });
      });
    });
    const AMap = window.AMap;
    if (!AMap) return;
    markersRef.current.forEach((marker) => {
      const name = marker.getExtData?.();
      const metric = name ? metricByName.get(name) : null;
      if (!metric) return;
      const size = getBubbleSize(metric, mapMode);
      marker.setContent(getBubbleHtml(metric, mapMode));
      marker.setOffset(new AMap.Pixel(-size / 2, -size / 2));
    });
  }, [districts, mapMode, metricByName, recommendationNames, selectedDistrict]);

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
  }, [showStreetBoundaries]);

  return (
    <section className="relative h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <div className="absolute right-4 top-4 z-20 rounded-lg border border-[#ead8c2]/70 bg-white/80 px-3 py-3 text-sm shadow-soft backdrop-blur-md">
        <div className="flex flex-nowrap gap-2">
          {(Object.keys(mapModes) as MapMode[]).map((mode) => (
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
              background:
                mapMode === "score"
                  ? "linear-gradient(90deg,#ef4444,#f59e0b,#a3e635,#16a34a)"
                  : `linear-gradient(90deg,${modeStats.config.low},${modeStats.config.high})`
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
            {showStreetBoundaries ? "隐藏街镇边界" : "显示街镇边界"}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="h-full w-full" />
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
