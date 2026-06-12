import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PsiResult, GtmetrixResult } from "@/lib/analytics/types";
import { syncPerformance, reportMonth, toHttpsUrl } from "@/lib/perf/perf-sync";

function psi(score: number): PsiResult {
  return {
    perf_score: score,
    lab_lcp_ms: 3000,
    lab_cls: 0.05,
    lab_tbt_ms: 200,
    lab_fcp_ms: 1500,
    lab_speed_index_ms: 4000,
    lab_ttfb_ms: 500,
    field: null,
    origin_field: false,
  };
}
function gtmetrix(): GtmetrixResult {
  return {
    fully_loaded_time: 5000,
    onload_time: null,
    time_to_first_byte: 480,
    backend_duration: 360,
    page_bytes: 2_000_000,
    html_bytes: null,
    page_requests: 70,
    redirect_duration: null,
    connect_duration: null,
    largest_contentful_paint: 3100,
    total_blocking_time: 220,
    cumulative_layout_shift: 0.04,
    speed_index: null,
    time_to_interactive: null,
    gtmetrix_grade: "B",
    gtmetrix_score: null,
    performance_score: 84,
    structure_score: 91,
  };
}

type ShopRow = { id: string; url: string | null };

function makeService(opts: { shops?: ShopRow[]; shopsError?: { message: string } }) {
  const calls = {
    ledgerInserts: [] as unknown[],
    ledgerUpdates: [] as { patch: Record<string, unknown> }[],
    upserts: [] as { rows: unknown[] }[],
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "analytics_sync_runs") {
        return {
          insert: vi.fn((row: unknown) => {
            calls.ledgerInserts.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: "run-1" }, error: null }),
              }),
            };
          }),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: async () => {
              calls.ledgerUpdates.push({ patch });
              return { error: null };
            },
          })),
        };
      }
      if (table === "shops") {
        return {
          select: async () =>
            opts.shopsError
              ? { data: null, error: opts.shopsError }
              : { data: opts.shops ?? [], error: null },
        };
      }
      if (table === "analytics_snapshots") {
        return {
          upsert: async (rows: unknown[]) => {
            calls.upserts.push({ rows });
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("toHttpsUrl", () => {
  it("prepends https:// for a bare domain and passes a full url through; null for empty", () => {
    expect(toHttpsUrl("wallacecollisionrepair.com")).toBe("https://wallacecollisionrepair.com");
    expect(toHttpsUrl("http://x.com")).toBe("http://x.com");
    expect(toHttpsUrl("  ")).toBeNull();
    expect(toHttpsUrl(null)).toBeNull();
  });
});

describe("reportMonth", () => {
  it("prefers month override, else the month containing today", () => {
    expect(reportMonth({ month: "2026-05" })).toBe("2026-05");
    expect(reportMonth({ today: "2026-06-11" })).toBe("2026-06");
  });
});

describe("syncPerformance", () => {
  it("writes ONE monthly performance row per url-bearing shop (date=YYYY-MM-01); url-less SKIPPED", async () => {
    const { client, calls } = makeService({
      shops: [
        { id: "s1", url: "wallacecollisionrepair.com" },
        { id: "s2", url: null }, // skipped
      ],
    });
    const fetchPsiFn = vi.fn(async () => psi(62));
    const res = await syncPerformance(client, {
      month: "2026-06",
      fetchPsiFn: fetchPsiFn as never,
    });

    expect(res).toEqual({ synced: 1, skipped: 1, failed: 0 });
    expect(fetchPsiFn).toHaveBeenCalledTimes(1);
    expect(calls.upserts[0].rows).toHaveLength(1);
    expect(calls.upserts[0].rows[0]).toMatchObject({
      shop_id: "s1",
      source: "performance",
      period: "monthly",
      date: "2026-06-01",
    });
    // gtmetrix omitted when no fetchGtmetrixFn and no env key
    const row = calls.upserts[0].rows[0] as { metrics: { gtmetrix: unknown; strategy: string } };
    expect(row.metrics.gtmetrix).toBeNull();
    expect(row.metrics.strategy).toBe("mobile");
    expect(calls.ledgerInserts[0]).toMatchObject({ source: "performance" });
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("success");
  });

  it("runs GTMetrix when injected and bounds it with gtmetrixShopLimit (PSI for all)", async () => {
    const { client, calls } = makeService({
      shops: [
        { id: "s1", url: "a.com" },
        { id: "s2", url: "b.com" },
      ],
    });
    const fetchPsiFn = vi.fn(async () => psi(70));
    const fetchGtmetrixFn = vi.fn(async () => gtmetrix());
    const res = await syncPerformance(client, {
      month: "2026-06",
      fetchPsiFn: fetchPsiFn as never,
      fetchGtmetrixFn: fetchGtmetrixFn as never,
      gtmetrixShopLimit: 1, // only the first url-shop gets GTMetrix
    });

    expect(res.synced).toBe(2);
    expect(fetchPsiFn).toHaveBeenCalledTimes(2); // PSI for all
    expect(fetchGtmetrixFn).toHaveBeenCalledTimes(1); // bounded to 1
    const rows = calls.upserts[0].rows as { metrics: { gtmetrix: unknown } }[];
    expect(rows[0].metrics.gtmetrix).not.toBeNull();
    expect(rows[1].metrics.gtmetrix).toBeNull();
  });

  it("keeps the PSI floor row when the optional GTMetrix call fails (degrades to lab-only, counts synced)", async () => {
    const { client, calls } = makeService({ shops: [{ id: "s1", url: "a.com" }] });
    const fetchPsiFn = vi.fn(async () => psi(55));
    const fetchGtmetrixFn = vi.fn(async () => {
      throw new Error("gtmetrix poll timeout after 20 polls");
    });
    const res = await syncPerformance(client, {
      month: "2026-06",
      fetchPsiFn: fetchPsiFn as never,
      fetchGtmetrixFn: fetchGtmetrixFn as never,
    });
    // PSI succeeded -> the shop is synced, not failed; gtmetrix degrades to null.
    expect(res).toEqual({ synced: 1, skipped: 0, failed: 0 });
    const row = calls.upserts[0].rows[0] as { metrics: { psi: { perf_score: number }; gtmetrix: unknown } };
    expect(row.metrics.psi.perf_score).toBe(55);
    expect(row.metrics.gtmetrix).toBeNull();
  });

  it("contains a per-shop failure and still closes the ledger success", async () => {
    const { client, calls } = makeService({
      shops: [
        { id: "s1", url: "a.com" },
        { id: "s2", url: "b.com" },
      ],
    });
    const fetchPsiFn = vi.fn(async (url: string) => {
      if (url.includes("a.com")) throw new Error("PSI 500");
      return psi(50);
    });
    const res = await syncPerformance(client, {
      month: "2026-06",
      fetchPsiFn: fetchPsiFn as never,
    });
    expect(res).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("success");
  });

  it("is a designed NO-OP (no ledger) when PSI is unconfigured", async () => {
    const prior = process.env.PAGESPEED_API_KEY;
    try {
      delete process.env.PAGESPEED_API_KEY;
      const { client, calls } = makeService({ shops: [{ id: "s1", url: "a.com" }] });
      const res = await syncPerformance(client, { month: "2026-06" }); // no fetchPsiFn seam
      expect(res).toEqual({ synced: 0, skipped: 0, failed: 0 });
      expect(calls.ledgerInserts).toHaveLength(0); // no torn ledger
    } finally {
      if (prior === undefined) delete process.env.PAGESPEED_API_KEY;
      else process.env.PAGESPEED_API_KEY = prior;
    }
  });

  it("closes the ledger error and rethrows on a shops-read failure", async () => {
    const { client, calls } = makeService({ shopsError: { message: "db down" } });
    await expect(
      syncPerformance(client, { month: "2026-06", fetchPsiFn: (async () => psi(1)) as never })
    ).rejects.toThrow(/db down/);
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("error");
  });
});
