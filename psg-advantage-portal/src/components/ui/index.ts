/**
 * PSG Advantage Portal — shared UI primitives.
 *
 * Import from this barrel:
 *   import { Metric, Panel, Badge, Button, Input, EmptyState } from '@/components/ui'
 *
 * These replace ad-hoc <div className="border border-stone bg-white p-5"> patterns
 * and the 6 different Metric implementations previously scattered across charts.
 */

export { Metric } from './Metric'
export { Panel } from './Panel'
export { Badge } from './Badge'
export { Button } from './Button'
export { Input } from './Input'
export { EmptyState } from './EmptyState'

// Existing components — re-exported for convenience
export { AlertPanel } from './AlertPanel'
export { DateRangePicker } from './DateRangePicker'
export { ShopTable } from './ShopTable'
export { TrendBadge } from './TrendBadge'
export { default as ScoreBar } from './ScoreBar'
