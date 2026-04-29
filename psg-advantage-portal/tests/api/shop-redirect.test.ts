import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// We test the middleware redirect logic by importing the middleware function
// and mocking Supabase auth + portal_users query

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3001${path}`))
}

function createMockSupabaseMiddleware(options: {
  user?: { id: string; email: string }
  profile?: { role: string; shop_id: string }
}) {
  const { user, profile } = options

  const singleFn = vi.fn().mockResolvedValue({
    data: profile || null,
    error: profile ? null : { message: 'Not found' },
  })
  const eqFn = vi.fn().mockReturnValue({ single: singleFn })
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn })
  const fromFn = vi.fn().mockReturnValue({ select: selectFn })

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: user || null },
        error: user ? null : { message: 'No user' },
      }),
    },
    from: fromFn,
    _mocks: { from: fromFn, select: selectFn, eq: eqFn, single: singleFn },
  }
}

describe('Middleware shop owner redirect (SHOP-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('redirects shop_owner from / to their shop page', async () => {
    const mock = createMockSupabaseMiddleware({
      user: { id: 'user-1', email: 'owner@shop.com' },
      profile: { role: 'shop_owner', shop_id: 'Acme Auto Body' },
    })
    vi.mocked(createServerClient).mockReturnValue(mock as never)

    const { middleware } = await import('../../middleware')
    const request = makeRequest('/')
    const response = await middleware(request)

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('/shops/Acme%20Auto%20Body')
  })

  it('does NOT redirect psg_admin from /', async () => {
    const mock = createMockSupabaseMiddleware({
      user: { id: 'admin-1', email: 'admin@psg.com' },
      profile: { role: 'psg_admin', shop_id: 'PSG HQ' },
    })
    vi.mocked(createServerClient).mockReturnValue(mock as never)

    const { middleware } = await import('../../middleware')
    const request = makeRequest('/')
    const response = await middleware(request)

    // Should NOT be a redirect
    expect(response.status).toBe(200)
  })

  it('redirects shop_owner from /shops to their shop page', async () => {
    const mock = createMockSupabaseMiddleware({
      user: { id: 'user-1', email: 'owner@shop.com' },
      profile: { role: 'shop_owner', shop_id: 'Best Body Shop' },
    })
    vi.mocked(createServerClient).mockReturnValue(mock as never)

    const { middleware } = await import('../../middleware')
    const request = makeRequest('/shops')
    const response = await middleware(request)

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('/shops/Best%20Body%20Shop')
  })
})
