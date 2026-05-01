import { normalizeDateRange, type ValidationResult } from '@/lib/requestValidation'
import type { CustomerGeoPreset } from '@/types'

const PRESETS: CustomerGeoPreset[] = ['all', 'nyc5', 'nyc_nassau_suffolk']

export interface CustomerGeoQueryFilters {
  startDate: string
  endDate: string
  preset: CustomerGeoPreset
  shopIds: string[]
}

export function normalizePreset(value: string | null): ValidationResult<CustomerGeoPreset> {
  const normalized = (value || 'nyc_nassau_suffolk').trim().toLowerCase() as CustomerGeoPreset
  if (!PRESETS.includes(normalized)) {
    return {
      ok: false,
      message: `preset must be one of: ${PRESETS.join(', ')}`,
    }
  }
  return { ok: true, value: normalized }
}

export function normalizeShopIds(value: string | null): string[] {
  if (!value) return []
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50)
}

export function normalizeCustomerGeoFilters(searchParams: URLSearchParams): ValidationResult<CustomerGeoQueryFilters> {
  const dateRange = normalizeDateRange(
    searchParams.get('startDate'),
    searchParams.get('endDate'),
    { startDate: '2024-01-01', endDate: new Date().toISOString().slice(0, 10) }
  )
  if (!dateRange.ok) return dateRange

  const preset = normalizePreset(searchParams.get('preset'))
  if (!preset.ok) return preset

  return {
    ok: true,
    value: {
      startDate: dateRange.value.startDate,
      endDate: dateRange.value.endDate,
      preset: preset.value,
      shopIds: normalizeShopIds(searchParams.get('shopIds')),
    },
  }
}
