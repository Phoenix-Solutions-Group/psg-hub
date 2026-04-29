import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()
const mockSetex = vi.fn()
const mockKeys = vi.fn()
const mockDel = vi.fn()
const mockOn = vi.fn()

vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor() {
      return {
        get: mockGet,
        setex: mockSetex,
        keys: mockKeys,
        del: mockDel,
        on: mockOn,
      }
    }
  },
}))

describe('cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('getCached returns null for missing keys', async () => {
    mockGet.mockResolvedValueOnce(null)

    const { getCached } = await import('@/lib/cache')
    const result = await getCached('nonexistent')

    expect(result).toBeNull()
    expect(mockGet).toHaveBeenCalledWith('nonexistent')
  })

  it('setCached stores JSON-serialized data with TTL', async () => {
    mockSetex.mockResolvedValueOnce('OK')

    const { setCached } = await import('@/lib/cache')
    await setCached('key1', { foo: 'bar' }, 3600)

    expect(mockSetex).toHaveBeenCalledWith('key1', 3600, JSON.stringify({ foo: 'bar' }))
  })

  it('getCached returns parsed JSON for existing keys', async () => {
    mockGet.mockResolvedValueOnce(JSON.stringify({ count: 42 }))

    const { getCached } = await import('@/lib/cache')
    const result = await getCached<{ count: number }>('existing')

    expect(result).toEqual({ count: 42 })
  })

  it('invalidateCache deletes keys matching a pattern', async () => {
    mockKeys.mockResolvedValueOnce(['dash:1', 'dash:2'])
    mockDel.mockResolvedValueOnce(2)

    const { invalidateCache } = await import('@/lib/cache')
    await invalidateCache('dash:*')

    expect(mockKeys).toHaveBeenCalledWith('dash:*')
    expect(mockDel).toHaveBeenCalledWith('dash:1', 'dash:2')
  })

  it('default TTL is 86400 seconds (24 hours)', async () => {
    mockSetex.mockResolvedValueOnce('OK')

    const { setCached } = await import('@/lib/cache')
    await setCached('key2', { data: true })

    expect(mockSetex).toHaveBeenCalledWith('key2', 86400, expect.any(String))
  })
})
