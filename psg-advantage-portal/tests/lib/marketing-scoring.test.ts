import { describe, expect, it } from 'vitest'

import { buildRepairDemandScore, buildWeatherDemandScore } from '@/lib/marketingScoring'

describe('marketing scoring', () => {
  it('keeps weather scoring compatible without storm data', () => {
    expect(buildWeatherDemandScore(12.3, 0)).toBe(63)
  })

  it('raises weather scoring when storm demand aggregates are present', () => {
    const withoutStorm = buildWeatherDemandScore(12.3, 0)
    const withStorm = buildWeatherDemandScore(12.3, 250)

    expect(withStorm).toBeGreaterThan(withoutStorm)
  })

  it('blends accident and storm demand for ZIP repair demand', () => {
    const accidentOnly = buildRepairDemandScore(100, 100, 0, 0)
    const withStorm = buildRepairDemandScore(70, 100, 100, 100)

    expect(accidentOnly).toBe(100)
    expect(withStorm).toBeGreaterThan(buildRepairDemandScore(70, 100, 0, 0))
  })
})
