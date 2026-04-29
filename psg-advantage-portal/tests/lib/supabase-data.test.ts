import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: mockRpc,
  }),
}))

describe('supabase data helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getNetworkSummary calls the Supabase RPC and coerces numeric rows', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        total_surveys: '1200',
        avg_emi_pct: '92.4',
        active_shops: '15',
        alert_count: '3',
      }],
      error: null,
    })

    const { getNetworkSummary } = await import('@/lib/supabase/data')
    const result = await getNetworkSummary('2025-01-01', '2025-03-31')

    expect(mockRpc).toHaveBeenCalledWith('network_summary', {
      start_date: '2025-01-01',
      end_date: '2025-03-31',
    })
    expect(result).toEqual({
      total_surveys: 1200,
      avg_emi_pct: 92.4,
      active_shops: 15,
      alert_count: 3,
    })
  })

  it('getShopDetail returns null for empty RPC results', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null })

    const { getShopDetail } = await import('@/lib/supabase/data')
    const result = await getShopDetail('Missing Shop', '2025-01-01', '2025-03-31')

    expect(result).toBeNull()
  })

  it('getShopDetail maps Invoiced identity fields', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        shop_name: 'D&M Auto Body',
        invoiced_id: '1469644',
        psg_id: 'PS687',
        invoiced_city: 'Rockaway',
        invoiced_state: 'NJ',
        avg_emi_pct: '95.3',
        total_surveys: '21',
        avg_quality: '9.8',
        avg_cleanliness: '9.9',
        avg_communication: '9.7',
        avg_courtesy: '9.9',
        network_avg_communication: '9.3',
      }],
      error: null,
    })

    const { getShopDetail } = await import('@/lib/supabase/data')
    const result = await getShopDetail('D&M Auto Body', '2026-01-28', '2026-04-28')

    expect(result).toMatchObject({
      shop_name: 'D&M Auto Body',
      invoiced_id: 1469644,
      psg_id: 'PS687',
      invoiced_city: 'Rockaway',
      invoiced_state: 'NJ',
      avg_emi_pct: 95.3,
    })
  })

  it('getMarketingMetadata maps optional storm demand fields', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        row_count: '1000',
        weather_related_count: '120',
        severe_accident_rate: '14.2',
        weather_related_rate: '12.0',
        average_distance_miles: '0.8',
        storm_event_count: '25',
        hail_event_count: '8',
        wind_event_count: '10',
        tornado_event_count: '1',
        storm_demand_score: '117.5',
        max_hail_size: '2.75',
        max_wind_speed: '70',
      }],
      error: null,
    })

    const { getMarketingMetadata } = await import('@/lib/supabase/data')
    const result = await getMarketingMetadata('Houston', 'TX')

    expect(mockRpc).toHaveBeenCalledWith('marketing_metadata', {
      city: 'Houston',
      state: 'TX',
    })
    expect(result.storm_event_count).toBe(25)
    expect(result.hail_event_count).toBe(8)
    expect(result.storm_demand_score).toBe(117.5)
    expect(result.max_hail_size).toBe(2.75)
  })

  it('getMarketStateRollup maps ranked market rows', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        state: 'CA',
        total_accidents: '1493538',
        high_severity_count: '341000',
        weather_related_count: '71000',
        zip_count: '12073',
        severe_rate: '22.8',
        weather_rate: '4.8',
        opportunity_score: '100',
      }],
      error: null,
    })

    const { getMarketStateRollup } = await import('@/lib/supabase/data')
    const result = await getMarketStateRollup()

    expect(mockRpc).toHaveBeenCalledWith('market_state_rollup', {})
    expect(result[0]).toEqual({
      state: 'CA',
      total_accidents: 1493538,
      high_severity_count: 341000,
      weather_related_count: 71000,
      zip_count: 12073,
      severe_rate: 22.8,
      weather_rate: 4.8,
      opportunity_score: 100,
    })
  })

  it('getCollisionTargetingExamples maps official crash demand rows', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        zip: '60639',
        state: 'IL',
        city: 'Chicago',
        year: '2025',
        total_crashes: '3733',
        injury_crashes: '563',
        weather_related_crashes: '353',
        storm_event_count: '0',
        hail_event_count: '0',
        wind_event_count: '0',
        psg_customer_count: '1',
        directory_shop_count: '9',
        collision_targeting_score: '5607.00',
        example_detail: 'ZIP 60639 had 3733 official crash records in 2025.',
      }],
      error: null,
    })

    const { getCollisionTargetingExamples } = await import('@/lib/supabase/data')
    const result = await getCollisionTargetingExamples('IL', 2025, 5)

    expect(mockRpc).toHaveBeenCalledWith('collision_targeting_examples', {
      p_state: 'IL',
      p_year: 2025,
      result_limit: 5,
    })
    expect(result[0]).toEqual({
      zip: '60639',
      state: 'IL',
      city: 'Chicago',
      year: 2025,
      total_crashes: 3733,
      injury_crashes: 563,
      weather_related_crashes: 353,
      storm_event_count: 0,
      hail_event_count: 0,
      wind_event_count: 0,
      psg_customer_count: 1,
      directory_shop_count: 9,
      collision_targeting_score: 5607,
      example_detail: 'ZIP 60639 had 3733 official crash records in 2025.',
    })
  })

  it('getShopCompetitorOverlay maps anchor and competitor rows', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        is_anchor: true,
        shop_name: 'Richmond Auto Body',
        place_id: 'anchor-place',
        address: '91 Merrick Rd',
        phone: '+1 631-264-3442',
        website: 'https://example.com',
        rating: '4.9',
        category: 'Auto body shop',
        latitude: '40.671032',
        longitude: '-73.419282',
        distance_miles: '0',
      }, {
        is_anchor: false,
        shop_name: 'Lake Town Motors',
        place_id: 'competitor-place',
        address: '118 Merrick Rd',
        phone: null,
        website: '',
        rating: '4.8',
        category: 'Auto repair shop',
        latitude: '40.6701',
        longitude: '-73.4179',
        distance_miles: '0.09',
      }],
      error: null,
    })

    const { getShopCompetitorOverlay } = await import('@/lib/supabase/data')
    const result = await getShopCompetitorOverlay('Richmond Auto Body', 25, 10)

    expect(mockRpc).toHaveBeenCalledWith('shop_competitor_overlay', {
      p_shop_name: 'Richmond Auto Body',
      p_radius_miles: 25,
      p_limit: 10,
    })
    expect(result).toEqual([
      expect.objectContaining({
        is_anchor: true,
        shop_name: 'Richmond Auto Body',
        rating: 4.9,
        distance_miles: 0,
      }),
      expect.objectContaining({
        is_anchor: false,
        shop_name: 'Lake Town Motors',
        rating: 4.8,
        distance_miles: 0.09,
      }),
    ])
  })

  it('getMarketMapData uses the one-row payload RPC and maps full point data', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        payload: {
          points: [{
            layer: 'psg_customer',
            id: 'PS687',
            shop_name: 'D&M Auto Body',
            psg_id: 'PS687',
            invoiced_id: '1469644',
            place_id: 'place-1',
            address: '352 E Main St, Rockaway, NJ 07866',
            phone: '+1 973-000-0000',
            website: 'https://example.com',
            rating: '4.8',
            latitude: '40.9001',
            longitude: '-74.5143',
            state: 'NJ',
            city: 'Rockaway',
            survey_count: '21',
            avg_emi_pct: '95.2',
            match_status: 'invoiced_city_state',
          }, {
            layer: 'directory_shop',
            id: 'competitor-1',
            shop_name: 'Rockaway Express Auto Body',
            latitude: '40.901',
            longitude: '-74.515',
            state: 'NJ',
          }],
        },
      }],
      error: null,
    })

    const { getMarketMapData } = await import('@/lib/supabase/data')
    const result = await getMarketMapData('NJ', 40000)

    expect(mockRpc).toHaveBeenCalledWith('market_map_payload', {
      p_state: 'NJ',
      p_directory_limit: 40000,
    })
    expect(result.summary).toEqual({
      psg_customers: 1,
      directory_shops: 1,
      surveyed_psg_customers: 1,
      states: ['NJ'],
    })
    expect(result.points[0]).toMatchObject({
      layer: 'psg_customer',
      shop_name: 'D&M Auto Body',
      invoiced_id: 1469644,
      rating: 4.8,
      survey_count: 21,
      avg_emi_pct: 95.2,
    })
  })

  it('getMarketViewportIntelligence maps map-bounds demand context', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{
        viewport_label: 'Metro view',
        zoom: '7.4',
        psg_customer_count: '5',
        directory_shop_count: '125',
        surveyed_psg_customer_count: '2',
        crash_count: '3120',
        injury_crash_count: '410',
        weather_related_crash_count: '355',
        storm_event_count: '19',
        hail_event_count: '4',
        wind_event_count: '8',
        storm_demand_score: '84.5',
        top_zips: [{
          zip: '60639',
          state: 'IL',
          city: 'Chicago',
          year: '2025',
          total_crashes: '3733',
          injury_crashes: '563',
          weather_related_crashes: '353',
          storm_events: '0',
          hail_events: '0',
          wind_events: '0',
          storm_demand_score: '0',
          targeting_score: '5607',
        }],
        top_customers: [{
          shop_name: 'Example Collision',
          psg_id: 'PS123',
          city: 'Chicago',
          state: 'IL',
          survey_count: '12',
          avg_emi_pct: '94.2',
        }],
      }],
      error: null,
    })

    const { getMarketViewportIntelligence } = await import('@/lib/supabase/data')
    const result = await getMarketViewportIntelligence({
      west: -88,
      south: 41,
      east: -87,
      north: 42,
      zoom: 7.4,
      resultLimit: 8,
    })

    expect(mockRpc).toHaveBeenCalledWith('market_viewport_intelligence', {
      p_west: -88,
      p_south: 41,
      p_east: -87,
      p_north: 42,
      p_zoom: 7.4,
      result_limit: 8,
    })
    expect(result.crash_count).toBe(3120)
    expect(result.top_zips[0]).toMatchObject({
      zip: '60639',
      total_crashes: 3733,
      targeting_score: 5607,
    })
    expect(result.top_customers[0]).toMatchObject({
      shop_name: 'Example Collision',
      survey_count: 12,
      avg_emi_pct: 94.2,
    })
  })

  it('propagates RPC errors with the function name', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    })

    const { getNetworkTrend } = await import('@/lib/supabase/data')

    await expect(getNetworkTrend(24)).rejects.toThrow('network_trend: permission denied')
  })
})
