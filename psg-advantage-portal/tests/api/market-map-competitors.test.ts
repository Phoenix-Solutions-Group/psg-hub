import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getShopCompetitorOverlay: vi.fn(),
  getShopCompetitorOverlayByPlaceId: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import {
  getShopCompetitorOverlay,
  getShopCompetitorOverlayByPlaceId,
} from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/market-map/competitors/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }

const competitors = [
  {
    is_anchor: true,
    shop_name: 'Rockaway Express Auto Body',
    place_id: 'place-2',
    address: '7 E New St, Rockaway, NJ 07866',
    phone: '+1 201-874-7953',
    website: 'https://example.com',
    rating: 4.6,
    category: 'Auto body shop',
    latitude: 40.901,
    longitude: -74.515,
    distance_miles: 0,
  },
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/market-map/competitors')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/market-map/competitors', () => {
  it('rejects requests without a place ID or shop name', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )

    const res = await GET(makeRequest())

    expect(res.status).toBe(400)
    expect(getShopCompetitorOverlay).not.toHaveBeenCalled()
    expect(getShopCompetitorOverlayByPlaceId).not.toHaveBeenCalled()
  })

  it('uses place-id competitors when a place ID is available', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getShopCompetitorOverlayByPlaceId).mockResolvedValue(competitors)

    const res = await GET(makeRequest({ placeId: 'place-2', radiusMiles: '25', limit: '25' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(competitors)
    expect(getShopCompetitorOverlayByPlaceId).toHaveBeenCalledWith('place-2', 25, 25)
    expect(getShopCompetitorOverlay).not.toHaveBeenCalled()
    expect(setCached).toHaveBeenCalledWith(
      'market-map:competitors:v1:place:place-2:25:25',
      competitors,
      86400
    )
  })

  it('falls back to shop-name competitors when no place ID exists', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getShopCompetitorOverlay).mockResolvedValue(competitors)

    const res = await GET(makeRequest({ shopName: 'D&M Auto Body', radiusMiles: '15', limit: '10' }))

    expect(res.status).toBe(200)
    expect(getShopCompetitorOverlay).toHaveBeenCalledWith('D&M Auto Body', 15, 10)
  })
})
