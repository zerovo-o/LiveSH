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
  top_communities: number;
  top_houses_per_community: number;
  healthcare_weight: number;
  shopping_weight: number;
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
  rule_score: number;
  llm_score?: number | null;
  llm_confidence?: number | null;
  community_score?: number | null;
  reason: string;
  risks: string[];
};

export type CommunityRecommendation = {
  district: string;
  sub_district: string;
  community_name: string;
  score: number;
  rule_score: number;
  llm_score?: number | null;
  llm_confidence?: number | null;
  median_commute_minutes: number | null;
  avg_unit_price: number;
  avg_total_price: number;
  house_count: number;
  poi_score: number;
  traffic_score: number;
  budget_match_score: number;
  reason: string;
  risks: string[];
};

export type HouseRecommendResponse = {
  work_location: string | null;
  streets: StreetRecommendation[];
  communities: CommunityRecommendation[];
  houses: HouseRecommendation[];
  summary: Record<string, number | string | boolean | null>;
};
