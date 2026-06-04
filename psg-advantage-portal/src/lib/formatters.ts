/**
 * Number and date formatting utilities for dashboard display.
 * All EMI values are assumed to already be in percentage form (0-100).
 */

/**
 * Format a number as a percentage string: 94.2 -> "94.2%"
 */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

/**
 * Format a number with locale-specific separators: 1234 -> "1,234"
 */
export function formatNumber(value: number): string {
  return value.toLocaleString()
}

/**
 * Format an ISO date string to readable form: "2026-03-10" -> "Mar 10, 2026"
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format a YYYY-MM string to readable month: "2026-03" -> "Mar 2026"
 */
export function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-')
  const date = new Date(Number(year), Number(month) - 1)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Classify EMI percentage into tier for color coding.
 * Uses EMI_TIER_COLORS from psgTheme.ts for display.
 */
export function getEmiTier(emiPct: number): 'excellent' | 'good' | 'poor' {
  if (emiPct >= 95) return 'excellent'
  if (emiPct >= 88) return 'good'
  return 'poor'
}

/**
 * Determine trend direction from a delta value.
 * Default threshold: 1.0 percentage point.
 */
export function getTrend(
  delta: number,
  threshold: number = 1.0
): 'improving' | 'stable' | 'declining' {
  if (delta > threshold) return 'improving'
  if (delta < -threshold) return 'declining'
  return 'stable'
}
