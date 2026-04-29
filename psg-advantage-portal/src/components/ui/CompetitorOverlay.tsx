import type { ShopCompetitorPoint } from '@/types'

function formatDistance(value: number) {
  if (value === 0) return 'Here'
  return `${value.toFixed(value < 10 ? 1 : 0)} mi`
}

function getBounds(points: ShopCompetitorPoint[]) {
  const lats = points.map((point) => point.latitude)
  const lngs = points.map((point) => point.longitude)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  return {
    minLat,
    maxLat: maxLat === minLat ? maxLat + 0.01 : maxLat,
    minLng,
    maxLng: maxLng === minLng ? maxLng + 0.01 : maxLng,
  }
}

export function CompetitorOverlay({
  shopName,
  points,
}: {
  shopName: string
  points: ShopCompetitorPoint[]
}) {
  const anchor = points.find((point) => point.is_anchor)
  const competitors = points.filter((point) => !point.is_anchor)

  if (!anchor) {
    return (
      <section className="rounded-lg border border-iron/20 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-clarity">
              Competitor Overlay
            </p>
            <h3 className="mt-1 font-heading text-base font-bold text-navy">
              Location match needed
            </h3>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-iron">
          {shopName} has survey responses, but the directory match is missing or ambiguous.
          Add a unique mapped location before plotting competitors from the body shop directory.
        </p>
      </section>
    )
  }

  const bounds = getBounds(points)

  return (
    <section className="rounded-lg border border-iron/20 bg-white">
      <div className="border-b border-iron/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-clarity">
          Competitor Overlay
        </p>
        <div className="mt-1 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="font-heading text-base font-bold text-navy">
              {anchor.shop_name}
            </h3>
            {anchor.address && (
              <p className="mt-1 text-sm text-iron">{anchor.address}</p>
            )}
          </div>
          <div className="text-sm text-iron">
            {competitors.length} competitors within 25 miles
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b border-iron/10 p-5 lg:border-b-0 lg:border-r">
          <div className="relative h-[360px] overflow-hidden rounded-lg border border-iron/10 bg-canvas">
            <div className="absolute inset-4 rounded-lg border border-dashed border-iron/20" />
            {points.map((point, index) => {
              const left = ((point.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 86 + 7
              const top = (1 - (point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 86 + 7

              return (
                <div
                  key={point.place_id || `${point.shop_name}-${index}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${left}%`, top: `${top}%` }}
                  title={`${point.shop_name} (${formatDistance(point.distance_miles)})`}
                >
                  <span
                    className={
                      point.is_anchor
                        ? 'block h-5 w-5 rounded-full border-2 border-white bg-phoenix-red shadow'
                        : 'block h-3 w-3 rounded-full border border-white bg-clarity shadow'
                    }
                  />
                </div>
              )
            })}
            <div className="absolute bottom-3 left-3 rounded-md bg-white/95 px-3 py-2 text-xs text-iron shadow-sm">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-phoenix-red" />
                Surveyed shop
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-clarity" />
                Directory competitor
              </div>
            </div>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {competitors.length ? competitors.map((competitor) => (
            <div
              key={competitor.place_id || `${competitor.shop_name}-${competitor.distance_miles}`}
              className="border-b border-iron/10 p-4 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-heading text-sm font-bold text-navy">
                    {competitor.shop_name}
                  </p>
                  {competitor.address && (
                    <p className="mt-1 text-xs leading-5 text-iron">{competitor.address}</p>
                  )}
                </div>
                <span className="whitespace-nowrap rounded-md bg-horizon px-2 py-1 text-xs font-semibold text-navy">
                  {formatDistance(competitor.distance_miles)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-iron">
                {competitor.rating !== null && <span>{competitor.rating.toFixed(1)} rating</span>}
                {competitor.phone && <span>{competitor.phone}</span>}
                {competitor.website && (
                  <a
                    href={competitor.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-clarity hover:underline"
                  >
                    Website
                  </a>
                )}
              </div>
            </div>
          )) : (
            <div className="p-5 text-sm leading-6 text-iron">
              No competitors from the directory are mapped within 25 miles.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
