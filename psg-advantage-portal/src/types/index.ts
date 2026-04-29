// Portal user profile from Supabase portal_users table
export interface PortalUser {
  id: string
  email: string
  shop_id: string
  role: 'shop_owner' | 'psg_admin' | 'read_only'
  full_name: string | null
  created_at: string
  last_login: string | null
}

// Session log entry for portal_sessions_log
export interface SessionLogEntry {
  user_id: string
  shop_id: string
  action: string
}

// API error response shape
export interface ApiError {
  error: {
    code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_ERROR'
    message: string
  }
}

export interface HealthCheckResult {
  supabase: string
  redis: string
}

// Network dashboard types
export interface NetworkSummary {
  total_surveys: number
  avg_emi_pct: number
  active_shops: number
  alert_count: number
  total_surveys_delta?: number  // vs prior period
  avg_emi_delta?: number
}

export interface TrendPoint {
  month: string          // YYYY-MM format
  surveys: number
  avg_emi_pct: number    // already multiplied by 100
}

export interface ShopListItem {
  shop_name: string
  total_surveys: number
  avg_emi_pct: number
  trend?: 'improving' | 'stable' | 'declining'
  emi_delta?: number      // change vs prior period
  latest_survey_date: string
  place_id?: string
  address?: string | null
  phone?: string | null
  website?: string | null
  rating?: number | null
  category?: string | null
  latitude?: number | null
  longitude?: number | null
}

export interface AlertShop {
  shop_name: string
  avg_emi_pct: number
  total_surveys: number
  months_below: number   // consecutive months below threshold
}

// Shop detail types
export interface ShopDetail {
  shop_name: string
  invoiced_id?: number | null
  psg_id?: string | null
  invoiced_city?: string | null
  invoiced_state?: string | null
  avg_emi_pct: number
  trend: 'improving' | 'stable' | 'declining'
  emi_delta: number
  total_surveys: number
  avg_quality: number | null
  avg_cleanliness: number | null
  avg_communication: number | null
  avg_courtesy: number | null
  network_avg_communication: number | null
}

export interface ShopTrendPoint {
  month: string
  avg_emi_pct: number
  surveys: number
}

export interface ShopCompetitorPoint {
  is_anchor: boolean
  shop_name: string
  place_id: string | null
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  category: string | null
  latitude: number
  longitude: number
  distance_miles: number
}

export interface MarketMapPoint {
  layer: 'psg_customer' | 'directory_shop'
  id: string
  shop_name: string
  psg_id: string | null
  invoiced_id: number | null
  place_id: string | null
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  latitude: number
  longitude: number
  state: string | null
  city: string | null
  survey_count: number | null
  avg_emi_pct: number | null
  match_status: string
}

export interface MarketMapData {
  points: MarketMapPoint[]
  summary: {
    psg_customers: number
    directory_shops: number
    surveyed_psg_customers: number
    states: string[]
  }
}

export interface MarketViewportTopZip {
  zip: string
  state: string
  city: string | null
  year: number | null
  total_crashes: number
  injury_crashes: number
  weather_related_crashes: number
  storm_events: number
  hail_events: number
  wind_events: number
  storm_demand_score: number
  targeting_score: number
}

export interface MarketViewportTopCustomer {
  shop_name: string
  psg_id: string | null
  city: string | null
  state: string | null
  survey_count: number | null
  avg_emi_pct: number | null
}

export interface MarketViewportIntelligence {
  viewport_label: string
  zoom: number
  psg_customer_count: number
  directory_shop_count: number
  surveyed_psg_customer_count: number
  crash_count: number
  injury_crash_count: number
  weather_related_crash_count: number
  storm_event_count: number
  hail_event_count: number
  wind_event_count: number
  storm_demand_score: number
  top_zips: MarketViewportTopZip[]
  top_customers: MarketViewportTopCustomer[]
}

export interface ShopComment {
  survey_date: string
  comment_text: string
  scale_emi_pct: number
}

export interface PaginatedComments {
  comments: ShopComment[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Auth profile for API routes
export interface AuthProfile {
  userId: string
  email: string
  shopId: string
  role: 'shop_owner' | 'psg_admin' | 'read_only'
}
