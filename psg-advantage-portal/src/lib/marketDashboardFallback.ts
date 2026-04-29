import type { MarketDashboardData } from '@/lib/supabase/data'

export const marketDashboardFallbackData: MarketDashboardData = {
  filter: {
    city: '',
    state: '',
    label: 'All markets',
  },
  summary: {
    accident_rows: 7728394,
    weather_related_count: 396000,
    severe_accident_rate: 22.8,
    weather_related_rate: 5.1,
    average_distance_miles: 0.7,
    storm_event_count: 0,
    hail_event_count: 0,
    storm_demand_score: 0,
    storm_layer_available: false,
  },
  opportunity: {
    targetable_accidents: 42768,
    coverage_gap: 64,
    best_next_channel: 'Paid search',
    weather_score: 53,
    severity_score: 84,
  },
  top_zips: [
    { zip: '90023', accidents: 9101, repair_demand: 100, paid_search_priority: 94, coverage_gap: 72, storm_event_count: 0, hail_event_count: 0, wind_event_count: 0, tornado_event_count: 0, storm_demand_score: 0 },
    { zip: '90022', accidents: 9096, repair_demand: 100, paid_search_priority: 94, coverage_gap: 72, storm_event_count: 0, hail_event_count: 0, wind_event_count: 0, tornado_event_count: 0, storm_demand_score: 0 },
    { zip: '90012', accidents: 7565, repair_demand: 91, paid_search_priority: 86, coverage_gap: 63, storm_event_count: 0, hail_event_count: 0, wind_event_count: 0, tornado_event_count: 0, storm_demand_score: 0 },
    { zip: '90033', accidents: 6621, repair_demand: 85, paid_search_priority: 81, coverage_gap: 57, storm_event_count: 0, hail_event_count: 0, wind_event_count: 0, tornado_event_count: 0, storm_demand_score: 0 },
    { zip: '90044', accidents: 6385, repair_demand: 83, paid_search_priority: 79, coverage_gap: 56, storm_event_count: 0, hail_event_count: 0, wind_event_count: 0, tornado_event_count: 0, storm_demand_score: 0 },
  ],
  dayparts: [
    { time: '12a', claims: 9637, search_intent: 33 },
    { time: '3a', claims: 10104, search_intent: 35 },
    { time: '6a', claims: 18623, search_intent: 65 },
    { time: '9a', claims: 18754, search_intent: 65 },
    { time: '12p', claims: 23835, search_intent: 83 },
    { time: '3p', claims: 25324, search_intent: 88 },
    { time: '6p', claims: 17997, search_intent: 63 },
    { time: '9p', claims: 11976, search_intent: 42 },
  ],
  states: [
    { state: 'CA', total_accidents: 1493538, high_severity_count: 341000, weather_related_count: 71000, zip_count: 12073, severe_rate: 22.8, weather_rate: 4.8, opportunity_score: 100 },
    { state: 'FL', total_accidents: 712256, high_severity_count: 167000, weather_related_count: 43000, zip_count: 7005, severe_rate: 23.4, weather_rate: 6.0, opportunity_score: 88 },
    { state: 'TX', total_accidents: 527265, high_severity_count: 118000, weather_related_count: 22000, zip_count: 6771, severe_rate: 22.4, weather_rate: 4.2, opportunity_score: 81 },
  ],
  channel_mix: [
    { channel: 'Paid search', score: 94 },
    { channel: 'Tow partners', score: 76 },
    { channel: 'Carrier/DRP', score: 82 },
    { channel: 'Geo display', score: 68 },
    { channel: 'Weather trigger', score: 53 },
  ],
  signal_fit: [
    { signal: 'Demand', current: 94, target: 90 },
    { signal: 'Severity', current: 84, target: 76 },
    { signal: 'Weather', current: 53, target: 72 },
    { signal: 'Coverage gap', current: 48, target: 62 },
    { signal: 'ZIP focus', current: 78, target: 80 },
  ],
  actions: [
    { title: 'Concentrate spend', value: '90023, 90022, 90012', detail: '42,768 accidents in the current top ZIP set.' },
    { title: 'Prime dayparts', value: '3p + 12p', detail: 'Highest accident windows for search, social, and partner staffing.' },
    { title: 'Weather proxy', value: '396K accidents', detail: 'Storm tables are pending, so scoring uses accident weather fields.' },
  ],
}
