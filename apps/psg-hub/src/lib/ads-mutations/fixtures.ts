/**
 * v1.2 Ads Mutation Studio — build-local dry-run fixtures.
 *
 * PSG-26a is build-local: it surfaces the registry + a real before/after diff WITHOUT
 * the live Vercel Sandbox Python-worker (that path stays gated, see bridge.ts). To do
 * that honestly we ship one fixture per registered mutation: a realistic `before` state,
 * a sample `params` input, and a pure `apply(before, params) => after` transform that
 * mirrors what the shipped Python op would do. `preview.ts` runs the transform and diffs
 * before/after — no Python, no Sandbox, fully unit-testable. The transforms are
 * deliberately simple structural merges (not the real Google Ads/GTM API semantics); they
 * exist to drive the diff UI, and are replaced by the real bridge output once the gate clears.
 *
 * Invariant (asserted in tests): every key in MUTATION_REGISTRY has a fixture here.
 */
import type { Json } from "./preview";

export interface MutationFixture {
  /** Sample target (Google Ads customer id / GTM container public id). */
  targetRef: string;
  /** Sample params matching the registry param spec for this mutation. */
  params: Record<string, Json>;
  /** Realistic prior state the dry-run reads (the diff's "before"). */
  before: Json;
  /** Pure transform producing the post-mutation state (the diff's "after"). */
  apply: (before: Json, params: Record<string, Json>) => Json;
}

/** Narrow helper: treat an unknown json value as an array of records. */
function asRecords(v: Json): Record<string, Json>[] {
  return Array.isArray(v) ? (v as Record<string, Json>[]) : [];
}
function asRecord(v: Json): Record<string, Json> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

