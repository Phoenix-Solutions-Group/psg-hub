// v1.x / Wave 2 (G-a) — Autonomous orchestrator loop (always-on AI employee).
//
// The scheduled cadence that brings Providence's autonomous employee loop to BSM
// WITHOUT giving an agent the ability to publish on its own. The whole governance
// rule of this milestone is: an agent PROPOSES, a human APPROVES, and only then
// does the proposal PUBLISH — and never beyond the per-shop budget. This module
// is the loop that drives that rule on a cron, in two passes:
//
//   1. GENERATION pass (`runDraftGeneration`): walk every shop and, under a
//      per-pass spend cap, produce draft work and QUEUE it into the PSG-245
//      approval_queue as `pending`. It never publishes — generation only ever
//      creates rows a human must still approve.
//
//   2. PUBLISH pass (`runPublishApproved`): walk every shop and publish the items
//      a human has ALREADY approved (status `approved`) through the registered
//      publisher for each action_type. It touches ONLY `approved` rows, so an
//      un-approved (`pending`) proposal can never be published by the loop — the
//      "no autonomous publish bypasses approval" invariant is structural, not a
//      convention.
//
// GOVERNANCE / SAFETY:
//   - Publishing happens ONLY through the PSG-245 gate's row lifecycle. The agent
//     side of this module can only enqueue `pending`; the publish side can only
//     act on `approved`. There is no code path from "generated" to "published"
//     that skips the human decision.
//   - BUDGET / AUTO-PAUSE: both passes read live month-to-date intel spend
//     (reusing intel `budget-reader`) and compare it to a per-pass cap. At/over
//     the cap the pass AUTO-PAUSES — it does zero per-shop work and spends
//     nothing — so the always-on loop can never run the monthly budget away.
//   - The default publisher registry performs a safe INTERNAL record only (it
//     transitions the approved row to `published` with a synthetic ref, no
//     external send). Real downstream publishers (GBP API, the content publish
//     gate) are injected by the G-b/c capabilities; until one is wired for an
//     action_type, the loop reports that item as `awaiting_publisher` and never
//     fabricates an external publish.
//
// TENANT ISOLATION: every step is clamped to a single shopId. Shops are walked
// one at a time and the approval-queue reads/writes are `.eq("shop_id", shopId)`
// (via listByShop) or carry that shopId (enqueue). The service-role client
// bypasses RLS, so the per-shop scoping in this code IS the isolation boundary on
// the write path; approval_queue's RLS clamps the customer read path. One shop's
// failure is contained — the rest of the fleet still runs.
//
// runtime: server-only (the budget reader + approval-queue store are server-only).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueApproval,
  supabaseApprovalQueueStore,
  type ApprovalActionType,
  type ApprovalQueueRow,
  type ApprovalQueueStore,
  type Publisher,
  type PublisherRegistry,
} from "@/lib/ops/approval-queue";
import { monthToDateSpendUsd } from "@/lib/intel/budget-reader";

/* -------------------------------------------------------------------------- */
/* Config.                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Default per-pass spend ceiling, in USD, enforced against the SHARED
 * month-to-date intel ledger. Deliberately small: the orchestrator runs
 * continuously, so its ceiling must be a fraction of the on-demand report's $200
 * and below the monitor's $50 — an always-on loop should never be the thing that
 * burns the monthly budget. Overridable via `ORCHESTRATOR_SPEND_CAP_USD`.
 */
export const DEFAULT_ORCHESTRATOR_SPEND_CAP_USD = 25;

/** Source attribution stamped onto every proposal this loop queues. */
export const ORCHESTRATOR_PROPOSED_BY = "orchestrator";

/* -------------------------------------------------------------------------- */
/* Shared types.                                                              */
/* -------------------------------------------------------------------------- */

/** The shop fields the loop needs (id is the tenant key; url gives light context). */
export type OrchestratorShop = { id: string; url: string | null };

export type OrchestratorOptions = {
  /** Injected "now" (ISO) for deterministic stamping + idempotency keys. */
  now?: string;
  /** Per-pass spend ceiling; defaults to env `ORCHESTRATOR_SPEND_CAP_USD` or $25. */
  spendCapUsd?: number;
};

