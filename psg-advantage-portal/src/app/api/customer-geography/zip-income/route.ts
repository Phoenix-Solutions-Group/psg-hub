import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getCustomerGeoZipIncome } from '@/lib/customerGeographyData'
import { normalizeCustomerGeoFilters } from '@/app/api/customer-geography/_shared'
import type { CustomerGeoZipIncomeResponse } from '@/types'

export async function GET(request: NextRequest) {
  const result = await getAuthenticatedProfile(request)
  if (result instanceof NextResponse) return result
  if (!isAdmin(result)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  const { searchParams } = request.nextUrl
  const normalized = normalizeCustomerGeoFilters(searchParams)
  if (!normalized.ok) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: normalized.message } },
      { status: 400 }
    )
  }

  const limit = Math.min(
    Math.max(Number(searchParams.get('limit') || 500) || 500, 25),
    5000
  )

  const { startDate, endDate, preset, shopIds } = normalized.value
  const cacheKey = `customer-geo:zip-income:v3:${startDate}:${endDate}:${preset}:${shopIds.join('|')}:${limit}`
  const cached = await getCached<CustomerGeoZipIncomeResponse>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let rows: CustomerGeoZipIncomeResponse['rows']
  try {
    rows = await getCustomerGeoZipIncome({
      startDate,
      endDate,
      preset,
      shopIds,
      limit,
    })
  } catch (error) {
    console.error('[customer-geo:zip-income]', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Unable to load customer geography ZIP income' } },
      { status: 500 }
    )
  }

  const totalRepairs = rows.reduce((sum, row) => sum + row.repair_count, 0)
  const totalServiceAddresses = rows.reduce((sum, row) => sum + row.unique_household_count, 0)
  const totalMarketHouseholds = rows.reduce((sum, row) => {
    if (row.market_households === null) return sum
    return sum + row.market_households
  }, 0)
  const weightedIncomeNumerator = rows.reduce((sum, row) => {
    if (row.mean_household_income === null) return sum
    return sum + row.mean_household_income * row.repair_count
  }, 0)
  const weightedIncomeDenominator = rows.reduce((sum, row) => {
    if (row.mean_household_income === null) return sum
    return sum + row.repair_count
  }, 0)

  const totalRegisteredVehicles = rows.reduce((sum, row) => {
    if (row.registered_vehicles === null) return sum
    return sum + row.registered_vehicles
  }, 0)

  const payload: CustomerGeoZipIncomeResponse = {
    filters: {
      startDate,
      endDate,
      preset,
      shopIds,
    },
    summary: {
      zip_count: rows.length,
      total_repairs: totalRepairs,
      total_households: totalServiceAddresses,
      total_service_addresses: totalServiceAddresses,
      total_market_households: totalMarketHouseholds > 0 ? totalMarketHouseholds : null,
      service_address_penetration_pct:
        totalMarketHouseholds > 0
          ? Number(((totalServiceAddresses / totalMarketHouseholds) * 100).toFixed(2))
          : null,
      total_registered_vehicles: totalRegisteredVehicles > 0 ? totalRegisteredVehicles : null,
      vehicle_penetration_pct:
        totalRegisteredVehicles > 0
          ? Number(((totalServiceAddresses / totalRegisteredVehicles) * 100).toFixed(2))
          : null,
      vehicle_repair_penetration_pct:
        totalRegisteredVehicles > 0
          ? Number(((totalRepairs / totalRegisteredVehicles) * 100).toFixed(2))
          : null,
      weighted_mean_household_income:
        weightedIncomeDenominator > 0
          ? Number((weightedIncomeNumerator / weightedIncomeDenominator).toFixed(2))
          : null,
    },
    rows,
  }

  await setCached(cacheKey, payload, 3600)
  return NextResponse.json(payload)
}
