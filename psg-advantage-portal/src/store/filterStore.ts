import { create } from 'zustand'
import { subDays, startOfYear, format } from 'date-fns'

type DatePreset = '30d' | '90d' | '12m' | 'ytd'

interface FilterState {
  startDate: string
  endDate: string
  shopSearch: string
  setDateRange: (start: string, end: string) => void
  setShopSearch: (search: string) => void
  applyPreset: (preset: DatePreset) => void
}

const today = () => format(new Date(), 'yyyy-MM-dd')

export const useFilterStore = create<FilterState>((set) => ({
  startDate: format(subDays(new Date(), 90), 'yyyy-MM-dd'),
  endDate: today(),
  shopSearch: '',
  setDateRange: (startDate, endDate) => set({ startDate, endDate }),
  setShopSearch: (shopSearch) => set({ shopSearch }),
  applyPreset: (preset) => {
    const end = today()
    const presets: Record<DatePreset, string> = {
      '30d': format(subDays(new Date(), 30), 'yyyy-MM-dd'),
      '90d': format(subDays(new Date(), 90), 'yyyy-MM-dd'),
      '12m': format(subDays(new Date(), 365), 'yyyy-MM-dd'),
      'ytd': format(startOfYear(new Date()), 'yyyy-MM-dd'),
    }
    set({ startDate: presets[preset], endDate: end })
  },
}))
