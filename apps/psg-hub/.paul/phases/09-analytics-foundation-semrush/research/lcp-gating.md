# Research: LCP <2s gating (local Playwright + Supabase harness)

**Agent:** general-purpose (web) · **Date:** 2026-06-04

## Recommendation: Playwright + `PerformanceObserver` (zero new deps)

The existing harness already satisfies every prerequisite: `playwright.config.ts` runs `pnpm build && pnpm start -p 3100` (prod build), `workers:1` + `fullyParallel:false`, local-Supabase seed, `storageState` per-role auth. The LCP gate slots in with NO new infrastructure or dependency.

### Why (b) PerformanceObserver over alternatives
- **(a) web-vitals `onLCP`** — works but needs a dep + monkeypatching `document.visibilityState` to hidden to flush the final value (headless never hides). Fragile.
- **(c) Lighthouse CI** — can't cleanly reuse the `storageState` authenticated session for the gated `/dashboard`; runs its own Chrome/server outside `pnpm test:e2e`. Reserve for PUBLIC routes (`/`, `/login`).
- **(d) Playwright perf APIs** — no first-class LCP. Insufficient alone.
- **(b)** — built into `@playwright/test`, reuses auth + prod webServer, reads the last buffered LCP candidate after a deterministic settle. **Chosen.**

## Two load-bearing correctness points
1. **MUST set `test.use({ storageState: OWNER.statePath })`** — else `/dashboard` redirects to `/login` and the test silently measures the login page (green gate testing nothing).
2. **CPU throttle via CDP before `goto`** — unthrottled localhost lands ~100-400ms, so a `<2000ms` gate catches nothing. `Emulation.setCPUThrottlingRate {rate:4}`. The gate is then a **regression ceiling relative to the runner's CPU**, not a field-LCP predictor (different machines → different absolute numbers).

## Implementation facts
- Read LCP = the LAST buffered `largest-contentful-paint` entry's `startTime`, with `buffered:true`; settle via `requestIdleCallback` + raf + short timeout. No interaction/hide needed for a controlled load.
- **Prod build only** — never `next dev` (unminified, JIT-compiled, dev-mode React → meaningless). Harness already correct (`reuseExistingServer:false`).
- **Median of N samples** (discard warm-up run 0; 4-5 samples; sort; assert median). Playwright won't aggregate — loop in-test. `workers:1` required (parallel contention inflates LCP).
- **No `/dashboard/analytics` route exists** — use `/dashboard` or `/dashboard/ads` as the measured route. (Phase 9 adds the analytics surface — gate the new route once it exists.)
- Drop-in file: `e2e/lcp.spec.ts`. Packages needed: **none** (PerformanceObserver + CDP built into Playwright ^1.60).

## Snippet (recommended)
```ts
import { test, expect, type Page } from "@playwright/test";
import { OWNER } from "./fixtures";
test.use({ storageState: OWNER.statePath });
const ROUTE = "/dashboard"; const LCP_BUDGET_MS = 2000; const SAMPLES = 5;

async function measureLcp(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => {
    let last = 0;
    new PerformanceObserver((list) => {
      const e = list.getEntries(); last = e[e.length - 1].startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    const finish = () => requestAnimationFrame(() => setTimeout(() => resolve(last), 200));
    if ("requestIdleCallback" in window) window.requestIdleCallback(finish, { timeout: 1000 });
    else setTimeout(finish, 500);
  }));
}

test("dashboard LCP under budget (throttled)", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const lcp = await measureLcp(page);
    if (i > 0) samples.push(lcp);
    await page.goto("about:blank");
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  expect(median).toBeLessThan(LCP_BUDGET_MS);
});
```

## Pitfalls
- LCP candidates stop after first user interaction; observer-last-candidate avoids needing interaction/hide.
- Headless vs headed differ — pin one mode, calibrate threshold to it.
- Don't blindly adopt Lighthouse "mobile" (4x CPU + Slow 4G) — a real Supabase dashboard can exceed 2s on Slow 4G → instantly-red flaky gate. Start CPU-only 4x, add network shaping only if baseline stays well under.
- Field "good" LCP = <2.5s p75 (real devices); our `<2000ms` throttled-localhost gate is a stricter internal regression budget measuring a different thing. For field LCP use CrUX/RUM, not this.

## Phase-9 application
- Add `e2e/lcp.spec.ts` in 09-02 once the analytics surface route exists; gate that route (and/or `/dashboard`). CPU throttle 4x, median-of-4, budget 2000ms. Zero new dep.
