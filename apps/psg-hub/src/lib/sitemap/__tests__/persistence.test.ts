// Wave 1A / PSG-236 — research_artifacts persistence tests (mocked service client).
//
// Asserts the row shape (artifact_type, source_skill, shop_id in data jsonb), that the
// reader scopes by data->>'shop_id' + artifact_type, error fail-loud, and round-trip.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SITEMAP_ARTIFACT_TYPE,
  SITEMAP_SOURCE_SKILL,
  loadSitemapPackages,
  persistSitemapPackage,
} from "../persistence";
import { runSitemapPipeline, type CheckpointApproval, type CheckpointPayload, type ShopBrief, type SitemapPackage } from "../index";

const BRIEF: ShopBrief = {
  shopId: "shop-courtesy",
  businessName: "Courtesy Body Works",
  domain: "courtesybodyworks.com",
  vertical: "collision_repair",
  services: ["collision repair", "frame straightening"],
  locations: [{ city: "Lincoln", state: "NE", primary: true }],
  competitors: [],
};

async function buildPackage(): Promise<SitemapPackage> {
  const approve = async (p: CheckpointPayload): Promise<CheckpointApproval> => ({
    phase: p.phase,
    decision: "approved",
    approvedBy: "test",
    approvedAt: "2026-06-23T00:00:00.000Z",
  });
  const res = await runSitemapPipeline(BRIEF, { generatedAt: "2026-06-23T00:00:00.000Z", onCheckpoint: approve });
  if (res.status !== "complete") throw new Error("fixture pipeline did not complete");
  return res.package;
}

describe("persistSitemapPackage", () => {
  it("inserts a sitemap_package row with shop_id in the data jsonb", async () => {
    const pkg = await buildPackage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inserted: any = null;
    const single = vi.fn().mockResolvedValue({ data: { id: "row-1", created_at: "2026-06-23T01:00:00Z" }, error: null });
    const service = {
      from: vi.fn(() => ({
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return { select: () => ({ single }) };
        },
      })),
    } as unknown as SupabaseClient;

    const res = await persistSitemapPackage(service, "shop-courtesy", pkg, { campaignId: "camp-9" });
    expect(res).toEqual({ id: "row-1", shopId: "shop-courtesy", createdAt: "2026-06-23T01:00:00Z" });
    expect(inserted).toMatchObject({
      artifact_type: SITEMAP_ARTIFACT_TYPE,
      source_skill: SITEMAP_SOURCE_SKILL,
      campaign_id: "camp-9",
    });
    const data = inserted.data;
    expect(data.shop_id).toBe("shop-courtesy");
    expect(data.package.brief.businessName).toBe("Courtesy Body Works");
    expect(data.artifacts.pageInventoryCsv).toContain("path");
    expect(data.artifacts.sitemapMmd).toContain("graph TD");
  });

  it("requires a shopId for tenant scoping", async () => {
    const pkg = await buildPackage();
    await expect(persistSitemapPackage({} as SupabaseClient, "", pkg)).rejects.toThrow(/shopId is required/);
  });

  it("throws (fail-loud) when the insert errors", async () => {
    const pkg = await buildPackage();
    const service = {
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "boom" } }) }) }) }),
    } as unknown as SupabaseClient;
    await expect(persistSitemapPackage(service, "shop-courtesy", pkg)).rejects.toThrow(/insert failed — boom/);
  });
});

describe("loadSitemapPackages", () => {
  it("scopes by artifact_type and data->>shop_id, newest first", async () => {
    const filters: Array<[string, string]> = [];
    const order = vi.fn().mockResolvedValue({
      data: [{ id: "r1", created_at: "2026-06-23T02:00:00Z", file_path: null, data: { shop_id: "shop-courtesy" } }],
      error: null,
    });
    const eq2 = { order };
    const eq1 = { eq: (col: string, val: string) => { filters.push([col, val]); return eq2; } };
    const service = {
      from: vi.fn(() => ({ select: () => ({ eq: (col: string, val: string) => { filters.push([col, val]); return eq1; } }) })),
    } as unknown as SupabaseClient;

    const rows = await loadSitemapPackages(service, "shop-courtesy");
    expect(filters).toContainEqual(["artifact_type", SITEMAP_ARTIFACT_TYPE]);
    expect(filters).toContainEqual(["data->>shop_id", "shop-courtesy"]);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("r1");
  });

  it("returns [] for a blank shopId without querying", async () => {
    const from = vi.fn();
    expect(await loadSitemapPackages({ from } as unknown as SupabaseClient, "")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
