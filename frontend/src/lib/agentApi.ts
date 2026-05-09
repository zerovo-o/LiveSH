import type { AgentRecommendRequest, AgentRecommendResponse } from "../types/agent";

export async function recommendDistricts(
  payload: AgentRecommendRequest
): Promise<AgentRecommendResponse> {
  const res = await fetch("/api/agent/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API ${res.status}`);
  }

  return (await res.json()) as AgentRecommendResponse;
}

