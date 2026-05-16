export type DistrictMetric = {
  district: string;
  avg_price: number;
  avg_total_price: number;
  house_count: number;
  poi_total: number;
  recreation_count: number;
  company_count: number;
  residence_count: number;
  shopping_count: number;
  traffic_count: number;
  healthcare_count: number;
  business_activity: number;
  activity_norm: number;
  price_norm: number;
  livability_score: number;
  poi_diversity: number;
  shopping_per_house: number;
  traffic_per_house: number;
  healthcare_per_house: number;
  recreation_per_house: number;
  company_per_house: number;
  cost_pressure: number;
  affordability_score: number;
  service_score: number;
  vitality_score: number;
  livability_score_v2: number;
  shopping_access: number;
  traffic_access: number;
  healthcare_access: number;
  recreation_access: number;
  company_access: number;
  nearest_traffic_distance: number | null;
  nearest_healthcare_distance: number | null;
  access_score: number;
  value_score: number;
  shopping_e2sfca_access: number;
  traffic_e2sfca_access: number;
  healthcare_e2sfca_access: number;
  recreation_e2sfca_access: number;
  company_e2sfca_access: number;
  e2sfca_access_score: number;
  e2sfca_value_score: number;
  sample_reliability_score: number;
  calibrated_score: number;
  life_circle_5min_score: number;
  life_circle_10min_score: number;
  life_circle_15min_score: number;
  life_circle_score: number;
  life_circle_5min_coverage: number;
  life_circle_10min_coverage: number;
  life_circle_15min_coverage: number;
  calibrated_score_life_circle: number;
  center_lng: number | null;
  center_lat: number | null;
};

export type PoiCategory = {
  category: string;
  count: number;
};

export type StreetMetric = DistrictMetric & {
  id: number;
  street: string;
};

export type Summary = {
  districts: DistrictMetric[];
  poi_categories: PoiCategory[];
  price_top10: DistrictMetric[];
  shopping_top5: DistrictMetric[];
  score_ranking: DistrictMetric[];
  scatter: DistrictMetric[];
  recommendations: DistrictMetric[];
};

export type AIAdvice = {
  district: string;
  prompt: string;
  advice: string;
  is_placeholder: boolean;
};