/** Injectable seams so each pass is unit-testable without a live DB / ledger. */
export type OrchestratorDeps = {
  /** Approval-queue persistence; defaults to the supabase-backed store. */
  store?: ApprovalQueueStore;
  /** Reads live month-to-date intel spend (USD); defaults to the budget-reader. */
  readSpendUsd?: (service: SupabaseClient, now: Date) => Promise<number>;
};

function resolveSpendCapUsd(opts: OrchestratorOptions): number {
  if (typeof opts.spendCapUsd === "number") return opts.spendCapUsd;
  const env = process.env.ORCHESTRATOR_SPEND_CAP_USD;
  const parsed = env == null ? NaN : Number(env);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_ORCHESTRATOR_SPEND_CAP_USD;
}

/** Load the shop fleet (fail-closed: a load error throws, never silently empty). */
async function loadShops(service: SupabaseClient): Promise<OrchestratorShop[]> {
  const { data, error } = await service.from("shops").select("id, url");
  if (error) throw new Error(`[orchestrator] shop load failed: ${error.message}`);
  return (data ?? []) as OrchestratorShop[];
}

/* -------------------------------------------------------------------------- */
/* Draft generation (pass 1).                                                 */
/* -------------------------------------------------------------------------- */

/** A unit of draft work the loop proposes for human approval. */
export type DraftProposal = {
  actionType: ApprovalActionType;
  title: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Produces the draft proposals for one shop. Injectable: the default below is
 * deterministic (zero spend) so the loop is safe to schedule today; the metered
 * Content Writer generator is wired in here once that seam (BSM Content Writer)
 * activates, at which point the per-pass budget cap above governs its spend.
 */
export type DraftGenerator = (
  shop: OrchestratorShop,
  ctx: { now: string },
) => DraftProposal[] | Promise<DraftProposal[]>;

/** ISO-week stamp (e.g. `2026-W26`) — the natural idempotency bucket for a
 *  weekly cadence: a re-run inside the same week re-derives the same title and is
 *  skipped, so the cron is safe to fire more than once per period. */
export function isoWeekStamp(iso: string): string {
  const d = new Date(iso);
  // ISO-8601 week: Thursday-anchored. Copy to avoid mutating the parsed date.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; // Sun=0 -> 7
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Default draft generator: one deterministic weekly Google Business Profile
 * update proposal per shop. Deterministic + zero-spend, so it is safe to run
 * before the metered Content Writer seam is wired (mirrors the competitor
 * monitor's pre-G5 posture). The ISO-week stamp in the title makes re-runs within
 * a week idempotent.
 */
export function defaultDraftGenerator(
  shop: OrchestratorShop,
  ctx: { now: string },
): DraftProposal[] {
  const week = isoWeekStamp(ctx.now);
  return [
    {
      actionType: "gbp_post",
      title: `Weekly Google Business Profile update — ${week}`,
      summary:
        "Draft GBP post proposing a weekly customer update for this shop. " +
        "Awaiting owner/manager approval before anything is published.",
      payload: {
        kind: "gbp_post",
        cadence: "weekly",
        period: week,
        shopUrl: shop.url ?? null,
        generatedBy: ORCHESTRATOR_PROPOSED_BY,
        generatedAt: ctx.now,
      },
    },
  ];
}

export type ShopGenerationStatus = "queued" | "skipped" | "failed";

export type ShopGenerationOutcome = {
  shopId: string;
  status: ShopGenerationStatus;
  /** Proposals newly enqueued as `pending`. */
  queued: number;
  /** Proposals skipped because an open row already occupies the slot. */
  skipped: number;
  error?: string;
};

export type DraftGenerationResult = {
  /** True when the pass auto-paused at the budget cap (no shop was processed). */
  paused: boolean;
  spentUsd: number;
  capUsd: number;
  shopsProcessed: number;
  queued: number;
  skipped: number;
  failed: number;
  outcomes: ShopGenerationOutcome[];
};

/** Statuses that still "occupy" a proposal slot for idempotency: a proposal is
 *  re-queued only if there is no open row for the same (shop, action_type, title).
 *  `rejected` does NOT occupy the slot — a human rejection is a decision to not
 *  do that work, and the loop should not nag by re-proposing it the same period;
 *  the ISO-week title rotation means next period is a fresh slot anyway. */
const OPEN_FOR_IDEMPOTENCY = ["pending", "approved", "published", "publish_failed"] as const;

/**
 * GENERATION pass. Walk every shop and queue draft work as `pending`, under the
 * per-pass spend cap. Never publishes. Auto-pauses (zero work, zero spend) when
 * month-to-date spend is at/over the cap.
 */
export async function runDraftGeneration(
  service: SupabaseClient,
  opts: OrchestratorOptions = {},
  deps: OrchestratorDeps & { generate?: DraftGenerator } = {},
): Promise<DraftGenerationResult> {
  const now = opts.now ?? new Date().toISOString();
  const capUsd = resolveSpendCapUsd(opts);
  const store = deps.store ?? supabaseApprovalQueueStore(service);
  const readSpend = deps.readSpendUsd ?? ((s, n) => monthToDateSpendUsd(s, { now: n }));
  const generate = deps.generate ?? defaultDraftGenerator;

  const spentUsd = await readSpend(service, new Date(now));
  const base: DraftGenerationResult = {
    paused: false,
    spentUsd,
    capUsd,
    shopsProcessed: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  };

  // AUTO-PAUSE: at/over the cap the always-on loop must not start new (metered)
  // work. Bail before touching any shop so a paused pass spends exactly nothing.
  if (spentUsd >= capUsd) return { ...base, paused: true };

  const shops = await loadShops(service);
  for (const shop of shops) {
    const outcome: ShopGenerationOutcome = { shopId: shop.id, status: "queued", queued: 0, skipped: 0 };
    try {
      const proposals = await generate(shop, { now });
      // Load the shop's open rows once to dedupe this pass's proposals against
      // slots that already exist (idempotent re-run).
      const open = await store.listByShop(shop.id, [...OPEN_FOR_IDEMPOTENCY]);
      const taken = new Set(open.map((r) => `${r.action_type} ${r.title}`));

      for (const p of proposals) {
        const key = `${p.actionType} ${p.title.trim()}`;
        if (taken.has(key)) {
          outcome.skipped += 1;
          continue;
        }
        await enqueueApproval(store, {
          shopId: shop.id,
          actionType: p.actionType,
          title: p.title,
          summary: p.summary ?? null,
          payload: p.payload ?? {},
          proposedBy: ORCHESTRATOR_PROPOSED_BY,
        });
        taken.add(key); // guard against duplicate titles within one batch
        outcome.queued += 1;
      }
      outcome.status = outcome.queued > 0 ? "queued" : "skipped";
    } catch (err) {
      outcome.status = "failed";
      outcome.error = err instanceof Error ? err.message : String(err);
    }

    base.shopsProcessed += 1;
    base.queued += outcome.queued;
    base.skipped += outcome.skipped;
    if (outcome.status === "failed") base.failed += 1;
    base.outcomes.push(outcome);
  }

  return base;
}

/* -------------------------------------------------------------------------- */
/* Publisher registry (publish pass).                                         */
/* -------------------------------------------------------------------------- */

/**
 * Safe INTERNAL publisher: records the publish on the approval_queue row itself
 * (the gate stamps `published_at` + the returned ref) without any external send.
 * This is the default until a real downstream publisher (GBP API, content publish
 * gate) is injected — it lets the loop demonstrably "publish approved items"
 * end-to-end while doing nothing the board has not approved an external send for.
 */
export const recordingPublisher: Publisher = async (row) => {
  return { ref: `orchestrator:internal:${row.id ?? "unknown"}` };
};

/**
 * Default registry for the loop's own action types. Real GBP / content publishers
 * replace these (or are merged in) by the G-b/c capabilities. An action_type with
 * no entry here is reported `awaiting_publisher` and never auto-published.
 */
export const defaultOrchestratorPublishers: PublisherRegistry = {
  gbp_post: recordingPublisher,
  content: recordingPublisher,
};

/* -------------------------------------------------------------------------- */
/* Publish-approved (pass 2).                                                 */
/* -------------------------------------------------------------------------- */

export type PublishItemStatus = "published" | "publish_failed" | "awaiting_publisher";

export type PublishItemOutcome = {
  approvalId: string;
  shopId: string;
  actionType: string;
  status: PublishItemStatus;
  error?: string;
};

export type PublishApprovedResult = {
  /** True when the pass auto-paused at the budget cap (nothing published). */
  paused: boolean;
  spentUsd: number;
  capUsd: number;
  shopsProcessed: number;
  approvedFound: number;
  published: number;
  failed: number;
  awaitingPublisher: number;
  outcomes: PublishItemOutcome[];
};

/**
 * Publish one already-approved row through its registered publisher. Mirrors the
 * publish half of the PSG-245 gate, but for the cron's publish-only path (the row
 * is ALREADY `approved` — the human decision was recorded + audited by the
 * approve route). On success → `published`; on publisher throw → `publish_failed`
 * (the approval decision is preserved); no publisher → left `approved`.
 *
 * Exported for unit tests. CALLER must pass a row whose status is `approved`.
 */
export async function publishApprovedRow(
  store: ApprovalQueueStore,
  row: ApprovalQueueRow,
  publishers: PublisherRegistry,
  now: string,
): Promise<PublishItemOutcome> {
  const id = row.id as string;
  const outcome: PublishItemOutcome = {
    approvalId: id,
    shopId: row.shop_id,
    actionType: row.action_type,
    status: "published",
  };

  const publisher = publishers[row.action_type];
  if (!publisher) {
    // No registered publisher: do NOT fabricate a publish — the item stays
    // `approved`, queryable, ready for a real publisher to be wired.
    outcome.status = "awaiting_publisher";
    return outcome;
  }

  try {
    const res = await publisher(row);
    await store.update(id, {
      status: "published",
      published_at: now,
      publish_error: res && res.ref ? `ref:${res.ref}` : null,
    });
    outcome.status = "published";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.update(id, { status: "publish_failed", publish_error: message });
    outcome.status = "publish_failed";
    outcome.error = message;
  }
  return outcome;
}

/**
 * PUBLISH pass. Walk every shop and publish its `approved` items through the
 * registry, under the per-pass spend cap. Touches ONLY `approved` rows, so a
 * `pending` (un-approved) proposal can never be published here — the core
 * "no autonomous publish bypasses approval" guarantee. Auto-pauses (publishes
 * nothing) when month-to-date spend is at/over the cap.
 */
export async function runPublishApproved(
  service: SupabaseClient,
  opts: OrchestratorOptions = {},
  deps: OrchestratorDeps & { publishers?: PublisherRegistry } = {},
): Promise<PublishApprovedResult> {
  const now = opts.now ?? new Date().toISOString();
  const capUsd = resolveSpendCapUsd(opts);
  const store = deps.store ?? supabaseApprovalQueueStore(service);
  const readSpend = deps.readSpendUsd ?? ((s, n) => monthToDateSpendUsd(s, { now: n }));
  const publishers = deps.publishers ?? defaultOrchestratorPublishers;

  const spentUsd = await readSpend(service, new Date(now));
  const base: PublishApprovedResult = {
    paused: false,
    spentUsd,
    capUsd,
    shopsProcessed: 0,
    approvedFound: 0,
    published: 0,
    failed: 0,
    awaitingPublisher: 0,
    outcomes: [],
  };

  if (spentUsd >= capUsd) return { ...base, paused: true };

  const shops = await loadShops(service);
  for (const shop of shops) {
    base.shopsProcessed += 1;
    let approved: ApprovalQueueRow[];
    try {
      // ONLY `approved` rows are eligible — never `pending`. This is the structural
      // guarantee that the loop publishes nothing a human has not approved.
      approved = await store.listByShop(shop.id, ["approved"]);
    } catch (err) {
      base.failed += 1;
      base.outcomes.push({
        approvalId: "",
        shopId: shop.id,
        actionType: "",
        status: "publish_failed",
        error: `list approved failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    for (const row of approved) {
      base.approvedFound += 1;
      const outcome = await publishApprovedRow(store, row, publishers, now);
      base.outcomes.push(outcome);
      if (outcome.status === "published") base.published += 1;
      else if (outcome.status === "publish_failed") base.failed += 1;
      else base.awaitingPublisher += 1;
    }
  }

  return base;
}
