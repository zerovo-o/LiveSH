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

export type HouseRecommendRequest = {
  budget_wan: number;
  target_area: number;
  work_address: string;
  commute_mode: CommuteMode;
  max_commute_minutes: number;
  top_streets: number;
  top_houses_per_street: number;
  max_route_calls: number;
};

export type StreetRecommendation = {
  district: string;
  sub_district: string;
  street_score: number;
  median_commute_minutes: number | null;
  house_count: number;
  affordable_ratio: number;
  reason: string;
  risks: string[];
};

export type HouseRecommendation = {
  house_id: string;
  district: string;
  sub_district: string;
  community_name: string | null;
  title: string | null;
  area: number | null;
  commute_minutes: number | null;
  unit_price: number;
  total_price: number;
  score: number;
  reason: string;
  risks: string[];
};

export type HouseRecommendResponse = {
  work_location: string | null;
  streets: StreetRecommendation[];
  houses: HouseRecommendation[];
  summary: Record<string, number | string | null>;
};
