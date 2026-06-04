import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'
import { marketDashboardFallbackData } from '@/lib/marketDashboardFallback'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getMarketDashboardData: vi.fn(),
}))
vi.mock('@/lib/postgres/marketDashboard', () => ({
  getMarketDashboardDataFromPostgres: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getMarketDashboardData } from '@/lib/supabase/data'
import { getMarketDashboardDataFromPostgres } from '@/lib/postgres/marketDashboard'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/markets/dashboard/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'shop-1', role: 'shop_owner', email: 'shop@psg.com' }

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/markets/dashboard')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
  vi.mocked(getMarketDashboardDataFromPostgres).mockResolvedValue(null)
})

describe('GET /api/markets/dashboard', () => {
  it('requires admin access', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: shopUser, profile: shopProfile }) as never
    )

    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('rejects invalid market filters before querying', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )

    const res = await GET(makeRequest({ city: 'Miami', state: 'Florida' }))
    expect(res.status).toBe(400)
    expect(getMarketDashboardDataFromPostgres).not.toHaveBeenCalled()
    expect(getMarketDashboardData).not.toHaveBeenCalled()
  })

  it('normalizes filters and uses the Supabase data wrapper', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getMarketDashboardData).mockResolvedValue(marketDashboardFallbackData)

    const res = await GET(makeRequest({ city: '  Los   Angeles ', state: ' ca ' }))
    expect(res.status).toBe(200)
    expect(getMarketDashboardData).toHaveBeenCalledWith('Los Angeles', 'CA')
    expect(setCached).toHaveBeenCalledWith(
      'market-dashboard:los angeles:CA',
      marketDashboardFallbackData,
      3600
    )
  })
})
