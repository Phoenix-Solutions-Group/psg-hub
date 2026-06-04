import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  searchMarketMapShops: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { searchMarketMapShops } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/market-map/search/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'Other Shop', role: 'shop_owner', email: 'shop@psg.com' }

const searchRows = [
  {
    layer: 'psg_customer' as const,
    id: 'PS687',
    shop_name: 'D&M Auto Body',
    psg_id: 'PS687',
    invoiced_id: 1469644,
    place_id: 'place-1',
    address: '352 E Main St, Rockaway, NJ 07866',
    phone: '+1 973-000-0000',
    website: 'https://example.com',
    rating: 4.8,
    latitude: 40.9001,
    longitude: -74.5143,
    state: 'NJ',
    city: 'Rockaway',
    survey_count: 21,
    avg_emi_pct: 95.2,
    match_status: 'invoiced_city_state',
  },
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/market-map/search')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/market-map/search', () => {
  it('requires admin access', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: shopUser, profile: shopProfile }) as never
    )

    const res = await GET(makeRequest({ q: 'D&M' }))

    expect(res.status).toBe(403)
    expect(searchMarketMapShops).not.toHaveBeenCalled()
  })

  it('returns an empty array for short queries before searching', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )

    const res = await GET(makeRequest({ q: 'D' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual([])
    expect(searchMarketMapShops).not.toHaveBeenCalled()
  })

  it('searches mapped shops and caches results', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(searchMarketMapShops).mockResolvedValue(searchRows)

    const res = await GET(makeRequest({ q: ' D&M Auto ', limit: '18' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(searchRows)
    expect(searchMarketMapShops).toHaveBeenCalledWith('D&M Auto', 18)
    expect(setCached).toHaveBeenCalledWith(
      'market-map:search:v1:d&m auto:18',
      searchRows,
      300
    )
  })
})
