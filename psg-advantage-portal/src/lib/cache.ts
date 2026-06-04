import Redis from 'ioredis'

let redisAvailable = true
const memoryCache = new Map<string, { expiresAt: number; value: string }>()

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy(times: number) {
    if (times > 1) {
      redisAvailable = false
      return null
    }
    return 500
  },
})

redis.on('error', () => {
  redisAvailable = false
})

export async function getCached<T>(key: string): Promise<T | null> {
  const memoryValue = memoryCache.get(key)
  if (memoryValue) {
    if (memoryValue.expiresAt > Date.now()) {
      return JSON.parse(memoryValue.value) as T
    }
    memoryCache.delete(key)
  }

  if (!redisAvailable) return null
  try {
    const value = await redis.get(key)
    if (!value) return null
    memoryCache.set(key, {
      value,
      expiresAt: Date.now() + 30_000,
    })
    return JSON.parse(value) as T
  } catch {
    redisAvailable = false
    return null
  }
}

export async function setCached(
  key: string,
  data: unknown,
  ttlSeconds = 86400
): Promise<void> {
  const value = JSON.stringify(data)
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  })

  if (!redisAvailable) return
  try {
    await redis.setex(key, ttlSeconds, value)
  } catch {
    redisAvailable = false
  }
}

export async function invalidateCache(pattern: string): Promise<void> {
  if (!pattern.includes('*')) {
    memoryCache.delete(pattern)
  } else {
    const prefix = pattern.split('*')[0]
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) memoryCache.delete(key)
    }
  }

  if (!redisAvailable) return
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch {
    redisAvailable = false
  }
}
