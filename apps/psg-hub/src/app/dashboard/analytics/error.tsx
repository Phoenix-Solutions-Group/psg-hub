"use client";

// 09-02: designed ERROR state for the analytics route (design canon: every
// state designed — empty/loading/error/no-data). The snapshot readers throw on
// real DB errors; this boundary keeps that failure branded and recoverable.
// Error files must be client components.
export default function AnalyticsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Marketing analytics
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Analytics is unavailable
        </h1>
      </div>

      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
        <p className="text-muted-foreground">
          We couldn&apos;t load your analytics right now. Your data is safe —
          this is a temporary loading problem on our side.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md bg-primary px-4 py-2 font-heading text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
