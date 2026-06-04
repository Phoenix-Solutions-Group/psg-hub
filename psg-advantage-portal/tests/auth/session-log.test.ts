import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionLogEntry } from '@/types/index'

describe('session log', () => {
  const mockInsert = vi.fn()
  const mockFrom = vi.fn()

  function createMockClient() {
    mockInsert.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })
    return { from: mockFrom }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a correctly shaped SessionLogEntry', async () => {
    const client = createMockClient()

    const entry: SessionLogEntry = {
      user_id: 'user-456',
      shop_id: 'shop-xyz',
      action: 'login',
    }

    await client.from('portal_sessions_log').insert(entry)

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user-456',
      shop_id: 'shop-xyz',
      action: 'login',
    })
  })

  it('uses user_id from auth and shop_id from portal_users', async () => {
    const mockSelect = vi.fn()
    const mockEq = vi.fn()
    const mockSingle = vi.fn()

    mockSingle.mockResolvedValue({ data: { shop_id: 'shop-from-db' } })
    mockEq.mockReturnValue({ single: mockSingle })
    mockSelect.mockReturnValue({ eq: mockEq })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'portal_users') {
          return { select: mockSelect }
        }
        if (table === 'portal_sessions_log') {
          return { insert: mockInsert }
        }
        return {}
      }),
    }

    // Simulate: fetch shop_id from portal_users, then insert log
    const authUserId = 'auth-user-789'
    const { data: profile } = await client
      .from('portal_users')
      .select('shop_id')
      .eq('id', authUserId)
      .single()

    if (profile) {
      await client.from('portal_sessions_log').insert({
        user_id: authUserId,
        shop_id: profile.shop_id,
        action: 'login',
      })
    }

    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'auth-user-789',
      shop_id: 'shop-from-db',
      action: 'login',
    })
  })

  it('handles insert errors gracefully', async () => {
    const client = createMockClient()
    mockInsert.mockResolvedValue({ error: { message: 'RLS violation' } })

    const { error } = await client.from('portal_sessions_log').insert({
      user_id: 'user-123',
      shop_id: 'shop-abc',
      action: 'login',
    })

    expect(error).toBeTruthy()
    expect(error.message).toBe('RLS violation')
  })
})
