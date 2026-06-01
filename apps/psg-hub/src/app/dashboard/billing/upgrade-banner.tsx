"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const GRACE_WINDOW_MS = 60_000;
const REFRESH_INTERVAL_MS = 5_000;

export function shouldShowUpgradeBanner(input: {
  searchParamSuccess: boolean;
  currentTier: string | null | undefined;
  elapsedMs: number;
}): "processing" | "timeout" | "hidden" {
  if (!input.searchParamSuccess) return "hidden";
  if (input.currentTier === "performance") return "hidden";
  if (input.elapsedMs < GRACE_WINDOW_MS) return "processing";
  return "timeout";
}

type Props = {
  currentTier: string | null | undefined;
};

export function UpgradeBanner({ currentTier }: Props) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (currentTier === "performance") return;
    startRef.current = Date.now();

    intervalRef.current = setInterval(() => {
      const start = startRef.current ?? Date.now();
      const next = Date.now() - start;
      setElapsed(next);
      if (next < GRACE_WINDOW_MS) {
        router.refresh();
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [router, currentTier]);

  const view = shouldShowUpgradeBanner({
    searchParamSuccess: true,
    currentTier,
    elapsedMs: elapsed,
  });

  if (view === "hidden") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm"
    >
      {view === "processing" ? (
        <>
          <div className="font-medium">Your upgrade is processing.</div>
          <div className="mt-1 text-muted-foreground">
            This takes a few seconds. The page will update automatically.
          </div>
        </>
      ) : (
        <>
          <div className="font-medium">
            If the upgrade has not appeared, refresh the page in a minute.
          </div>
          <div className="mt-1 text-muted-foreground">
            Stripe confirmation can lag slightly. Email support if this persists.
          </div>
        </>
      )}
    </div>
  );
}
