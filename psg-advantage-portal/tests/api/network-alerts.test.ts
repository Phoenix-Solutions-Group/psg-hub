import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/data', () => ({
  getNetworkAlerts: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getNetworkAlerts } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'
import { GET } from '@/app/api/network/alerts/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'shop-1', role: 'shop_owner', email: 'shop@psg.com' }

const mockAlerts = [
  { shop_name: 'Bad Shop', avg_emi_pct: 82.1, total_surveys: 30, months_below: 3 },
  { shop_name: 'Worse Shop', avg_emi_pct: 78.5, total_surveys: 25, months_below: 3 },
]

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/network/alerts')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('GET /api/network/alerts', () => {
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

  it('returns 200 with AlertShop[] for admin', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkAlerts).mockResolvedValue(mockAlerts)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toHaveProperty('shop_name')
    expect(body[0]).toHaveProperty('avg_emi_pct')
    expect(body[0]).toHaveProperty('months_below')
  })

  it('uses cache when available', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCached).mockResolvedValue(mockAlerts)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    expect(getNetworkAlerts).not.toHaveBeenCalled()
  })

  it('uses default threshold 88 and months 3', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkAlerts).mockResolvedValue(mockAlerts)

    await GET(makeRequest())
    expect(setCached).toHaveBeenCalledWith('network:alerts:88:3', mockAlerts, 86400)
  })

  it('accepts custom threshold and months', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getNetworkAlerts).mockResolvedValue([])

    await GET(makeRequest({ threshold: '90', months: '6' }))
    expect(setCached).toHaveBeenCalledWith('network:alerts:90:6', [], 86400)
  })
})
