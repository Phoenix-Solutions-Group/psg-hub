// Wave 1A / PSG-236 — Persist a finished SitemapPackage to `research_artifacts`.
//
// The `research_artifacts` table is default-deny RLS (no authenticated SELECT policy);
// only the service-role client reads/writes it, and the /ops/sitemap route is superadmin-
// gated. We scope each row to a shop via `data->>'shop_id'` (the task's chosen key) rather
// than the legacy `campaign_id` join, so a shop with no campaign row can still own a sitemap.
// `artifact_type = 'sitemap_package'` (added to the CHECK constraint in the companion
// migration) and `source_skill = 'sitemap-maker'`.
//
// The Supabase client is INJECTED (mirrors intel/report/run.ts) so this stays node-testable
// against a mock — no `server-only`, no direct client construction here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildArtifacts, type SitemapArtifacts } from "./artifacts";
import type { SitemapPackage } from "./types";

export const SITEMAP_ARTIFACT_TYPE = "sitemap_package";
export const SITEMAP_SOURCE_SKILL = "sitemap-maker";

/** The jsonb `data` payload shape. `shop_id` is the load-bearing scoping key. */
export type SitemapArtifactData = {
  shop_id: string;
  generated_at: string;
  business_name: string;
  vertical: SitemapPackage["vertical"];
  package: SitemapPackage;
  artifacts: SitemapArtifacts;
};

export type PersistSitemapOptions = {
  /** Optional legacy campaign linkage (kept for cross-module joins; not required). */
  campaignId?: string | null;
  /** Optional storage path if the rendered deliverable was uploaded. */
  filePath?: string | null;
};

export type PersistedSitemap = {
  id: string;
  shopId: string;
  createdAt: string;
};

/**
 * Write a finished package (with its four derived artifacts) for `shopId`. Caller must
 * pass a service-role client. Returns the new row id. Throws on DB error (fail-loud:
 * a silent persistence failure would lose a client deliverable).
 */
export async function persistSitemapPackage(
  service: SupabaseClient,
  shopId: string,
  pkg: SitemapPackage,
  opts: PersistSitemapOptions = {},
): Promise<PersistedSitemap> {
  if (!shopId) throw new Error("persistSitemapPackage: shopId is required for tenant scoping");

  const data: SitemapArtifactData = {
    shop_id: shopId,
    generated_at: pkg.generatedAt,
    business_name: pkg.brief.businessName,
    vertical: pkg.vertical,
    package: pkg,
    artifacts: buildArtifacts(pkg),
  };

  const { data: row, error } = await service
    .from("research_artifacts")
    .insert({
      campaign_id: opts.campaignId ?? null,
      artifact_type: SITEMAP_ARTIFACT_TYPE,
      source_skill: SITEMAP_SOURCE_SKILL,
      data,
      file_path: opts.filePath ?? null,
    })
    .select("id, created_at")
    .single();

  if (error) throw new Error(`persistSitemapPackage: insert failed — ${error.message}`);
  return { id: row.id as string, shopId, createdAt: row.created_at as string };
}

export type SitemapArtifactRow = {
  id: string;
  createdAt: string;
  filePath: string | null;
  data: SitemapArtifactData;
};

/**
 * Load all sitemap packages for one shop, newest first. Scopes by `data->>'shop_id'`
 * — the tenant-isolation boundary enforced here in code AND by RLS (service-role only).
 * Caller must pass a service-role client.
 */
export async function loadSitemapPackages(
  service: SupabaseClient,
  shopId: string,
): Promise<SitemapArtifactRow[]> {
  if (!shopId) return [];
  const { data, error } = await service
    .from("research_artifacts")
    .select("id, created_at, file_path, data")
    .eq("artifact_type", SITEMAP_ARTIFACT_TYPE)
    .eq("data->>shop_id", shopId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`loadSitemapPackages: query failed — ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    filePath: (r.file_path as string | null) ?? null,
    data: r.data as SitemapArtifactData,
  }));
}
