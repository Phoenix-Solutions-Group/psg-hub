'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useFilterStore } from '@/store/filterStore'
import { getEmiTier } from '@/lib/formatters'
import { TrendBadge } from './TrendBadge'
import { EMI_TIER_COLORS } from '@/lib/psgTheme'
import type { ShopListItem } from '@/types'

type SortKey = 'shop_name' | 'rating' | 'total_surveys' | 'avg_emi_pct' | 'trend' | 'latest_survey_date'
type SortDir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'shop_name', label: 'Shop Name' },
  { key: 'rating', label: 'Rating' },
  { key: 'total_surveys', label: 'Surveys' },
  { key: 'avg_emi_pct', label: 'Avg EMI' },
  { key: 'trend', label: 'Trend' },
  { key: 'latest_survey_date', label: 'Last Survey' },
]

export function ShopTable({ shops }: { shops: ShopListItem[] }) {
  const { shopSearch, setShopSearch } = useFilterStore()
  const [sortKey, setSortKey] = useState<SortKey>('avg_emi_pct')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const filtered = useMemo(() => {
    let result = shops
    if (shopSearch) {
      const search = shopSearch.toLowerCase()
      result = result.filter((s) => s.shop_name.toLowerCase().includes(search))
    }
    return [...result].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      if (aVal === undefined || bVal === undefined) {
        return 0
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })
  }, [shops, shopSearch, sortKey, sortDir])

  return (
    <div className="border border-stone bg-white shadow-[0_1px_2px_rgba(22,21,20,0.04)]">
      <div className="border-b border-stone p-4">
        <input
          type="text"
          placeholder="Search shops..."
          value={shopSearch}
          onChange={(e) => setShopSearch(e.target.value)}
          className="w-full max-w-xs border border-stone bg-paper px-3 py-2 text-sm text-navy placeholder:text-mist shadow-[inset_0_1px_2px_rgba(22,21,20,0.05)] focus:border-phoenix-red focus:bg-white focus:outline-none focus:ring-2 focus:ring-phoenix-red focus:ring-offset-2"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone bg-bone/50">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="cursor-pointer select-none px-4 py-3 text-left font-heading text-xs font-medium uppercase text-slate hover:text-phoenix-red"
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((shop) => {
              const tier = getEmiTier(shop.avg_emi_pct)
              const hasSurveyDetail = shop.total_surveys > 0
              return (
                <tr
                  key={shop.place_id || shop.shop_name}
                  className="border-b border-stone/60 hover:bg-paper/80"
                >
                  <td className="px-4 py-2.5">
                    <div>
                      {hasSurveyDetail ? (
                        <Link
                          href={`/shops/${encodeURIComponent(shop.shop_name)}`}
                          className="font-heading font-medium text-navy underline-offset-4 hover:text-phoenix-red hover:underline"
                        >
                          {shop.shop_name}
                        </Link>
                      ) : (
                        <span className="font-medium text-navy">
                          {shop.shop_name}
                        </span>
                      )}
                      {shop.address && (
                        <p className="mt-1 max-w-md text-xs leading-5 text-slate">
                          {shop.address}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {shop.phone && <span className="text-slate">{shop.phone}</span>}
                        {shop.website && (
                          <a
                            href={shop.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-phoenix-red underline-offset-4 hover:underline"
                          >
                            Website
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate">
                    {shop.rating ? shop.rating.toFixed(1) : 'n/a'}
                  </td>
                  <td className="px-4 py-2.5 text-slate">
                    {shop.total_surveys.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span style={{ color: EMI_TIER_COLORS[tier] }} className="font-medium">
                      {shop.avg_emi_pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <TrendBadge trend={shop.trend || 'stable'} delta={shop.emi_delta} />
                  </td>
                  <td className="px-4 py-2.5 text-slate">
                    {shop.latest_survey_date}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate">
                  No shops found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
