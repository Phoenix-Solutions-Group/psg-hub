import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getMarketViewportIntelligence: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getMarketViewportIntelligence } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/market-map/intelligence/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/market-map/intelligence')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/market-map/intelligence', () => {
  it('rejects invalid map bounds before querying', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )

    const res = await GET(makeRequest({ west: '-88', south: '42', east: '-87', north: '41', zoom: '7' }))

    expect(res.status).toBe(400)
    expect(getMarketViewportIntelligence).not.toHaveBeenCalled()
  })

  it('returns viewport intelligence for admin map bounds', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getMarketViewportIntelligence).mockResolvedValue({
      viewport_label: 'Metro view',
      zoom: 7,
      psg_customer_count: 3,
      directory_shop_count: 42,
      surveyed_psg_customer_count: 1,
      crash_count: 500,
      injury_crash_count: 80,
      weather_related_crash_count: 60,
      storm_event_count: 4,
      hail_event_count: 1,
      wind_event_count: 2,
      storm_demand_score: 18,
      top_zips: [],
      top_customers: [],
    })

    const res = await GET(makeRequest({ west: '-88', south: '41', east: '-87', north: '42', zoom: '7' }))

    expect(res.status).toBe(200)
    expect(getMarketViewportIntelligence).toHaveBeenCalledWith({
      west: -88,
      south: 41,
      east: -87,
      north: 42,
      zoom: 7,
      resultLimit: 8,
    })
    expect(setCached).toHaveBeenCalled()
  })
})
