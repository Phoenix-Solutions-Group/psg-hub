import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getShopList: vi.fn(),
}))
vi.mock('@/lib/postgres/shops', () => ({
  getShopListFromPostgres: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getShopList } from '@/lib/supabase/data'
import { getShopListFromPostgres } from '@/lib/postgres/shops'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/shops/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'shop-1', role: 'shop_owner', email: 'shop@psg.com' }

const mockShops = [
  {
    shop_name: 'Best Shop',
    total_surveys: 100,
    avg_emi_pct: 96.2,
    trend: 'improving' as const,
    emi_delta: 2.1,
    latest_survey_date: '2025-03-01',
  },
  {
    shop_name: 'OK Shop',
    total_surveys: 80,
    avg_emi_pct: 90.5,
    trend: 'stable' as const,
    emi_delta: 0.3,
    latest_survey_date: '2025-02-28',
  },
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/shops')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
  vi.mocked(getShopListFromPostgres).mockResolvedValue(null)
})

describe('GET /api/shops', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(createClient).mockResolvedValue(createMockSupabase({ authError: true }) as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 403 when non-admin accesses', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: shopUser, profile: shopProfile }) as never
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 200 with ShopListItem[] for admin', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getShopList).mockResolvedValue(mockShops)

    const res = await GET(makeRequest({ startDate: '2025-01-01', endDate: '2025-03-31' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toHaveProperty('shop_name')
    expect(body[0]).toHaveProperty('avg_emi_pct')
    expect(body[0]).toHaveProperty('latest_survey_date')
  })

  it('returns 400 for malformed date ranges', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )

    const res = await GET(makeRequest({ startDate: '2025-04-01', endDate: '2025-03-31' }))
    expect(res.status).toBe(400)
    expect(getShopList).not.toHaveBeenCalled()
  })

  it('uses cache when available', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCached).mockResolvedValue(mockShops)

    const res = await GET(makeRequest({ startDate: '2025-01-01', endDate: '2025-03-31' }))
    expect(res.status).toBe(200)
    expect(getShopList).not.toHaveBeenCalled()
  })

  it('caches result with date range key', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getShopList).mockResolvedValue(mockShops)

    await GET(makeRequest({ startDate: '2025-01-01', endDate: '2025-03-31' }))
    expect(setCached).toHaveBeenCalledWith(
      'shops:list:v4:2025-01-01:2025-03-31',
      mockShops,
      86400
    )
  })
})
