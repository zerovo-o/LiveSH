export type CommuteMode = "transit" | "driving";

export type AgentRecommendRequest = {
  budget_wan: number;
  target_area: number;
  work_address: string;
  commute_mode: CommuteMode;
  max_commute_minutes: number;
  top_k: number;
};

export type DistrictRecommendation = {
  district: string;
  score: number;
  commute_minutes: number | null;
  avg_price: number | null;
  avg_total_price: number | null;
  house_count: number | null;
  reason: string;
  risks: string[];
};

export type AgentRecommendResponse = {
  work_location: string | null;
  recommendations: DistrictRecommendation[];
};

