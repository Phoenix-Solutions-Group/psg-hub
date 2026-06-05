// 09-02: branded skeleton for the analytics surface. Block sizes mirror the
// real layout (header / 4 KPI cards / 2 charts) so there is no CLS on resolve.
export default function AnalyticsLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading analytics">
      <div className="space-y-2">
        <div className="h-3 w-36 animate-pulse rounded bg-muted" />
        <div className="h-7 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-44 animate-pulse rounded bg-muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[124px] animate-pulse rounded-lg border border-border bg-muted/40"
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-[320px] animate-pulse rounded-lg border border-border bg-muted/40" />
        <div className="min-h-[320px] animate-pulse rounded-lg border border-border bg-muted/40" />
      </div>
    </div>
  );
}
