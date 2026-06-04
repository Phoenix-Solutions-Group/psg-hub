import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/cache', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
}))
vi.mock('@/lib/customerGeographyData', () => ({
  getCustomerGeoPins: vi.fn(),
  getCustomerGeoShops: vi.fn(),
  getCustomerGeoZipIncome: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { getCached, setCached } from '@/lib/cache'
import {
  getCustomerGeoPins,
  getCustomerGeoShops,
  getCustomerGeoZipIncome,
} from '@/lib/customerGeographyData'
import { GET as getPins } from '@/app/api/customer-geography/pins/route'
import { GET as getZipIncome } from '@/app/api/customer-geography/zip-income/route'
import { GET as getShops } from '@/app/api/customer-geography/shops/route'

const adminUser = { id: 'u1', email: 'admin@psg.com' }
const adminProfile = { shop_id: '', role: 'psg_admin', email: 'admin@psg.com' }
const shopUser = { id: 'u2', email: 'shop@psg.com' }
const shopProfile = { shop_id: 'Shop 1', role: 'shop_owner', email: 'shop@psg.com' }

function makeRequest(path: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCached).mockResolvedValue(null)
  vi.mocked(setCached).mockResolvedValue(undefined)
})

describe('Customer geography APIs', () => {
  it('requires admin role for pins', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: shopUser, profile: shopProfile }) as never
    )
    const response = await getPins(makeRequest('/api/customer-geography/pins'))
    expect(response.status).toBe(403)
  })

  it('returns pin payload', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCustomerGeoPins).mockResolvedValue([
      {
        zip: '10001',
        city: 'New York',
        state: 'NY',
        county_name: 'New York',
        latitude: 40.75,
        longitude: -73.99,
        repair_count: 22,
        unique_household_count: 18,
        shop_count: 3,
      },
    ])

    const response = await getPins(
      makeRequest('/api/customer-geography/pins', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        preset: 'nyc_nassau_suffolk',
      })
    )
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.summary.pin_count).toBe(1)
    expect(getCustomerGeoPins).toHaveBeenCalled()
  })

  it('returns 500 when pin data source errors', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCustomerGeoPins).mockRejectedValue(new Error('relation does not exist'))

    const response = await getPins(
      makeRequest('/api/customer-geography/pins', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        preset: 'all',
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error.code).toBe('INTERNAL_ERROR')
  })

  it('returns zip income payload', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCustomerGeoZipIncome).mockResolvedValue([
      {
        zip: '10001',
        state: 'NY',
        county_name: 'New York',
        repair_count: 12,
        unique_household_count: 11,
        market_households: 100,
        service_address_penetration_pct: 11,
        mean_household_income: 142000,
        median_household_income: 121000,
        avg_repair_total: 3500,
        total_repair_value: 42000,
      },
    ])

    const response = await getZipIncome(
      makeRequest('/api/customer-geography/zip-income', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      })
    )
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.summary.zip_count).toBe(1)
    expect(payload.summary.total_service_addresses).toBe(11)
    expect(payload.summary.total_market_households).toBe(100)
    expect(payload.summary.service_address_penetration_pct).toBe(11)
    expect(getCustomerGeoZipIncome).toHaveBeenCalled()
  })

  it('returns shop options', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCustomerGeoShops).mockResolvedValue([
      { shop_id: 'SHOP_1', shop_name: 'Shop 1', repair_count: 1234 },
    ])

    const response = await getShops(
      makeRequest('/api/customer-geography/shops', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        preset: 'nyc5',
      })
    )
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toHaveLength(1)
    expect(getCustomerGeoShops).toHaveBeenCalledWith('2024-01-01', '2024-12-31', 'nyc5')
  })

  it('returns 500 when zip income data source errors', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCustomerGeoZipIncome).mockRejectedValue(new Error('db timeout'))

    const response = await getZipIncome(
      makeRequest('/api/customer-geography/zip-income', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error.code).toBe('INTERNAL_ERROR')
  })

  it('returns 500 when shops data source errors', async () => {
    vi.mocked(createClient).mockResolvedValue(
      createMockSupabase({ user: adminUser, profile: adminProfile }) as never
    )
    vi.mocked(getCustomerGeoShops).mockRejectedValue(new Error('db timeout'))

    const response = await getShops(
      makeRequest('/api/customer-geography/shops', {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        preset: 'nyc_nassau_suffolk',
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.error.code).toBe('INTERNAL_ERROR')
  })
})
