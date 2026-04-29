import { describe, expect, it } from 'vitest'
import {
  buildPlaceIdSurveyMap,
  mergeGeoShopsWithSurveyMetrics,
  type GeoShopRow,
} from '@/lib/shopGeoMerge'
import type { ShopListItem } from '@/types'

function geo(overrides: Partial<GeoShopRow>): GeoShopRow {
  return {
    place_id: 'place-1',
    name: 'Acme Auto Body',
    address: '1 Main St',
    phone: null,
    website: null,
    rating: null,
    category: 'Auto body shop',
    latitude: null,
    longitude: null,
    ...overrides,
  }
}

function survey(overrides: Partial<ShopListItem>): ShopListItem {
  return {
    shop_name: 'Acme Auto Body',
    total_surveys: 10,
    avg_emi_pct: 91.2,
    trend: 'stable',
    latest_survey_date: '2026-04-01',
    ...overrides,
  }
}

describe('shop geo merge', () => {
  it('builds place_id keyed matches for unambiguous normalized names', () => {
    const map = buildPlaceIdSurveyMap(
      [geo({ place_id: 'geo-acme', name: 'Acme Auto Body' })],
      [survey({ shop_name: 'ACME auto-body' })]
    )

    expect(map.get('geo-acme')?.shop_name).toBe('ACME auto-body')
  })

  it('does not match duplicate geo names to one survey shop', () => {
    const map = buildPlaceIdSurveyMap(
      [
        geo({ place_id: 'geo-1', name: "Don's Auto Body" }),
        geo({ place_id: 'geo-2', name: 'Dons Auto Body' }),
      ],
      [survey({ shop_name: 'Don’s Auto Body', total_surveys: 99 })]
    )

    expect(map.size).toBe(0)
  })

  it('merges survey metrics only through place_id matches', () => {
    const rows = mergeGeoShopsWithSurveyMetrics(
      [
        geo({ place_id: 'geo-acme', name: 'Acme Auto Body', rating: 4.8 }),
        geo({ place_id: 'geo-other', name: 'Other Collision', rating: 5 }),
      ],
      [survey({ shop_name: 'Acme Auto Body', total_surveys: 42, avg_emi_pct: 95.5 })]
    )

    expect(rows[0]).toMatchObject({
      place_id: 'geo-acme',
      shop_name: 'Acme Auto Body',
      total_surveys: 42,
      avg_emi_pct: 95.5,
    })
    expect(rows[1]).toMatchObject({
      place_id: 'geo-other',
      shop_name: 'Other Collision',
      total_surveys: 0,
      avg_emi_pct: 0,
    })
  })
})
