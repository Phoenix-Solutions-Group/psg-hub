import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getNetworkSummary: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getNetworkSummary } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/network/summary/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'shop-1', role: 'shop_owner', email: 'shop@psg.com' }

const mockSummary = {
  total_surveys: 1200,
  avg_emi_pct: 92.4,
  active_shops: 15,
  alert_count: 3,
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/network/summary')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/network/summary', () => {
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

  it('returns 200 with NetworkSummary for admin', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkSummary).mockResolvedValue(mockSummary)

    const res = await GET(makeRequest({ startDate: '2025-01-01', endDate: '2025-03-31' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(mockSummary)
    expect(body.total_surveys).toBe(1200)
    expect(body.avg_emi_pct).toBe(92.4)
  })

  it('uses cache when available', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCached).mockResolvedValue(mockSummary)

    const res = await GET(makeRequest({ startDate: '2025-01-01', endDate: '2025-03-31' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(mockSummary)
    expect(getNetworkSummary).not.toHaveBeenCalled()
  })

  it('caches result on cache miss', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkSummary).mockResolvedValue(mockSummary)

    await GET(makeRequest({ startDate: '2025-01-01', endDate: '2025-03-31' }))
    expect(setCached).toHaveBeenCalledWith(
      'network:summary:2025-01-01:2025-03-31',
      mockSummary,
      86400
    )
  })
})
