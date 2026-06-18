import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DistrictMetric } from "../types/metrics";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeDistrictName(value: string) {
  return value.replace("上海市", "").replace("浦东新区", "浦东").replace(/(新区|区|县)$/u, "");
}

export function formatPrice(value: number) {
  return `${Math.round(value).toLocaleString("zh-CN")} 元/㎡`;
}

export function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : "暂无";
}

export function formatPercent(value: number) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "暂无";
}

export function displayScore<T extends DistrictMetric>(item: T, field: keyof DistrictMetric) {
  const displayField = `${String(field)}_display` as keyof DistrictMetric;
  const storedDisplayValue = item[displayField];
  if (storedDisplayValue !== null && storedDisplayValue !== undefined && storedDisplayValue !== "") {
    const displayValue = Number(storedDisplayValue);
    if (Number.isFinite(displayValue)) return displayValue;
  }
  const rawValue = Number(item[field]);
  return Number.isFinite(rawValue) ? rawValue * 10 : 0;
}

export function scoreColor(score: number) {
  if (score >= 8) return "#15803d";
  if (score >= 6.5) return "#22c55e";
  if (score >= 5) return "#a3e635";
  if (score >= 4) return "#f59e0b";
  return "#ef4444";
}
