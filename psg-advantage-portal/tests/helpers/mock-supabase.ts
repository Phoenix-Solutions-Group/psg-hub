import { vi } from 'vitest'

interface MockSupabaseOptions {
  user?: { id: string; email: string }
  profile?: { shop_id: string; role: string; email: string }
  authError?: boolean
}

/**
 * Create a mock Supabase client for API route tests.
 * Mocks auth.getUser() and from('portal_users').select().eq().single() chain.
 */
export function createMockSupabase(options: MockSupabaseOptions = {}) {
  const { user, profile, authError } = options

  const singleFn = vi.fn().mockResolvedValue({
    data: profile || null,
    error: profile ? null : { message: 'Not found' },
  })

  const eqFn = vi.fn().mockReturnValue({ single: singleFn })

  const selectFn = vi.fn().mockReturnValue({ eq: eqFn })

  const fromFn = vi.fn().mockReturnValue({ select: selectFn })

  const getUserFn = vi.fn().mockResolvedValue({
    data: {
      user: authError ? null : user || null,
    },
    error: authError ? { message: 'Auth error' } : null,
  })

  return {
    auth: {
      getUser: getUserFn,
    },
    from: fromFn,
    // Expose individual mocks for assertion
    _mocks: {
      getUser: getUserFn,
      from: fromFn,
      select: selectFn,
      eq: eqFn,
      single: singleFn,
    },
  }
}
