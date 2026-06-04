import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createMockSupabase } from '../helpers/mock-supabase'

const mockComments = [
  {
    survey_date: '2026-02-15',
    comment_text: 'Great service, very professional',
    scale_emi_pct: 96.0,
  },
  {
    survey_date: '2026-02-10',
    comment_text: 'Could improve communication',
    scale_emi_pct: 82.0,
  },
]

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/data', () => ({
  getPaginatedShopComments: vi.fn(),
}))

vi.mock('@/lib/cache', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '@/app/api/shops/[shopName]/comments/route'
import { createClient } from '@/lib/supabase/server'
import { getPaginatedShopComments } from '@/lib/supabase/data'
import { setCached } from '@/lib/cache'

function makeRequest(shopName: string, queryString = '') {
  return new NextRequest(
    new URL(
      `http://localhost:3001/api/shops/${encodeURIComponent(shopName)}/comments${queryString}`
    )
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

describe('Shop comments API (SHOP-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns paginated results with correct page/total', async () => {
    setupAdmin()
    vi.mocked(getPaginatedShopComments).mockResolvedValue({
      comments: mockComments,
      total: 42,
      page: 2,
      pageSize: 20,
      totalPages: 3,
    })

    const response = await GET(
      makeRequest('Acme Auto Body', '?page=2&pageSize=20'),
      makeParams('Acme Auto Body')
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.comments).toHaveLength(2)
    expect(body.total).toBe(42)
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(20)
    expect(body.totalPages).toBe(3) // ceil(42/20)
  })

  it('search parameter filters comments', async () => {
    setupAdmin()
    vi.mocked(getPaginatedShopComments).mockResolvedValue({
      comments: [mockComments[1]],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })

    const response = await GET(
      makeRequest('Acme Auto Body', '?search=communication'),
      makeParams('Acme Auto Body')
    )
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.comments).toHaveLength(1)
    expect(body.total).toBe(1)

    expect(getPaginatedShopComments).toHaveBeenCalledWith(
      'Acme Auto Body',
      'communication',
      1,
      20
    )
  })

  it('does NOT use cache (verify setCached not called)', async () => {
    setupAdmin()
    vi.mocked(getPaginatedShopComments).mockResolvedValue({
      comments: mockComments,
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    })

    await GET(makeRequest('Acme Auto Body'), makeParams('Acme Auto Body'))

    expect(setCached).not.toHaveBeenCalled()
  })
})
