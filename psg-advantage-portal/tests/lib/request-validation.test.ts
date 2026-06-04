import { describe, expect, it } from 'vitest'
import {
  isIsoDate,
  normalizeDateRange,
  normalizeMarketFilters,
} from '@/lib/requestValidation'

describe('request validation helpers', () => {
  it('accepts real ISO dates only', () => {
    expect(isIsoDate('2026-04-28')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('04/28/2026')).toBe(false)
  })

  it('normalizes valid date ranges and rejects reversed ranges', () => {
    expect(normalizeDateRange('2026-01-01', '2026-04-28', {
      startDate: '2026-01-28',
      endDate: '2026-04-28',
    })).toEqual({
      ok: true,
      value: {
        startDate: '2026-01-01',
        endDate: '2026-04-28',
      },
    })

    expect(normalizeDateRange('2026-04-29', '2026-04-28', {
      startDate: '2026-01-28',
      endDate: '2026-04-28',
    })).toEqual({
      ok: false,
      message: 'startDate must be before or equal to endDate',
    })
  })

  it('normalizes market filters and rejects unbounded cache keys', () => {
    expect(normalizeMarketFilters('  Los   Angeles ', ' ca ')).toEqual({
      ok: true,
      value: {
        city: 'Los Angeles',
        state: 'CA',
      },
    })

    expect(normalizeMarketFilters('A'.repeat(81), 'CA')).toEqual({
      ok: false,
      message: 'City must be 80 characters or fewer',
    })
    expect(normalizeMarketFilters('Miami', 'Florida')).toEqual({
      ok: false,
      message: 'State must be a two-letter code',
    })
  })
})
