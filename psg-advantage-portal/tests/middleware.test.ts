import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Mock NextResponse and NextRequest
const mockRedirect = vi.fn((url: URL) => ({
  type: 'redirect',
  url: url.toString(),
}))

const mockNext = vi.fn(() => ({
  type: 'next',
  cookies: {
    set: vi.fn(),
  },
}))

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: URL) => mockRedirect(url),
    next: () => mockNext(),
  },
}))

// Mock createServerClient
const mockGetUser = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}))

function createMockRequest(pathname: string) {
  const url = new URL(`http://localhost:3001${pathname}`)
  return {
    nextUrl: {
      pathname,
      clone: () => new URL(url),
    },
    cookies: {
      getAll: () => [],
      set: vi.fn(),
    },
  }
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set env vars for createServerClient
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  it('redirects to /login when no user and path is /', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { middleware } = await import('../middleware')
    const request = createMockRequest('/')

    await middleware(request as NextRequest)

    expect(mockRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/login',
      })
    )
  })

  it('redirects to / when user exists and path is /login', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@test.com' } },
    })

    // Re-import to get fresh module
    vi.resetModules()

    // Re-setup mocks after resetModules
    vi.doMock('next/server', () => ({
      NextResponse: {
        redirect: (url: URL) => mockRedirect(url),
        next: () => mockNext(),
      },
    }))

    const mockGetUser2 = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@test.com' } },
    })
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: vi.fn(() => ({
        auth: { getUser: mockGetUser2 },
      })),
    }))

    const { middleware } = await import('../middleware')
    const request = createMockRequest('/login')

    await middleware(request as NextRequest)

    expect(mockRedirect).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/',
      })
    )
  })

  it('allows through when no user and path is /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    vi.resetModules()
    vi.doMock('next/server', () => ({
      NextResponse: {
        redirect: (url: URL) => mockRedirect(url),
        next: () => mockNext(),
      },
    }))

    const mockGetUser3 = vi.fn().mockResolvedValue({ data: { user: null } })
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: vi.fn(() => ({
        auth: { getUser: mockGetUser3 },
      })),
    }))

    const { middleware } = await import('../middleware')
    const request = createMockRequest('/login')

    const result = await middleware(request as NextRequest)

    expect(result).toHaveProperty('type', 'next')
  })

  it('allows through when user exists and path is /', async () => {
    vi.resetModules()
    vi.doMock('next/server', () => ({
      NextResponse: {
        redirect: (url: URL) => mockRedirect(url),
        next: () => mockNext(),
      },
    }))

    const mockGetUser4 = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@test.com' } },
    })
    // / is a ROLE_CHECK_PATH, so middleware queries portal_users for role
    const mockSingle = vi.fn().mockResolvedValue({
      data: { role: 'psg_admin', shop_id: 'PSG HQ' },
      error: null,
    })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })
    vi.doMock('@supabase/ssr', () => ({
      createServerClient: vi.fn(() => ({
        auth: { getUser: mockGetUser4 },
        from: mockFrom,
      })),
    }))

    const { middleware } = await import('../middleware')
    const request = createMockRequest('/')

    const result = await middleware(request as NextRequest)

    expect(result).toHaveProperty('type', 'next')
  })
})
