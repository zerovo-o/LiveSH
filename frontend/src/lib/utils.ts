import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
  return value.toFixed(3);
}

export function scoreColor(score: number) {
  if (score >= 0.45) return "#15803d";
  if (score >= 0.2) return "#22c55e";
  if (score >= 0) return "#a3e635";
  if (score >= -0.25) return "#f59e0b";
  return "#ef4444";
}
