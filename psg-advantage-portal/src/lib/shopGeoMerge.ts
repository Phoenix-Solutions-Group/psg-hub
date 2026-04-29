import type { ShopListItem } from '@/types'

export interface GeoShopRow {
  place_id: string
  name: string
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  category: string | null
  latitude: number | null
  longitude: number | null
}

const MAX_VISIBLE_SHOPS = 500

function normalizeShopName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeSurveyShop(shop: ShopListItem): ShopListItem {
  return {
    ...shop,
    latest_survey_date:
      typeof shop.latest_survey_date === 'object' &&
      shop.latest_survey_date !== null &&
      'value' in shop.latest_survey_date
        ? String((shop.latest_survey_date as { value: unknown }).value)
        : String(shop.latest_survey_date || ''),
  }
}

function uniqueByNormalizedName<T>(
  items: T[],
  getName: (item: T) => string
): Map<string, T> {
  const grouped = new Map<string, T[]>()

  for (const item of items) {
    const normalized = normalizeShopName(getName(item))
    grouped.set(normalized, [...(grouped.get(normalized) || []), item])
  }

  const unique = new Map<string, T>()
  for (const [normalized, matches] of grouped) {
    if (matches.length === 1) {
      unique.set(normalized, matches[0])
    }
  }

  return unique
}

export function buildPlaceIdSurveyMap(
  geoShops: GeoShopRow[],
  surveyShops: ShopListItem[]
): Map<string, ShopListItem> {
  const uniqueGeoByName = uniqueByNormalizedName(geoShops, (shop) => shop.name)
  const uniqueSurveyByName = uniqueByNormalizedName(surveyShops, (shop) => shop.shop_name)
  const surveyByPlaceId = new Map<string, ShopListItem>()

  for (const [normalizedName, geoShop] of uniqueGeoByName) {
    const survey = uniqueSurveyByName.get(normalizedName)
    if (survey) {
      surveyByPlaceId.set(geoShop.place_id, normalizeSurveyShop(survey))
    }
  }

  return surveyByPlaceId
}

export function mergeGeoShopsWithSurveyMetrics(
  geoShops: GeoShopRow[],
  surveyShops: ShopListItem[]
): ShopListItem[] {
  const surveyByPlaceId = buildPlaceIdSurveyMap(geoShops, surveyShops)

  return geoShops.map((geoShop) => {
    const survey = surveyByPlaceId.get(geoShop.place_id)

    return {
      shop_name: survey?.shop_name || geoShop.name,
      total_surveys: survey?.total_surveys || 0,
      avg_emi_pct: survey?.avg_emi_pct || 0,
      trend: survey?.trend || 'stable',
      emi_delta: survey?.emi_delta,
      latest_survey_date: survey?.latest_survey_date || '',
      place_id: geoShop.place_id,
      address: geoShop.address,
      phone: geoShop.phone,
      website: geoShop.website,
      rating: geoShop.rating,
      category: geoShop.category,
      latitude: geoShop.latitude,
      longitude: geoShop.longitude,
    }
  }).sort((a, b) => {
    if (a.total_surveys !== b.total_surveys) {
      return b.total_surveys - a.total_surveys
    }
    if ((a.avg_emi_pct || 0) !== (b.avg_emi_pct || 0)) {
      return (b.avg_emi_pct || 0) - (a.avg_emi_pct || 0)
    }
    return (b.rating || 0) - (a.rating || 0)
  }).slice(0, MAX_VISIBLE_SHOPS)
}