export const MUTATION_FIXTURES: Record<string, MutationFixture> = {
  // ── Google Ads ─────────────────────────────────────────────────────────────
  "google_ads.negative_keywords": {
    targetRef: "412-555-0142",
    params: {
      campaign_id: 200300400,
      negatives: [
        { text: "free", match_type: "BROAD" },
        { text: "diy", match_type: "PHRASE" },
      ],
    },
    before: {
      campaign_id: 200300400,
      negative_keywords: [{ text: "cheap", match_type: "BROAD" }],
    },
    apply(before, params) {
      const b = asRecord(before);
      const existing = asRecords(b.negative_keywords);
      const incoming = asRecords(params.negatives);
      const seen = new Set(existing.map((n) => `${n.text}|${n.match_type}`));
      const merged = [...existing];
      for (const n of incoming) {
        if (!seen.has(`${n.text}|${n.match_type}`)) merged.push(n);
      }
      return { ...b, negative_keywords: merged };
    },
  },

  "google_ads.assets": {
    targetRef: "412-555-0142",
    params: {
      asset_type: "sitelink",
      specs: [
        { link_text: "Schedule Estimate", final_url: "https://example.com/estimate" },
        { link_text: "Our Reviews", final_url: "https://example.com/reviews" },
      ],
    },
    before: { assets: [{ id: 9001, type: "sitelink", link_text: "Contact Us" }] },
    apply(before, params) {
      const b = asRecord(before);
      const existing = asRecords(b.assets);
      const assetType = String(params.asset_type ?? "asset");
      const created = asRecords(params.specs).map((spec, i) => ({
        id: `new-${i + 1}`,
        type: assetType,
        ...spec,
      }));
      return { ...b, assets: [...existing, ...created] };
    },
  },

  "google_ads.geo_targets": {
    targetRef: "412-555-0142",
    params: { campaign_id: 200300400, geo_target_ids: ["1014221", "1014895"] },
    before: { campaign_id: 200300400, location_target_ids: ["1014044"] },
    apply(before, params) {
      const b = asRecord(before);
      const existing = (Array.isArray(b.location_target_ids) ? b.location_target_ids : []) as Json[];
      const incoming = (Array.isArray(params.geo_target_ids) ? params.geo_target_ids : []) as Json[];
      const merged = [...existing];
      for (const id of incoming) if (!merged.includes(id)) merged.push(id);
      return { ...b, location_target_ids: merged };
    },
  },

  "google_ads.campaign_bidding": {
    targetRef: "412-555-0142",
    params: {
      changes: [{ campaign_id: 200300400, strategy: "MAXIMIZE_CONVERSIONS", target_cpa_micros: 45000000 }],
    },
    before: {
      campaigns: [
        { campaign_id: 200300400, strategy: "MANUAL_CPC", target_cpa_micros: null },
        { campaign_id: 200300401, strategy: "TARGET_ROAS", target_roas: 4.0 },
      ],
    },
    apply(before, params) {
      const b = asRecord(before);
      const campaigns = asRecords(b.campaigns);
      const changes = asRecords(params.changes);
      const next = campaigns.map((c) => {
        const ch = changes.find((x) => x.campaign_id === c.campaign_id);
        return ch ? { ...c, ...ch } : c;
      });
      return { ...b, campaigns: next };
    },
  },

  "google_ads.campaign_device_bids": {
    targetRef: "412-555-0142",
    params: { changes: [{ campaign_id: 200300400, device: "MOBILE", bid_modifier: 1.25 }] },
    before: {
      device_bid_modifiers: [
        { campaign_id: 200300400, device: "MOBILE", bid_modifier: 1.0 },
        { campaign_id: 200300400, device: "DESKTOP", bid_modifier: 1.0 },
      ],
    },
    apply(before, params) {
      const b = asRecord(before);
      const existing = asRecords(b.device_bid_modifiers);
      const changes = asRecords(params.changes);
      const next = existing.map((row) => {
        const ch = changes.find(
          (x) => x.campaign_id === row.campaign_id && x.device === row.device
        );
        return ch ? { ...row, bid_modifier: ch.bid_modifier } : row;
      });
      return { ...b, device_bid_modifiers: next };
    },
  },

  "google_ads.campaign_network": {
    targetRef: "412-555-0142",
    params: { changes: [{ campaign_id: 200300400, target_search_network: false }] },
    before: {
      campaigns: [
        {
          campaign_id: 200300400,
          target_google_search: true,
          target_search_network: true,
          target_content_network: false,
        },
      ],
    },
    apply(before, params) {
      const b = asRecord(before);
      const campaigns = asRecords(b.campaigns);
      const changes = asRecords(params.changes);
      const next = campaigns.map((c) => {
        const ch = changes.find((x) => x.campaign_id === c.campaign_id);
        return ch ? { ...c, ...ch } : c;
      });
      return { ...b, campaigns: next };
    },
  },

  "google_ads.conversion_actions": {
    targetRef: "412-555-0142",
    params: { changes: [{ conversion_action_id: 770001, counting_type: "ONE_PER_CLICK" }] },
    before: {
      conversion_actions: [
        { conversion_action_id: 770001, counting_type: "MANY_PER_CLICK", include_in_conversions: true },
      ],
    },
    apply(before, params) {
      const b = asRecord(before);
      const existing = asRecords(b.conversion_actions);
      const changes = asRecords(params.changes);
      const next = existing.map((row) => {
        const ch = changes.find((x) => x.conversion_action_id === row.conversion_action_id);
        return ch ? { ...row, ...ch } : row;
      });
      return { ...b, conversion_actions: next };
    },
  },

  "google_ads.customer_conversion_goals": {
    targetRef: "412-555-0142",
    params: { changes: [{ category: "SUBMIT_LEAD_FORM", origin: "WEBSITE", biddable: true }] },
    before: {
      conversion_goals: [
        { category: "SUBMIT_LEAD_FORM", origin: "WEBSITE", biddable: false },
        { category: "PURCHASE", origin: "WEBSITE", biddable: true },
      ],
    },
    apply(before, params) {
      const b = asRecord(before);
      const existing = asRecords(b.conversion_goals);
      const changes = asRecords(params.changes);
      const next = existing.map((g) => {
        const ch = changes.find((x) => x.category === g.category && x.origin === g.origin);
        return ch ? { ...g, biddable: ch.biddable } : g;
      });
      return { ...b, conversion_goals: next };
    },
  },

  // ── Google Tag Manager ─────────────────────────────────────────────────────
  "gtm.tag_paused": {
    targetRef: "GTM-PSG1234",
    params: { tag_name: "GA4 - Lead Submit", paused: true },
    before: {
      tags: [
        { name: "GA4 - Page View", paused: false },
        { name: "GA4 - Lead Submit", paused: false },
      ],
    },
    apply(before, params) {
      const b = asRecord(before);
      const tags = asRecords(b.tags);
      const next = tags.map((t) =>
        t.name === params.tag_name ? { ...t, paused: params.paused } : t
      );
      return { ...b, tags: next };
    },
  },

  "gtm.publish_version": {
    targetRef: "GTM-PSG1234",
    params: { notes: "Pause stale lead tag; add GA4 phone-click trigger." },
    before: { live_version: 7, version_notes: "Q1 baseline" },
    apply(before, params) {
      const b = asRecord(before);
      const current = typeof b.live_version === "number" ? b.live_version : 0;
      return { ...b, live_version: current + 1, version_notes: params.notes ?? null };
    },
  },
};

/** Look up a fixture by mutation key. */
export function getFixture(key: string): MutationFixture | undefined {
  return MUTATION_FIXTURES[key];
}
