import { describe, it, expect, vi, beforeEach } from "vitest";

// psiConfigured (perf gate) and reportPipelineConfigured (monthly-report gate) are read
// directly by the dispatcher (not injected). Mock them so the monthly path is hermetic.
let psiOk = true;
let reportOk = true;
vi.mock("@/lib/perf/psi", () => ({ psiConfigured: () => psiOk }));
vi.mock("@/lib/report/run-cron", () => ({ reportPipelineConfigured: () => reportOk }));

import {
  runManualSync,
  DAILY_SOURCES,
  type ManualSyncDeps,
} from "@/lib/analytics/manual-sync";

const SERVICE = {} as never;

// Full google + semrush creds -> every daily/monthly config gate passes by default.
const FULL_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI: "https://app/redirect",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  SEMRUSH_API_KEY: "semrush-key",
};

/** Build deps whose sync fns record their call order and return a fixed SyncResult. */
function makeDeps(
  env: NodeJS.ProcessEnv = FULL_ENV,
  overrides: Partial<ManualSyncDeps> = {}
): { deps: ManualSyncDeps; order: string[] } {
  const order: string[] = [];
  const rec = (name: string, synced: number) => async () => {
    order.push(name);
    return { synced, skipped: 1, failed: 0 };
  };
  const deps: ManualSyncDeps = {
    syncGa4: rec("ga4", 10),
    syncGsc: rec("gsc", 20),
    syncGbp: rec("gbp", 30),
    syncGbpReviews: rec("gbp_reviews", 40),
    syncGoogleAds: rec("google_ads", 50),
    syncSemrush: async () => {
      order.push("semrush");
      return { synced: 60, skipped: 0, failed: 0 };
    },
    syncGa4Dims: async () => {
      order.push("ga4-dims");
      return { synced: 70, skipped: 0, failed: 0 };
    },
    syncPerf: async () => {
      order.push("perf");
      return { synced: 80, skipped: 0, failed: 0 };
    },
    syncGbpPresence: async () => {
      order.push("gbp-presence");
      return { synced: 90, skipped: 0, failed: 0 };
    },
    runMonthlyReport: async () => {
      order.push("monthly-report");
      return { period: "2026-06", counts: { sent: 3, skipped: 1, held: 0, failed: 0 }, results: [] };
    },
    env,
    nowMonth: "2026-07",
    ...overrides,
  };
  return { deps, order };
}

beforeEach(() => {
  psiOk = true;
  reportOk = true;
});

describe("runManualSync — daily", () => {
  it("runs all six sources in order when source='all'", async () => {
    const { deps, order } = makeDeps();
    const res = await runManualSync(SERVICE, { cadence: "daily", source: "all" }, deps);

    expect(res.cadence).toBe("daily");
    expect(res.scope).toBe("fleet");
    expect(order).toEqual([...DAILY_SOURCES]);
    expect(res.results.map((r) => r.source)).toEqual([...DAILY_SOURCES]);
    expect(res.results.every((r) => r.status === "success")).toBe(true);
    // rows_written comes from each fn's `synced`.
    expect(res.results.find((r) => r.source === "ga4")?.rows_written).toBe(10);
    expect(res.results.find((r) => r.source === "semrush")?.rows_written).toBe(60);
  });

  it("defaults to all sources when source omitted", async () => {
    const { deps, order } = makeDeps();
    await runManualSync(SERVICE, { cadence: "daily" }, deps);
    expect(order).toEqual([...DAILY_SOURCES]);
  });

  it("runs only the selected single source", async () => {
    const { deps, order } = makeDeps();
    const res = await runManualSync(SERVICE, { cadence: "daily", source: "semrush" }, deps);
    expect(order).toEqual(["semrush"]);
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ source: "semrush", status: "success", rows_written: 60 });
  });

  it("skips an unconfigured source without calling its sync fn", async () => {
    // No SEMRUSH_API_KEY -> semrush is not configured.
    const env = { ...FULL_ENV };
    delete env.SEMRUSH_API_KEY;
    const semrush = vi.fn(async () => ({ synced: 60, skipped: 0, failed: 0 }));
    const { deps } = makeDeps(env, { syncSemrush: semrush });

    const res = await runManualSync(SERVICE, { cadence: "daily", source: "semrush" }, deps);
    expect(semrush).not.toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({
      source: "semrush",
      status: "skipped",
      error: "not_configured",
      rows_written: 0,
    });
  });

  it("skips google_ads when the developer token is absent", async () => {
    const env = { ...FULL_ENV };
    delete env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const { deps } = makeDeps(env);
    const res = await runManualSync(SERVICE, { cadence: "daily", source: "google_ads" }, deps);
    expect(res.results[0]).toMatchObject({ source: "google_ads", status: "skipped" });
  });

  it("captures a thrown error and continues the remaining sources", async () => {
    const { deps, order } = makeDeps(FULL_ENV, {
      syncGsc: async () => {
        throw new Error("gsc boom");
      },
    });
    const res = await runManualSync(SERVICE, { cadence: "daily", source: "all" }, deps);

    // gsc errored but every other source still ran.
    expect(order).toEqual(["ga4", "gbp", "gbp_reviews", "google_ads", "semrush"]);
    const gsc = res.results.find((r) => r.source === "gsc");
    expect(gsc).toMatchObject({ status: "error", rows_written: 0, error: "gsc boom" });
    expect(res.results.filter((r) => r.status === "success")).toHaveLength(5);
  });
});

