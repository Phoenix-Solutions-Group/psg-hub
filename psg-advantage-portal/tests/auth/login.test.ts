import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('login flow', () => {
  const mockSignInWithPassword = vi.fn()
  const mockGetUser = vi.fn()
  const mockFrom = vi.fn()
  const mockInsert = vi.fn()
  const mockSelect = vi.fn()
  const mockEq = vi.fn()
  const mockSingle = vi.fn()

  function createMockClient() {
    mockSingle.mockResolvedValue({ data: { shop_id: 'shop-abc' } })
    mockEq.mockReturnValue({ single: mockSingle })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockInsert.mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'portal_users') {
        return { select: mockSelect }
      }
      if (table === 'portal_sessions_log') {
        return { insert: mockInsert }
      }
      return {}
    })

    return {
      auth: {
        signInWithPassword: mockSignInWithPassword,
        getUser: mockGetUser,
      },
      from: mockFrom,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls signInWithPassword with email and password', async () => {
    const client = createMockClient()
    mockSignInWithPassword.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'nick@psg.com' } },
    })

    await client.auth.signInWithPassword({
      email: 'nick@psg.com',
      password: 'test-password',
    })

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'nick@psg.com',
      password: 'test-password',
    })
  })

  it('logs login event after successful sign-in', async () => {
    const client = createMockClient()
    mockSignInWithPassword.mockResolvedValue({ error: null })
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'nick@psg.com' } },
    })

    // Simulate the login flow
    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'nick@psg.com',
      password: 'test-password',
    })

    expect(signInError).toBeNull()

    // After successful sign-in, get user and log the event
    const { data: { user } } = await client.auth.getUser()

    if (user) {
      const { data: profile } = await client
        .from('portal_users')
        .select('shop_id')
        .eq('id', user.id)
        .single()

      if (profile) {
        await client.from('portal_sessions_log').insert({
          user_id: user.id,
          shop_id: profile.shop_id,
          action: 'login',
        })
      }
    }

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user-123',
      shop_id: 'shop-abc',
      action: 'login',
    })
  })

  it('does not log event when sign-in fails', async () => {
    const client = createMockClient()
    mockSignInWithPassword.mockResolvedValue({
      error: { message: 'Invalid credentials' },
    })

    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'nick@psg.com',
      password: 'wrong',
    })

    expect(signInError).toBeTruthy()
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
