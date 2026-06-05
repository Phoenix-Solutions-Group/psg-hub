import { test, expect, type Page } from "@playwright/test";
import { OWNER } from "./fixtures";

// 09-02: LCP regression gate (research/lcp-gating.md). Measures the prod build
// over the local stack with CPU throttled 4x via CDP. The throttled-localhost
// number is a REGRESSION CEILING relative to this runner — not a field-LCP
// predictor (field <2s p75 = CrUX/RUM, post-deploy, out of scope here).
//
// Budgets:
// - /dashboard: HARD 2000ms (the ROADMAP metric route; existing light page).
// - /dashboard/analytics: 4000ms ceiling + median logged — the recharts-heavy
//   route gets its hard 2000ms budget calibrated at 09-03 once real data +
//   final layout exist (medians recorded in the 09-02 SUMMARY for that).

// storageState is load-bearing: without auth these routes redirect to /login
// and the gate would greenly measure the wrong page.
test.use({ storageState: OWNER.statePath });

const SAMPLES = 5; // run 0 = warm-up, discarded -> median of 4
const ROUTES: { route: string; budgetMs: number; hard: boolean }[] = [
  { route: "/dashboard", budgetMs: 2000, hard: true },
  { route: "/dashboard/analytics", budgetMs: 4000, hard: false },
];

async function measureLcp(
  page: Page
): Promise<{ ms: number; element: string }> {
  return page.evaluate(
    () =>
      new Promise<{ ms: number; element: string }>((resolve) => {
        let last = 0;
        let element = "?";
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const e = entries[entries.length - 1] as PerformanceEntry & {
            element?: Element;
          };
          last = e.startTime;
          element = e.element
            ? `${e.element.tagName}:${(e.element.textContent ?? "").slice(0, 40)}`
            : "?";
        }).observe({ type: "largest-contentful-paint", buffered: true });
        const finish = () =>
          requestAnimationFrame(() =>
            setTimeout(() => resolve({ ms: last, element }), 200)
          );
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(finish, { timeout: 1000 });
        } else {
          setTimeout(finish, 500);
        }
      })
  );
}

for (const { route, budgetMs, hard } of ROUTES) {
  test(`LCP ${route} median < ${budgetMs}ms (4x CPU throttle${hard ? "" : ", calibration ceiling"})`, async ({
    page,
  }) => {
    // Throttle BEFORE any navigation — unthrottled localhost gates nothing.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    const samples: number[] = [];
    let lcpElement = "?";
    for (let i = 0; i < SAMPLES; i++) {
      await page.goto(route, { waitUntil: "networkidle" });
      const lcp = await measureLcp(page);
      if (i > 0) samples.push(lcp.ms); // discard warm-up run 0
      lcpElement = lcp.element;
      await page.goto("about:blank");
    }

    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    // The LCP element matters for what this gate guards: if it's streamed
    // server text (headline/KPI), the chart-island hydration cost is NOT
    // captured by this number — record it for the 09-03 calibration.
    console.log(
      `[lcp] ${route}: median=${Math.round(median)}ms samples=[${samples
        .map((s) => Math.round(s))
        .join(", ")}] budget=${budgetMs}ms element=${lcpElement}`
    );

    expect(median).toBeLessThan(budgetMs);
  });
}
