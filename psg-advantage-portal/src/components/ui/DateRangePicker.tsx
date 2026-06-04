'use client'

import { useFilterStore } from '@/store/filterStore'

const PRESETS = [
  { label: '30d', value: '30d' as const },
  { label: '90d', value: '90d' as const },
  { label: '12m', value: '12m' as const },
  { label: 'YTD', value: 'ytd' as const },
]

export function DateRangePicker() {
  const { startDate, applyPreset } = useFilterStore()

  // Determine active preset by comparing current startDate to what each preset would produce
  function getActivePreset(): string | null {
    const now = new Date()
    const currentStart = startDate

    for (const preset of PRESETS) {
      let expectedStart: string
      if (preset.value === '30d') {
        expectedStart = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0]
      } else if (preset.value === '90d') {
        expectedStart = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0]
      } else if (preset.value === '12m') {
        expectedStart = new Date(now.getTime() - 365 * 86400000).toISOString().split('T')[0]
      } else {
        expectedStart = `${now.getFullYear()}-01-01`
      }

      // Allow 1-day tolerance for edge cases
      if (currentStart === expectedStart) return preset.value
    }
    return null
  }

  const active = getActivePreset()

  return (
    <div className="flex items-center gap-1 border border-stone bg-white p-1">
      {PRESETS.map((preset) => (
        <button
          key={preset.value}
          onClick={() => applyPreset(preset.value)}
          className={`px-3 py-1.5 font-heading text-xs font-medium transition-colors duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)] ${
            active === preset.value
              ? 'bg-navy text-white'
              : 'text-slate hover:bg-bone hover:text-navy'
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
