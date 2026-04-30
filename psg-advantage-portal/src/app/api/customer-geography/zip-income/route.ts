import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedProfile, isAdmin } from '@/lib/auth'
import { getCached, setCached } from '@/lib/cache'
import { getCustomerGeoZipIncome } from '@/lib/customerGeographyData'
import { normalizeCustomerGeoFilters } from '@/app/api/customer-geography/_shared'
import type { CustomerGeoZipIncomeResponse } from '@/types'

function percentileRanks(values: (number | null)[]): number[] {
  const validEntries = values
    .map((v, i) => ({ v, i }))
    .filter((e): e is { v: number; i: number } => e.v !== null)
  validEntries.sort((a, b) => a.v - b.v)
  const result = new Array(values.length).fill(0)
  const maxRank = Math.max(validEntries.length - 1, 1)
  for (let rank = 0; rank < validEntries.length; rank++) {
    result[validEntries[rank].i] = (rank / maxRank) * 100
  }
  return result
}

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
  const cacheKey = `customer-geo:zip-income:v5:${startDate}:${endDate}:${preset}:${shopIds.join('|')}:${limit}`
  const cached = await getCached<CustomerGeoZipIncomeResponse>(cacheKey)
  if (cached) return NextResponse.json(cached)

  let rows: Awaited<ReturnType<typeof getCustomerGeoZipIncome>>
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

  // Opportunity score: percentile-based composite (0-100)
  const vehiclePercentiles = percentileRanks(rows.map((r) => r.registered_vehicles))
  const incomePercentiles = percentileRanks(rows.map((r) => r.mean_household_income))
  const demandPercentiles = percentileRanks(
    rows.map((r) => {
      const crash = r.crash_demand_score ?? 0
      const storm = r.storm_demand_score ?? 0
      return crash + storm > 0 ? crash + storm : null
    })
  )
  const competitionPercentiles = percentileRanks(rows.map((r) => r.competitor_shop_count))
  const headroomValues = rows.map((r) => {
    if (r.registered_vehicles === null || r.registered_vehicles <= 0) return null
    return 1 - r.repair_count / r.registered_vehicles
  })
  const headroomPercentiles = percentileRanks(headroomValues)
  const tractionPercentiles = percentileRanks(rows.map((r) => r.repair_count))

  const scoredRows = rows.map((row, i) => ({
    ...row,
    opportunity_score: Number(
      (
        vehiclePercentiles[i] * 0.25 +
        incomePercentiles[i] * 0.15 +
        demandPercentiles[i] * 0.15 +
        (100 - competitionPercentiles[i]) * 0.15 +
        headroomPercentiles[i] * 0.15 +
        tractionPercentiles[i] * 0.15
      ).toFixed(1)
    ),
  }))

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
      total_registered_vehicles: totalRegisteredVehicles > 0 ? totalRegisteredVehicles : null,
      vehicle_repair_penetration_pct:
        totalRegisteredVehicles > 0
          ? Number(((totalRepairs / totalRegisteredVehicles) * 100).toFixed(2))
          : null,
      market_share_pct:
        totalRegisteredVehicles > 0
          ? Number(((totalRepairs / (totalRegisteredVehicles * 0.06)) * 100).toFixed(2))
          : null,
      weighted_mean_household_income:
        weightedIncomeDenominator > 0
          ? Number((weightedIncomeNumerator / weightedIncomeDenominator).toFixed(2))
          : null,
      avg_opportunity_score:
        scoredRows.length > 0
          ? Number(
              (scoredRows.reduce((sum, r) => sum + (r.opportunity_score ?? 0), 0) / scoredRows.length).toFixed(1)
            )
          : null,
    },
    rows: scoredRows,
  }

  await setCached(cacheKey, payload, 3600)
  return NextResponse.json(payload)
}
