import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runShopAudit,
  getLatestShopAudit,
  shopRowToBrief,
  ShopAuditPersistError,
} from "../run";
import type { CrawledPage, SiteCrawlProvider } from "../index";

const T = "2026-06-23T12:00:00.000Z";

type ShopRow = {
  id: string;
  name: string | null;
  url: string | null;
  address_locality: string | null;
  address_region: string | null;
};

/**
 * Minimal chainable Supabase mock. `shopRow` feeds the shops read; `inserted`
 * captures the audit-history insert; `latest` feeds getLatestShopAudit.
 */
function mockService(opts: {
  shopRow?: ShopRow | null;
  shopError?: boolean;
  insertId?: string | null;
  insertError?: boolean;
  latest?: { report: unknown; generated_at: string } | null;
}): { service: SupabaseClient; inserted: { value: Record<string, unknown> | null } } {
  const inserted = { value: null as Record<string, unknown> | null };

  const service = {
    from(table: string) {
      if (table === "shops") {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                opts.shopError
                  ? { data: null, error: { message: "boom" } }
                  : { data: opts.shopRow ?? null, error: opts.shopRow ? null : { message: "not found" } },
            }),
          }),
        };
      }
      // shop_seo_audits
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.value = row;
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: { message: "insert failed" } }
                  : { data: { id: opts.insertId ?? "audit-1" }, error: null },
            }),
          };
        },
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: opts.latest ?? null, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;

  return { service, inserted };
}

const fakeCrawl = (pages: CrawledPage[]): SiteCrawlProvider => ({
  name: "fake",
  crawl: async () => pages,
});

describe("shopRowToBrief", () => {
  it("maps a shops row into a collision-vertical brief", () => {
    const b = shopRowToBrief({
      id: "s1",
      name: "Tracy's",
      url: "tracys.com",
      address_locality: "Lincoln",
      address_region: "NE",
    });
    expect(b.shopId).toBe("s1");
    expect(b.domain).toBe("tracys.com");
    expect(b.vertical).toBe("collision_repair");
    expect(b.locations[0]).toMatchObject({ city: "Lincoln", state: "NE" });
  });

  it("defaults missing name/domain and drops empty location", () => {
    const b = shopRowToBrief({ id: "s1", name: null, url: null, address_locality: null, address_region: null });
    expect(b.businessName).toBe("Your shop");
    expect(b.domain).toBeNull();
    expect(b.locations).toEqual([]);
  });
});

describe("runShopAudit", () => {
  it("audited run: crawls, builds, persists, returns html + auditId", async () => {
    const { service, inserted } = mockService({
      shopRow: { id: "s1", name: "Tracy's", url: "tracys.com", address_locality: "Lincoln", address_region: "NE" },
      insertId: "audit-9",
    });
    const provider = fakeCrawl([
      { url: "https://tracys.com/", title: "A nice long homepage title", statusCode: 200, wordCount: 700, h1Count: 1, metaDescription: "ok" },
      { url: "https://tracys.com/bad", statusCode: 404 },
    ]);
    const { report, html, auditId } = await runShopAudit({ service, shopId: "s1", userId: "u1", crawlProvider: provider, now: T });
    expect(report.mode).toBe("audited");
    expect(report.summary.improveCount).toBe(1);
    expect(auditId).toBe("audit-9");
    expect(html).toContain("Tracy");
    // persisted row carries the denormalized columns
    expect(inserted.value).toMatchObject({
      shop_id: "s1",
      mode: "audited",
      audit_status: "completed",
      audit_outcome: "audited",
      error_reason: null,
      created_by: "u1",
      generated_at: T,
    });
  });

  it("greenfield run: no domain ⇒ queryable no-live-site outcome, no crawl call", async () => {
    const crawl = vi.fn(async () => []);
    const { service, inserted } = mockService({
      shopRow: { id: "s1", name: "New Shop", url: null, address_locality: "Omaha", address_region: "NE" },
    });
    const { report } = await runShopAudit({
      service,
      shopId: "s1",
      crawlProvider: { name: "fake", crawl },
      now: T,
    });
    expect(report.mode).toBe("greenfield");
    expect(crawl).not.toHaveBeenCalled();
    expect(inserted.value).toMatchObject({
      audit_status: "completed",
      audit_outcome: "no_live_site",
      error_reason: null,
    });
  });

  it("crawl failure degrades to greenfield and stores a failed outcome", async () => {
    const { service, inserted } = mockService({
      shopRow: { id: "s1", name: "Tracy's", url: "tracys.com", address_locality: "Lincoln", address_region: "NE" },
    });
    const provider: SiteCrawlProvider = {
      name: "boom",
      crawl: async () => {
        throw new Error("network down");
      },
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { report } = await runShopAudit({ service, shopId: "s1", crawlProvider: provider, now: T });
    expect(report.mode).toBe("greenfield");
    expect(inserted.value).toMatchObject({
      audit_status: "failed",
      audit_outcome: "crawl_failed",
      error_reason: "network down",
    });
    errSpy.mockRestore();
  });

  it("throws when the shop is not found (fail-closed)", async () => {
    const { service } = mockService({ shopRow: null });
    await expect(runShopAudit({ service, shopId: "missing", now: T })).rejects.toThrow(/not found/);
  });

  it("persist=false skips the insert", async () => {
    const { service, inserted } = mockService({
      shopRow: { id: "s1", name: "Tracy's", url: "tracys.com", address_locality: "Lincoln", address_region: "NE" },
    });
    const { auditId } = await runShopAudit({
      service,
      shopId: "s1",
      crawlProvider: fakeCrawl([]),
      now: T,
      persist: false,
    });
    expect(auditId).toBeNull();
    expect(inserted.value).toBeNull();
  });

  it("insert failure fails closed so callers cannot imply the audit was saved", async () => {
    const { service } = mockService({
      shopRow: { id: "s1", name: "Tracy's", url: "tracys.com", address_locality: "Lincoln", address_region: "NE" },
      insertError: true,
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runShopAudit({ service, shopId: "s1", crawlProvider: fakeCrawl([]), now: T }),
    ).rejects.toBeInstanceOf(ShopAuditPersistError);
    errSpy.mockRestore();
  });
});

describe("getLatestShopAudit", () => {
  it("returns the latest stored report or null", async () => {
    const report = { shopId: "s1", mode: "audited" };
    const { service } = mockService({ latest: { report, generated_at: T } });
    const got = await getLatestShopAudit(service, "s1");
    expect(got).toEqual({ report, generatedAt: T });

    const { service: empty } = mockService({ latest: null });
    expect(await getLatestShopAudit(empty, "s1")).toBeNull();
  });
});
