import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

// Mock modules before importing route handlers
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/data', () => ({
  getShopDetail: vi.fn().mockResolvedValue({
    shop_name: 'Acme Auto Body',
    avg_emi_pct: 92.5,
    total_surveys: 45,
    avg_quality: 94.1,
    avg_cleanliness: 91.3,
    avg_communication: 88.7,
    avg_courtesy: 93.2,
    network_avg_communication: 90.0,
  }),
}))

vi.mock('@/lib/cache', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '@/app/api/shops/[shopName]/route'
import { createClient } from '@/lib/supabase/server'

function makeRequest(shopName: string) {
  return new NextRequest(
    new URL(`http://localhost:3001/api/shops/${encodeURIComponent(shopName)}`)
  )
}

function makeParams(shopName: string) {
  return { params: Promise.resolve({ shopName: encodeURIComponent(shopName) }) }
}

describe('Shop API access control (AUTH-05, AUTH-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 when shop_owner accesses own shop', async () => {
    const mock = createMockSupabase({
      user: { id: 'user-1', email: 'owner@shop.com' },
      profile: { shop_id: 'Acme Auto Body', role: 'shop_owner', email: 'owner@shop.com' },
    })
    vi.mocked(createClient).mockResolvedValue(mock as never)

    const response = await GET(makeRequest('Acme Auto Body'), makeParams('Acme Auto Body'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.shop_name).toBe('Acme Auto Body')
  })

  it('returns 403 when shop_owner accesses different shop', async () => {
    const mock = createMockSupabase({
      user: { id: 'user-1', email: 'owner@shop.com' },
      profile: { shop_id: 'Acme Auto Body', role: 'shop_owner', email: 'owner@shop.com' },
    })
    vi.mocked(createClient).mockResolvedValue(mock as never)

    const response = await GET(makeRequest('Other Body Shop'), makeParams('Other Body Shop'))
    expect(response.status).toBe(403)

    const body = await response.json()
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('returns 200 when psg_admin accesses any shop', async () => {
    const mock = createMockSupabase({
      user: { id: 'admin-1', email: 'admin@psg.com' },
      profile: { shop_id: 'PSG HQ', role: 'psg_admin', email: 'admin@psg.com' },
    })
    vi.mocked(createClient).mockResolvedValue(mock as never)

    const response = await GET(makeRequest('Acme Auto Body'), makeParams('Acme Auto Body'))
    expect(response.status).toBe(200)
  })

  it('returns 401 when unauthenticated', async () => {
    const mock = createMockSupabase({ authError: true })
    vi.mocked(createClient).mockResolvedValue(mock as never)

    const response = await GET(makeRequest('Acme Auto Body'), makeParams('Acme Auto Body'))
    expect(response.status).toBe(401)

    const body = await response.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })
})
