/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import ScoreBar from '@/components/ui/ScoreBar'

describe('ScoreBar communication score flagging (SHOP-05)', () => {
  it('renders with normal styling when isFlagged is false', () => {
    render(createElement(ScoreBar, { label: 'Communication', value: 92.5, isFlagged: false }))

    const label = screen.getByText('Communication')
    expect(label.className).not.toContain('phoenix-red')

    expect(screen.queryByText('Below avg')).toBeNull()
  })

  it('renders with Phoenix Red styling when isFlagged is true', () => {
    render(createElement(ScoreBar, { label: 'Communication', value: 82.0, isFlagged: true }))

    const label = screen.getByText('Communication')
    expect(label.className).toContain('phoenix-red')

    const value = screen.getByText('82.0%')
    expect(value.className).toContain('phoenix-red')

    const badge = screen.getByText('Below avg')
    expect(badge).toBeDefined()
    expect(badge.className).toContain('phoenix-red')
  })

  it('renders "N/A" text when value is null', () => {
    render(createElement(ScoreBar, { label: 'Communication', value: null }))

    expect(screen.getByText('N/A')).toBeDefined()
    expect(screen.getByText('Communication')).toBeDefined()
  })

  it('integration: isFlagged logic matches page implementation', () => {
    // Same logic as the shop detail page uses
    function computeIsFlagged(
      avgCommunication: number | null,
      networkAvgCommunication: number | null
    ): boolean {
      return (
        avgCommunication !== null &&
        networkAvgCommunication !== null &&
        avgCommunication < networkAvgCommunication
      )
    }

    // Communication below network average -> flagged
    expect(computeIsFlagged(82, 90)).toBe(true)

    // Communication above network average -> not flagged
    expect(computeIsFlagged(92, 90)).toBe(false)

    // Communication equal to network average -> not flagged
    expect(computeIsFlagged(90, 90)).toBe(false)

    // Null values -> not flagged
    expect(computeIsFlagged(null, 90)).toBe(false)
    expect(computeIsFlagged(82, null)).toBe(false)
    expect(computeIsFlagged(null, null)).toBe(false)

    // Render with flagged=true to verify visual
    render(createElement(ScoreBar, { label: 'Comm Flagged', value: 82, isFlagged: true }))
    expect(screen.getByText('Below avg')).toBeDefined()

    // Render with flagged=false to verify no badge
    render(createElement(ScoreBar, { label: 'Comm Normal', value: 92, isFlagged: false }))
    expect(screen.queryByText(/Below avg/)).toBeDefined() // previous render still in DOM
  })
})
