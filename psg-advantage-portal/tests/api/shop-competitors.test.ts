import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getShopCompetitorOverlay: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getShopCompetitorOverlay } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/shops/[shopName]/competitors/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'Other Shop', role: 'shop_owner', email: 'shop@psg.com' }

const competitors = [
  {
    is_anchor: true,
    shop_name: 'D&M Auto Body',
    place_id: 'anchor',
    address: '352 E Main St',
    phone: null,
    website: null,
    rating: 4.9,
    category: 'Auto body shop',
    latitude: 40.9,
    longitude: -74.5,
    distance_miles: 0,
  },
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/shops/D%26M%20Auto%20Body/competitors')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/shops/[shopName]/competitors', () => {
  it('requires access to the shop', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: shopUser, profile: shopProfile }) as never
    )

    const res = await GET(makeRequest(), { params: Promise.resolve({ shopName: 'D%26M%20Auto%20Body' }) })

    expect(res.status).toBe(403)
    expect(getShopCompetitorOverlay).not.toHaveBeenCalled()
  })

  it('returns and caches competitor overlay rows for admins', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getShopCompetitorOverlay).mockResolvedValue(competitors)

    const res = await GET(makeRequest({ radiusMiles: '25', limit: '25' }), {
      params: Promise.resolve({ shopName: 'D%26M%20Auto%20Body' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(competitors)
    expect(getShopCompetitorOverlay).toHaveBeenCalledWith('D&M Auto Body', 25, 25)
    expect(setCached).toHaveBeenCalledWith(
      'shop:competitors:v3:D&M Auto Body:25:25',
      competitors,
      86400
    )
  })
})
