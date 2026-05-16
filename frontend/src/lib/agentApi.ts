import type {
  HouseRecommendRequest,
  HouseRecommendResponse
} from "../types/agent";

export async function recommendHouses(
  payload: HouseRecommendRequest
): Promise<HouseRecommendResponse> {
  const res = await fetch("/api/agent/recommend-houses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API ${res.status}`);
  }

  return (await res.json()) as HouseRecommendResponse;
}
