import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

const mockDetailRow = {
  shop_name: 'Acme Auto Body',
  avg_emi_pct: 92.5,
  total_surveys: 45,
  avg_quality: 94.1,
  avg_cleanliness: 91.3,
  avg_communication: 88.7,
  avg_courtesy: 93.2,
  network_avg_communication: 90.0,
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/data', () => ({
  getShopDetail: vi.fn(),
}))

vi.mock('@/lib/cache', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '@/app/api/shops/[shopName]/route'
import { createClient } from '@/lib/supabase/server'
import { getShopDetail } from '@/lib/supabase/data'
import { getCached, setCached } from '@/lib/cache'

function makeRequest(shopName: string) {
  return new NextRequest(
    new URL(`http://localhost:3001/api/shops/${encodeURIComponent(shopName)}`)
  )
}

function makeParams(shopName: string) {
  return { params: Promise.resolve({ shopName: encodeURIComponent(shopName) }) }
}

function setupAdmin() {
  const mock = createMockSupabase({
    user: { id: 'admin-1', email: 'admin@psg.com' },
    profile: { shop_id: 'PSG HQ', role: 'psg_admin', email: 'admin@psg.com' },
  })
  vi.mocked(createClient).mockResolvedValue(mock as never)
}

describe('Shop detail API (SHOP-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ShopDetail with correct fields', async () => {
    setupAdmin()
    vi.mocked(getShopDetail).mockResolvedValue(mockDetailRow)

    const response = await GET(makeRequest('Acme Auto Body'), makeParams('Acme Auto Body'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.shop_name).toBe('Acme Auto Body')
    expect(body.avg_emi_pct).toBe(92.5)
    expect(body.total_surveys).toBe(45)
    expect(body.avg_quality).toBe(94.1)
    expect(body.avg_communication).toBe(88.7)
    expect(body.network_avg_communication).toBe(90.0)
    expect(body.trend).toBeDefined()
    expect(body.emi_delta).toBeDefined()
  })

  it('returns 404 for non-existent shop', async () => {
    setupAdmin()
    vi.mocked(getShopDetail).mockResolvedValue(null)

    const response = await GET(makeRequest('NonExistent Shop'), makeParams('NonExistent Shop'))
    expect(response.status).toBe(404)

    const body = await response.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('uses cache when available', async () => {
    setupAdmin()
    const cachedDetail = { ...mockDetailRow, trend: 'stable', emi_delta: 0 }
    vi.mocked(getCached).mockResolvedValue(cachedDetail)

    const response = await GET(makeRequest('Acme Auto Body'), makeParams('Acme Auto Body'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.shop_name).toBe('Acme Auto Body')
    expect(getShopDetail).not.toHaveBeenCalled()
    expect(setCached).not.toHaveBeenCalled()
  })
})
