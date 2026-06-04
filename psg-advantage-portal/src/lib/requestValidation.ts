export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function isIsoDate(value: string) {
  if (!ISO_DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function normalizeDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  defaults: { startDate: string; endDate: string }
): ValidationResult<{ startDate: string; endDate: string }> {
  const normalizedStart = startDate?.trim() || defaults.startDate
  const normalizedEnd = endDate?.trim() || defaults.endDate

  if (!isIsoDate(normalizedStart) || !isIsoDate(normalizedEnd)) {
    return { ok: false, message: 'Dates must use YYYY-MM-DD format' }
  }

  if (normalizedStart > normalizedEnd) {
    return { ok: false, message: 'startDate must be before or equal to endDate' }
  }

  return {
    ok: true,
    value: {
      startDate: normalizedStart,
      endDate: normalizedEnd,
    },
  }
}

export function normalizeMarketFilters(
  city: string | null | undefined,
  state: string | null | undefined
): ValidationResult<{ city: string; state: string }> {
  const normalizedCity = normalizeWhitespace(city || '')
  const normalizedState = normalizeWhitespace(state || '').toUpperCase()

  if (normalizedCity.length > 80) {
    return { ok: false, message: 'City must be 80 characters or fewer' }
  }

  if (CONTROL_CHAR_RE.test(normalizedCity) || CONTROL_CHAR_RE.test(normalizedState)) {
    return { ok: false, message: 'Filters contain invalid characters' }
  }

  if (normalizedState && !/^[A-Z]{2}$/.test(normalizedState)) {
    return { ok: false, message: 'State must be a two-letter code' }
  }

  return {
    ok: true,
    value: {
      city: normalizedCity,
      state: normalizedState,
    },
  }
}
