import { describe, it, expect, beforeEach } from 'vitest'
import { subDays, startOfYear, format } from 'date-fns'
import { useFilterStore } from '@/store/filterStore'

const today = () => format(new Date(), 'yyyy-MM-dd')

describe('useFilterStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useFilterStore.setState({
      startDate: format(subDays(new Date(), 90), 'yyyy-MM-dd'),
      endDate: today(),
      shopSearch: '',
    })
  })

  it('has default startDate 90 days ago and endDate today', () => {
    const state = useFilterStore.getState()
    const expected90DaysAgo = format(subDays(new Date(), 90), 'yyyy-MM-dd')
    expect(state.startDate).toBe(expected90DaysAgo)
    expect(state.endDate).toBe(today())
  })

  it('applyPreset 30d sets startDate to 30 days ago', () => {
    useFilterStore.getState().applyPreset('30d')
    const state = useFilterStore.getState()
    const expected30DaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')
    expect(state.startDate).toBe(expected30DaysAgo)
    expect(state.endDate).toBe(today())
  })

  it('applyPreset ytd sets startDate to Jan 1 of current year', () => {
    useFilterStore.getState().applyPreset('ytd')
    const state = useFilterStore.getState()
    const expectedYtd = format(startOfYear(new Date()), 'yyyy-MM-dd')
    expect(state.startDate).toBe(expectedYtd)
    expect(state.endDate).toBe(today())
  })

  it('setDateRange updates both dates', () => {
    useFilterStore.getState().setDateRange('2025-01-01', '2025-06-30')
    const state = useFilterStore.getState()
    expect(state.startDate).toBe('2025-01-01')
    expect(state.endDate).toBe('2025-06-30')
  })

  it('setShopSearch updates search string', () => {
    useFilterStore.getState().setShopSearch('auto body')
    const state = useFilterStore.getState()
    expect(state.shopSearch).toBe('auto body')
  })

  it('applyPreset 12m sets startDate to 365 days ago', () => {
    useFilterStore.getState().applyPreset('12m')
    const state = useFilterStore.getState()
    const expected365DaysAgo = format(subDays(new Date(), 365), 'yyyy-MM-dd')
    expect(state.startDate).toBe(expected365DaysAgo)
  })

  it('applyPreset 90d sets startDate to 90 days ago', () => {
    useFilterStore.getState().applyPreset('90d')
    const state = useFilterStore.getState()
    const expected90DaysAgo = format(subDays(new Date(), 90), 'yyyy-MM-dd')
    expect(state.startDate).toBe(expected90DaysAgo)
  })
})
