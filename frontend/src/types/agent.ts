export type CommuteMode = "transit" | "driving";

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
  daily_life_weight: number;
  commute_facility_weight: number;
  medical_weight: number;
  education_weight: number;
  recreation_weight: number;
  employment_weight: number;
  max_route_calls: number;
};

export type StreetRecommendation = {
  district: string;
  sub_district: string;
  street_score: number;
  median_commute_minutes: number | null;
  house_count: number;
  affordable_ratio: number;
  score_breakdown?: Record<string, number> | null;
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
  score_breakdown?: Record<string, number> | null;
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
  score_breakdown?: Record<string, number> | null;
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
