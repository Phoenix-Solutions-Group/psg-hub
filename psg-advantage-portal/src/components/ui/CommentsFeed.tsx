'use client'

import { useEffect, useState, useCallback } from 'react'
import type { PaginatedComments } from '@/types'
import { formatDate } from '@/lib/formatters'
import { getEmiTier } from '@/lib/formatters'
import { Button, Input, EmptyState } from '@/components/ui'

interface CommentsFeedProps {
  shopName: string
}

export default function CommentsFeed({ shopName }: CommentsFeedProps) {
  const [data, setData] = useState<PaginatedComments | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchComments = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
      })
      if (debouncedSearch) params.set('search', debouncedSearch)

      const res = await fetch(
        `/api/shops/${encodeURIComponent(shopName)}/comments?${params}`
      )
      if (res.ok) {
        const json: PaginatedComments = await res.json()
        setData(json)
      }
    } finally {
      setLoading(false)
    }
  }, [shopName, page, debouncedSearch])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  const tierColorMap: Record<string, string> = {
    excellent: 'bg-success-bg text-success-deep',
    good: 'bg-grove-bg text-grove',
    poor: 'bg-danger-bg text-danger-deep',
  }

  const hasSearch = debouncedSearch.length > 0

  return (
    <div className="border border-stone bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-sm font-medium text-navy">Customer Comments</h3>
        {data && (
          <span className="text-xs text-slate">{data.total} total</span>
        )}
      </div>

      <div className="mb-4">
        <Input
          name="comments-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search comments..."
        />
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate">Loading…</div>
      ) : !data || data.comments.length === 0 ? (
        <EmptyState
          title={hasSearch ? 'No matching comments' : 'No customer comments yet'}
          description={
            hasSearch
              ? 'Try a different search term, or clear the search to see all feedback.'
              : 'Customer feedback appears here after surveys are completed and synced.'
          }
        />
      ) : (
        <div className="space-y-3">
          {data.comments.map((comment, i) => {
            const tier = getEmiTier(comment.scale_emi_pct)
            return (
              <div
                key={`${comment.survey_date}-${i}`}
                className="border border-stone p-3"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate">
                      {formatDate(comment.survey_date)}
                    </span>
                    <span className="text-xs text-mist">
                      Customer Feedback
                    </span>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 text-[10px] font-medium ${tierColorMap[tier]}`}
                  >
                    {comment.scale_emi_pct}%
                  </span>
                </div>
                <p className="text-sm text-navy">{comment.comment_text}</p>
              </div>
            )
          })}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-xs text-slate">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
