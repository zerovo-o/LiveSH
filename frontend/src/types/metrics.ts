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
  center_lng: number | null;
  center_lat: number | null;
};

export type PoiCategory = {
  category: string;
  count: number;
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
