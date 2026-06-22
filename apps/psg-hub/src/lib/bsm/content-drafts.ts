// BSM Phase 0 / PSG-194 (Child B) — persist gated Content Writer drafts into
// content_items.
//
// PSG-193 produced the content half: nine shipped GatedDrafts + three
// VerifiedFacts records (src/lib/agent-engine/__fixtures__/bsm-drafts.ts, via
// gateAllBsmDrafts()). This module owns the DB write half: shape each gated
// asset into a content_items `draft` row (status='draft', claims_manifest +
// claim_integrity_verdict populated) through the single toContentItemDraft
// chokepoint, then insert idempotently.
//
// SCHEMA REALITY: content_items has NOT NULL FKs shop_id→shops and
// location_id→locations, so the symbolic shop ids the fixture carries
// ("shop-tracys" / "shop-tedesco" / "shop-wallace") MUST be resolved to the
// real shop + primary-location UUIDs before a row can land. The caller supplies
// that resolver at run time against the target env — none of these 3 shops is
// fully materialized in prod yet (no Tedesco row; verified_facts unapplied), so
// the live write is env-coordinated with Ada (preview/non-prod first).
//
// RLS POSTURE: content_items is shop-scoped, default-deny. The caller passes a
// service-role client AFTER establishing it is operating on behalf of the right
// tenant; this module never widens RLS.
//
// IDEMPOTENCY (non-negotiable import gate): re-running the persist is safe — a
// draft is keyed by (shop_id, type, title) and skipped if a content_items row
// for that slot already exists, so a retry never double-inserts the 9 drafts.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toContentItemDraft,
  type ContentItemDraft,
  type GatedAsset,
} from "@/lib/agent-engine";

const CONTENT_ITEMS = "content_items";

/** Real shop + primary-location UUIDs a symbolic fixture shop id resolves to. */
export type ResolvedShop = { shopId: string; locationId: string };

/**
 * Maps a fixture's symbolic shop id (e.g. "shop-tracys") to the real shop +
 * location UUIDs in the target env. Returns null when the shop is not
 * materialized there (e.g. no Tedesco row yet) — that draft is reported as
 * `failed`, never silently dropped.
 */
export type ShopResolver = (symbolicShopId: string) => ResolvedShop | null;

/** One gated draft to persist: a shipped asset + its provenance key/shopId. */
export type PersistableDraft = {
  key: string;
  shopId: string;
  gated: GatedAsset;
  shipped: boolean;
};

export type PersistOptions = {
  /** ISO timestamp stamped into claim_integrity_checked_at. */
  checkedAt: string;
};

export type PersistOutcome =
  | { key: string; status: "inserted"; id: string }
  | { key: string; status: "skipped"; id: string; reason: string }
  | { key: string; status: "failed"; reason: string };

export type PersistSummary = {
  inserted: number;
  skipped: number;
  failed: number;
  outcomes: PersistOutcome[];
};

/**
 * Map a (real-id) ContentItemDraft into the snake_case content_items insert row.
 * Pure — exported for unit tests. status is always 'draft' (the persistence
 * entry point); the approved→published gate (PSG-194 route + trigger) governs
 * every later transition.
 */
export function toContentItemRow(
  draft: ContentItemDraft,
  checkedAt: string,
): Record<string, unknown> {
  return {
    shop_id: draft.shopId,
    location_id: draft.locationId,
    type: draft.type,
    title: draft.title,
    body: draft.body,
    status: draft.status,
    claims_manifest: draft.claimsManifest,
    claim_integrity_verdict: draft.claimIntegrityVerdict,
    claim_integrity_checked_at: checkedAt,
  };
}

/**
 * Return the existing content_items id for a (shop_id, type, title) slot, or
 * null. Handles a null title (meta_description) with `.is`, since SQL equality
 * never matches NULL.
 */
async function findExistingSlot(
  client: SupabaseClient,
  shopId: string,
  type: string,
  title: string | null,
): Promise<string | null> {
  let q = client
    .from(CONTENT_ITEMS)
    .select("id")
    .eq("shop_id", shopId)
    .eq("type", type);
  q = title === null ? q.is("title", null) : q.eq("title", title);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    throw new Error(`content-drafts: slot lookup failed: ${error.message}`);
  }
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Persist the nine gated BSM drafts into content_items as `draft` rows,
 * idempotently. Never persists a non-ship asset (toContentItemDraft throws on
 * one; we also pre-filter so a non-ship draft is reported, not thrown past the
 * batch). The caller supplies a service-role client + a shop resolver for the
 * target env.
 */
export async function persistBsmDrafts(
  client: SupabaseClient,
  drafts: PersistableDraft[],
  resolve: ShopResolver,
  opts: PersistOptions,
): Promise<PersistSummary> {
  const outcomes: PersistOutcome[] = [];

  for (const d of drafts) {
    // 1. Never persist an asset that did not clear the trust gate.
    if (!d.shipped) {
      outcomes.push({ key: d.key, status: "failed", reason: "asset is not shipped (claim-integrity)" });
      continue;
    }

    // 2. Resolve symbolic shop id -> real shop + location.
    const resolved = resolve(d.shopId);
    if (!resolved) {
      outcomes.push({ key: d.key, status: "failed", reason: `no shop mapping for '${d.shopId}' in target env` });
      continue;
    }

    // 3. Shape through the single chokepoint, substituting the real shop id
    //    (the fixture carries a symbolic one; locationId comes from resolve()).
    let row: Record<string, unknown>;
    try {
      const base = toContentItemDraft(d.gated, resolved.locationId);
      row = toContentItemRow({ ...base, shopId: resolved.shopId }, opts.checkedAt);
    } catch (e) {
      outcomes.push({ key: d.key, status: "failed", reason: (e as Error).message });
      continue;
    }

    // 4. Idempotency: skip if a row already occupies this (shop, type, title) slot.
    try {
      const existingId = await findExistingSlot(
        client,
        resolved.shopId,
        row.type as string,
        row.title as string | null,
      );
      if (existingId) {
        outcomes.push({ key: d.key, status: "skipped", id: existingId, reason: "slot already persisted" });
        continue;
      }

      const { data, error } = await client
        .from(CONTENT_ITEMS)
        .insert(row)
        .select("id")
        .single();
      if (error) {
        outcomes.push({ key: d.key, status: "failed", reason: error.message });
        continue;
      }
      outcomes.push({ key: d.key, status: "inserted", id: (data as { id: string }).id });
    } catch (e) {
      outcomes.push({ key: d.key, status: "failed", reason: (e as Error).message });
    }
  }

  return {
    inserted: outcomes.filter((o) => o.status === "inserted").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}