describe("runManualSync — monthly", () => {
  it("runs the four monthly steps in order and targets prior month", async () => {
    // Use the order-recording default runMonthlyReport (sent: 3).
    const { deps, order } = makeDeps();
    const res = await runManualSync(SERVICE, { cadence: "monthly" }, deps);

    expect(order).toEqual(["ga4-dims", "perf", "gbp-presence", "monthly-report"]);
    expect(res.period).toBe("2026-06"); // priorMonth("2026-07")
    const rep = res.results.find((r) => r.source === "monthly-report");
    expect(rep).toMatchObject({ status: "success", rows_written: 3 });
    expect(rep?.detail).toMatchObject({ sent: 3, skipped: 1, held: 0, failed: 0 });
  });

  it("honors an explicit period and force for the report", async () => {
    const report = vi.fn(async () => ({
      period: "2026-07",
      counts: { sent: 1, skipped: 0, held: 0, failed: 0 },
      results: [],
    }));
    const { deps } = makeDeps(FULL_ENV, { runMonthlyReport: report });
    const res = await runManualSync(
      SERVICE,
      { cadence: "monthly", period: "2026-07", force: true },
      deps
    );
    expect(res.period).toBe("2026-07");
    expect(report).toHaveBeenCalledWith(SERVICE, { force: true, period: "2026-07" });
  });

  it("skips monthly-report when the pipeline is not configured", async () => {
    reportOk = false;
    const report = vi.fn();
    const { deps } = makeDeps(FULL_ENV, { runMonthlyReport: report as never });
    const res = await runManualSync(SERVICE, { cadence: "monthly" }, deps);
    expect(report).not.toHaveBeenCalled();
    expect(res.results.find((r) => r.source === "monthly-report")).toMatchObject({
      status: "skipped",
      error: "not_configured",
    });
  });

  it("surfaces a monthly-report per-shop failure instead of hiding it behind 0 rows", async () => {
    const report = vi.fn(async () => ({
      period: "2026-06",
      counts: { sent: 0, skipped: 0, held: 0, failed: 1 },
      results: [
        {
          shop: { id: "shop-1", name: "Wallace Collision", ownerEmail: "owner@example.com" },
          status: "failed" as const,
          error: "render worker responded 500",
        },
      ],
    }));
    const { deps } = makeDeps(FULL_ENV, { runMonthlyReport: report });
    const res = await runManualSync(SERVICE, { cadence: "monthly" }, deps);

    expect(res.results.find((r) => r.source === "monthly-report")).toMatchObject({
      status: "error",
      rows_written: 0,
      error: "1 report failed",
      detail: {
        sent: 0,
        skipped: 0,
        held: 0,
        failed: 1,
        results: [
          {
            shop: "Wallace Collision",
            status: "failed",
            error: "render worker responded 500",
          },
        ],
      },
    });
  });

  it("surfaces a held monthly report as an action-needed error", async () => {
    const report = vi.fn(async () => ({
      period: "2026-06",
      counts: { sent: 0, skipped: 0, held: 1, failed: 0 },
      results: [
        {
          shop: { id: "shop-1", name: "Wallace Collision", ownerEmail: "owner@example.com" },
          status: "held" as const,
        },
      ],
    }));
    const { deps } = makeDeps(FULL_ENV, { runMonthlyReport: report });
    const res = await runManualSync(SERVICE, { cadence: "monthly" }, deps);

    expect(res.results.find((r) => r.source === "monthly-report")).toMatchObject({
      status: "error",
      rows_written: 0,
      error: "1 report held for review",
    });
  });

  it("surfaces a fully skipped monthly report distinctly from success", async () => {
    const report = vi.fn(async () => ({
      period: "2026-06",
      counts: { sent: 0, skipped: 1, held: 0, failed: 0 },
      results: [
        {
          shop: { id: "shop-1", name: "Wallace Collision", ownerEmail: "owner@example.com" },
          status: "skipped" as const,
        },
      ],
    }));
    const { deps } = makeDeps(FULL_ENV, { runMonthlyReport: report });
    const res = await runManualSync(SERVICE, { cadence: "monthly" }, deps);

    expect(res.results.find((r) => r.source === "monthly-report")).toMatchObject({
      status: "skipped",
      rows_written: 0,
      error: "1 report skipped",
    });
  });

  it("skips perf when PSI is not configured", async () => {
    psiOk = false;
    const perf = vi.fn(async () => ({ synced: 80, skipped: 0, failed: 0 }));
    const { deps } = makeDeps(FULL_ENV, { syncPerf: perf });
    const res = await runManualSync(SERVICE, { cadence: "monthly" }, deps);
    expect(perf).not.toHaveBeenCalled();
    expect(res.results.find((r) => r.source === "perf")).toMatchObject({ status: "skipped" });
  });
});
