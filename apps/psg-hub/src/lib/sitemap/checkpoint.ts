// Wave 1A / PSG-258 — Resumable human checkpoint gate for the sitemap pipeline.
//
// The engine (pipeline.ts) calls `onCheckpoint(payload)` twice and blocks on a typed
// `CheckpointApproval`. A deployed HTTP request can't synchronously wait minutes/hours for
// a human, so we bind the gate to a POLL-BASED approval queue instead: each /ops/sitemap
// run advances as far as the recorded approvals allow, and STOPS cleanly at the first
// un-approved gate (the engine already returns `changes_requested` for any non-approved
// verdict). The route surfaces the pending queue item to the approver; once they approve
// (a row flips to `approved`), the next run re-executes deterministically, matches the same
// content hash, and proceeds past that gate to the next one.
//
// Determinism is what makes the poll-gate sound: pre-G5 with no live keyword seat, every
// stage is the zero-cost deterministic baseline (the LLM content-gap / cluster-refine seams
// degrade to null), so the clusters/package a run produces are byte-stable across attempts
// and the content hash matches. When live sources land (G5 + a Semrush seat), the run must
// snapshot its keyword universe so the hash stays stable across the approval round-trip —
// tracked as a follow-up; this module hashes whatever payload it's given.
//
// Pure + node-testable: the persistence surface is the injected `CheckpointStore` (faked
// in tests; supabase-backed in the route), exactly like template-approvals' ApprovalStore.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckpointHandler, CheckpointPayload } from "./pipeline";
import {
  checkpointApprovalSchema,
  type CheckpointApproval,
  type CheckpointPhase,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Store surface                                                              */
/* -------------------------------------------------------------------------- */

export type CheckpointStatus = "pending" | "approved" | "changes_requested";

/** One approval-queue row, keyed by (shop_id, phase, content_hash). */
export interface CheckpointRecord {
  id?: string;
  shop_id: string;
  phase: CheckpointPhase;
  content_hash: string;
  status: CheckpointStatus;
  /** Small human-readable digest of what the approver is signing off (never the full pkg). */
  summary: Record<string, unknown>;
  decided_by_profile_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  notes: string | null;
  requested_by_profile_id: string | null;
  created_at?: string;
}

/** Persistence surface — supabase-backed in the route, faked in tests. */
export interface CheckpointStore {
  /** The current record for a (shop, phase, content_hash), or null if none queued yet. */
  get(
    shopId: string,
    phase: CheckpointPhase,
    contentHash: string,
  ): Promise<CheckpointRecord | null>;
  /** Idempotently enqueue/refresh a PENDING record for a gate the run just reached. */
  upsertPending(rec: CheckpointRecord): Promise<CheckpointRecord>;
}

/** Fields a superadmin's in-UI decision stamps onto a still-pending checkpoint row. */
export interface CheckpointDecisionPatch {
  status: "approved" | "changes_requested";
  decided_by_profile_id: string;
  /** The ACTUAL superadmin (resolved server-side), never the literal "operator". */
  decided_by_name: string | null;
  decided_at: string;
  notes: string | null;
}

/**
 * Decision surface for the in-UI approve / request-changes route (PSG-376) — kept SEPARATE
 * from {@link CheckpointStore} so the run path's faked stores need not implement it. The
 * supabase-backed store satisfies both.
 */
export interface CheckpointDecisionStore {
  get(
    shopId: string,
    phase: CheckpointPhase,
    contentHash: string,
  ): Promise<CheckpointRecord | null>;
  /**
   * Flip a still-PENDING row to a decision (optimistic on status='pending'). Returns the
   * updated row, or null when the row was no longer pending (lost a concurrent decision race).
   */
  applyDecision(id: string, patch: CheckpointDecisionPatch): Promise<CheckpointRecord | null>;
}

/* -------------------------------------------------------------------------- */
/* Content hashing                                                            */
/* -------------------------------------------------------------------------- */

/** Stable stringify (object keys sorted) so the hash is order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Hash the load-bearing content of a checkpoint payload. We hash only the fields the
 * approver is actually signing off (cluster identity/labels/page-types + keyword phrases
 * for gate 1; the page hierarchy + calendar for gate 2), NOT volatile metadata like a
 * timestamp — so a re-run that produces the same plan matches the same approval.
 */
export function hashCheckpoint(payload: CheckpointPayload): string {
  let projection: unknown;
  if (payload.phase === "clusters_page_types") {
    projection = {
      phase: payload.phase,
      clusters: payload.clusters.map((c) => ({
        id: c.id,
        label: c.label,
        pageType: c.pageType,
        intent: c.intent,
        keywords: c.keywords.map((k) => k.keyword).sort(),
      })),
      inventory: payload.inventory
        .map((u) => ({ url: u.url, disposition: u.disposition }))
        .sort((a, b) => a.url.localeCompare(b.url)),
    };
  } else {
    const d = payload.draft;
    projection = {
      phase: payload.phase,
      root: projectNode(d.root),
      calendar: d.calendar.entries.map((e) => ({ pagePath: e.pagePath, month: e.month })),
      vertical: d.vertical,
    };
  }
  return createHash("sha256").update(stableStringify(projection)).digest("hex");
}

/** Slug-only projection of the page hierarchy (identity without volatile copy). */
function projectNode(node: { slug: string; pageType?: string; children: unknown[] }): unknown {
  return {
    slug: node.slug,
    pageType: node.pageType,
    children: (node.children as Parameters<typeof projectNode>[0][]).map(projectNode),
  };
}

/* -------------------------------------------------------------------------- */
/* Gate                                                                       */
/* -------------------------------------------------------------------------- */

/** Why a run stopped at a gate: still awaiting a human, or a human asked for changes. */
export type GateStop = {
  phase: CheckpointPhase;
  kind: "pending" | "rejected";
  contentHash: string;
  record: CheckpointRecord;
  approval: CheckpointApproval;
};

export type CheckpointGate = {
  /** Bind this to the engine's `onCheckpoint`. */
  handler: CheckpointHandler;
  /** Set when the run halted at a gate; null when every gate the run reached was approved. */
  getStop(): GateStop | null;
};

export type MakeCheckpointGateOptions = {
  store: CheckpointStore;
  shopId: string;
  /** Profile id of the superadmin who triggered the run (recorded on the queue row). */
  requestedByProfileId: string | null;
  /** Injected for deterministic stamping (mirrors the engine's `generatedAt`). */
  now: () => string;
};

/** Build a poll-based checkpoint gate over the approval-queue store. */
export function makeCheckpointGate(opts: MakeCheckpointGateOptions): CheckpointGate {
  let stop: GateStop | null = null;

  const handler: CheckpointHandler = async (payload) => {
    const phase = payload.phase;
    const contentHash = hashCheckpoint(payload);
    const existing = await opts.store.get(opts.shopId, phase, contentHash);

    if (existing && existing.status === "approved") {
      // Human signed off this exact plan — let the engine proceed.
      return approvalFromRecord(existing, opts.now());
    }

    if (existing && existing.status === "changes_requested") {
      // Human reviewed and asked for changes — stop and hand the partial back.
      const approval = approvalFromRecord(existing, opts.now());
      stop = { phase, kind: "rejected", contentHash, record: existing, approval };
      return approval;
    }

    // Not yet decided (no row, or still pending) — enqueue/refresh the pending item and
    // halt the run. Returning a non-approved verdict stops the engine cleanly.
    const record = await opts.store.upsertPending({
      shop_id: opts.shopId,
      phase,
      content_hash: contentHash,
      status: "pending",
      summary: summarize(payload),
      decided_by_profile_id: null,
      decided_by_name: null,
      decided_at: null,
      notes: null,
      requested_by_profile_id: opts.requestedByProfileId,
    });
    const approval = checkpointApprovalSchema.parse({
      phase,
      decision: "changes_requested",
      approvedBy: opts.requestedByProfileId ?? "sitemap-pipeline",
      approvedAt: opts.now(),
      notes: "Awaiting checkpoint approval (queued for superadmin sign-off).",
    });
    stop = { phase, kind: "pending", contentHash, record, approval };
    return approval;
  };

  return { handler, getStop: () => stop };
}

/** Map an approved/rejected queue row onto the engine's CheckpointApproval. */
function approvalFromRecord(rec: CheckpointRecord, fallbackAt: string): CheckpointApproval {
  return checkpointApprovalSchema.parse({
    phase: rec.phase,
    decision: rec.status === "approved" ? "approved" : "changes_requested",
    approvedBy: rec.decided_by_name || rec.decided_by_profile_id || "approver",
    approvedAt: rec.decided_at || fallbackAt,
    notes: rec.notes ?? undefined,
  });
}

/** A compact, approver-facing digest of the checkpoint payload (no full package). */
function summarize(payload: CheckpointPayload): Record<string, unknown> {
  if (payload.phase === "clusters_page_types") {
    return {
      phase: payload.phase,
      clusterCount: payload.clusters.length,
      inventoryCount: payload.inventory.length,
      clusters: payload.clusters.slice(0, 40).map((c) => ({
        label: c.label,
        pageType: c.pageType,
        keywords: c.keywords.length,
      })),
    };
  }
  const d = payload.draft;
  return {
    phase: payload.phase,
    businessName: d.brief.businessName,
    pageCount: countNodes(d.root),
    calendarEntries: d.calendar.entries.length,
    validationOk: d.validation.ok,
  };
}

function countNodes(node: { children: unknown[] }): number {
  return 1 + (node.children as { children: unknown[] }[]).reduce((n, c) => n + countNodes(c), 0);
}

/* -------------------------------------------------------------------------- */
/* In-UI decision (PSG-376 — approve / request-changes, no SQL)               */
/* -------------------------------------------------------------------------- */

export type DecideCheckpointInput = {
  shopId: string;
  phase: CheckpointPhase;
  /** The hash the approver is signing off — must match a queued row (stale-guard). */
  contentHash: string;
  decision: "approved" | "changes_requested";
  decidedByProfileId: string;
  /** The ACTUAL superadmin name (resolved server-side from the profile / auth email). */
  decidedByName: string | null;
  notes: string | null;
  now: string;
};

export type DecideCheckpointResult =
  /** The pending row was flipped to the requested decision. */
  | { status: "decided"; record: CheckpointRecord }
  /** The row was ALREADY at the requested decision — replayed safely (no double-write). */
  | { status: "idempotent"; record: CheckpointRecord }
  /** No queued row matches (shop, phase, contentHash) — the plan likely drifted. */
  | { status: "stale" }
  /** The row is already decided the OTHER way — a settled gate can't be flipped. */
  | { status: "conflict"; record: CheckpointRecord };

/**
 * Apply a superadmin's in-UI decision to a single queued checkpoint. Pure over the injected
 * {@link CheckpointDecisionStore} (faked in tests, supabase-backed in the route).
 *
 * The `contentHash` is the stale-guard: it must match a row queued for (shop, phase) or the
 * decision is rejected as `stale` — a re-run that produced a different plan enqueues a new
 * hash, so an approval aimed at the superseded plan can never silently advance the pipeline.
 * Re-deciding an already-decided gate is idempotent when the decision matches, and a
 * `conflict` when it differs (a settled gate is not re-openable here).
 */
export async function decideCheckpoint(
  store: CheckpointDecisionStore,
  input: DecideCheckpointInput,
): Promise<DecideCheckpointResult> {
  const existing = await store.get(input.shopId, input.phase, input.contentHash);
  if (!existing) return { status: "stale" };
  if (existing.status !== "pending") {
    return existing.status === input.decision
      ? { status: "idempotent", record: existing }
      : { status: "conflict", record: existing };
  }

  const updated = await store.applyDecision(existing.id as string, {
    status: input.decision,
    decided_by_profile_id: input.decidedByProfileId,
    decided_by_name: input.decidedByName,
    decided_at: input.now,
    notes: input.notes,
  });
  if (updated) return { status: "decided", record: updated };

  // Lost a concurrent race (row no longer pending) — re-read and classify deterministically.
  const after = await store.get(input.shopId, input.phase, input.contentHash);
  if (after && after.status !== "pending") {
    return after.status === input.decision
      ? { status: "idempotent", record: after }
      : { status: "conflict", record: after };
  }
  return { status: "stale" };
}

/* -------------------------------------------------------------------------- */
/* Supabase-backed store                                                      */
/* -------------------------------------------------------------------------- */

const TABLE = "sitemap_checkpoints";
const COLUMNS =
  "id, shop_id, phase, content_hash, status, summary, decided_by_profile_id, " +
  "decided_by_name, decided_at, notes, requested_by_profile_id, created_at";

function rowToRecord(row: Record<string, unknown>): CheckpointRecord {
  return {
    id: row.id as string,
    shop_id: row.shop_id as string,
    phase: row.phase as CheckpointPhase,
    content_hash: row.content_hash as string,
    status: row.status as CheckpointStatus,
    summary: (row.summary as Record<string, unknown>) ?? {},
    decided_by_profile_id: (row.decided_by_profile_id as string | null) ?? null,
    decided_by_name: (row.decided_by_name as string | null) ?? null,
    decided_at: (row.decided_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    requested_by_profile_id: (row.requested_by_profile_id as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? undefined,
  };
}

/**
 * Supabase-backed CheckpointStore (service-role client; RLS bypassed by design — the
 * sitemap_checkpoints table is default-deny and the /ops/sitemap route is superadmin-gated).
 */
export function supabaseCheckpointStore(
  service: SupabaseClient,
): CheckpointStore & CheckpointDecisionStore {
  return {
    async get(shopId, phase, contentHash) {
      const { data, error } = await service
        .from(TABLE)
        .select(COLUMNS)
        .eq("shop_id", shopId)
        .eq("phase", phase)
        .eq("content_hash", contentHash)
        .maybeSingle();
      if (error) throw new Error(`sitemap_checkpoints.get failed: ${error.message}`);
      return data ? rowToRecord(data as unknown as Record<string, unknown>) : null;
    },
    async upsertPending(rec) {
      // ON CONFLICT DO NOTHING: never clobber an existing decision. The gate only calls
      // this for a (shop, phase, hash) that is currently absent or still pending, so the
      // pre-existing row (if any) is the authoritative pending row — re-select it back.
      const { error } = await service.from(TABLE).upsert(
        {
          shop_id: rec.shop_id,
          phase: rec.phase,
          content_hash: rec.content_hash,
          status: "pending",
          summary: rec.summary,
          requested_by_profile_id: rec.requested_by_profile_id,
        },
        { onConflict: "shop_id,phase,content_hash", ignoreDuplicates: true },
      );
      if (error) throw new Error(`sitemap_checkpoints.upsertPending failed: ${error.message}`);
      const stored = await this.get(rec.shop_id, rec.phase, rec.content_hash);
      return stored ?? rec;
    },
    async applyDecision(id, patch) {
      // Optimistic concurrency: only flip a row that is STILL pending. A row already
      // decided (by a concurrent request) matches `.eq("status","pending")` zero times →
      // null, which decideCheckpoint() re-reads and classifies as idempotent/conflict.
      const { data, error } = await service
        .from(TABLE)
        .update({
          status: patch.status,
          decided_by_profile_id: patch.decided_by_profile_id,
          decided_by_name: patch.decided_by_name,
          decided_at: patch.decided_at,
          notes: patch.notes,
          updated_at: patch.decided_at,
        })
        .eq("id", id)
        .eq("status", "pending")
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`sitemap_checkpoints.applyDecision failed: ${error.message}`);
      return data ? rowToRecord(data as unknown as Record<string, unknown>) : null;
    },
  };
}
