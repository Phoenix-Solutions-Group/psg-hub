import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getNetworkTrend: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getNetworkTrend } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/network/trend/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'shop-1', role: 'shop_owner', email: 'shop@psg.com' }

const mockTrend = [
  { month: '2025-01', surveys: 50, avg_emi_pct: 91.2 },
  { month: '2025-02', surveys: 48, avg_emi_pct: 92.1 },
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/network/trend')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/network/trend', () => {
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

  it('returns 200 with TrendPoint[] for admin', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkTrend).mockResolvedValue(mockTrend)

    const res = await GET(makeRequest({ months: '24' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toHaveProperty('month')
    expect(body[0]).toHaveProperty('surveys')
    expect(body[0]).toHaveProperty('avg_emi_pct')
  })

  it('uses cache when available', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCached).mockResolvedValue(mockTrend)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(getNetworkTrend).not.toHaveBeenCalled()
  })

  it('defaults to 24 months', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkTrend).mockResolvedValue(mockTrend)

    await GET(makeRequest())
    expect(setCached).toHaveBeenCalledWith('network:trend:24', mockTrend, 86400)
  })
})
