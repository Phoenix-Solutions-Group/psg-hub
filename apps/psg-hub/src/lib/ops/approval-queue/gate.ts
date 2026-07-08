/**
 * Generic agent→approve→publish approval queue (PSG-245 / Wave 2 G-d).
 *
 * A reusable human-in-the-loop gate harvested from Providence: an agent proposes
 * an action, a role-gated human approves or rejects it, and the action is
 * published ONLY on approve. Generic over `actionType` (content / gbp_post /
 * review_reply / …) so the G-a/b/c autonomy layer all publishes through one gate.
 *
 * This module is PURE — no DB, no network, no clock. The decision state machine,
 * the orchestration (enqueue / approve / reject) and the publisher contract all
 * operate over an injected `ApprovalQueueStore` + injected timestamp, so the gate
 * is fully unit-testable with an in-memory fake. The supabase-backed store lives
 * in ./store.ts (server-only); the routes glue the two together.
 *
 * Invariants the gate guarantees:
 *   - publish is attempted ONLY on the approve path — a reject never publishes;
 *   - only a `pending` row can be decided (a second decision is rejected);
 *   - a publisher failure is captured (status `publish_failed`) without losing
 *     the recorded approval decision;
 *   - a failed publish can be retried without reopening rejected/published rows.
 */

/* -------------------------------------------------------------------------- */
/* Types.                                                                     */
/* -------------------------------------------------------------------------- */

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "published",
  "publish_failed",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Known action types the autonomy layer queues through the gate. Documentary —
 * the queue is generic, so an arbitrary string is accepted and a new capability
 * can register a publisher without touching this list.
 */
export const KNOWN_APPROVAL_ACTION_TYPES = [
  "content",
  "gbp_post",
  "review_reply",
] as const;
export type ApprovalActionType = string;

/** The approval_queue row shape (mirrors the migration columns). */
export interface ApprovalQueueRow {
  id?: string;
  shop_id: string;
  action_type: ApprovalActionType;
  title: string;
  summary: string | null;
  payload_jsonb: Record<string, unknown>;
  status: ApprovalStatus;
  proposed_by: string | null;
  decided_by_profile_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  published_at: string | null;
  publish_error: string | null;
}

export type ApprovalDecision = "approve" | "reject";

/** Raised when a decision is rejected by the state machine (→ HTTP 409). */
export class ApprovalDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalDecisionError";
  }
}

/* -------------------------------------------------------------------------- */
/* Decision state machine (pure).                                             */
/* -------------------------------------------------------------------------- */

/**
 * Validate an approve/reject decision against the current status. Only a
 * `pending` row can be decided — re-deciding an already-resolved row is rejected
 * so two reviewers (or a double-click) cannot publish twice or flip a verdict.
 * The check is the same for approve and reject (both require `pending`), so the
 * decision itself is not a parameter.
 */
export function validateApprovalDecision(
  current: ApprovalStatus
): { ok: true } | { ok: false; reason: string } {
  if (current !== "pending") {
    return {
      ok: false,
      reason: `approval is already ${current}; only a pending item can be decided`,
    };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Publisher contract + registry.                                             */
/* -------------------------------------------------------------------------- */

/**
 * Publishes an approved action to its downstream (GBP API, review-reply API, the
 * content publish gate, …). Resolves with an optional external reference on
 * success; THROWS to signal a publish failure (→ status `publish_failed`).
 */
export type Publisher = (
  row: ApprovalQueueRow
) => Promise<{ ref?: string } | void>;

/** action_type → publisher. The extension point G-a/b/c register into. */
export type PublisherRegistry = Record<string, Publisher>;

/**
 * Default registry: empty until the autonomy capabilities (G-a/b/c) register
 * their publishers. With no publisher for an action_type, approve transitions the
 * row to `approved` (decision recorded, ready for a publisher to be wired) and
 * never fabricates a publish.
 */
export const defaultPublishers: PublisherRegistry = {};

/* -------------------------------------------------------------------------- */
/* Persistence surface (injected; faked in tests, supabase in ./store.ts).    */
/* -------------------------------------------------------------------------- */

export interface ApprovalQueueStore {
  /** Insert a new queued action; returns the stored row (with id). */
  insert(row: ApprovalQueueRow): Promise<ApprovalQueueRow>;
  /** Load one row by id, or null. */
  get(id: string): Promise<ApprovalQueueRow | null>;
  /** Patch a row by id; returns the updated row. */
  update(id: string, patch: Partial<ApprovalQueueRow>): Promise<ApprovalQueueRow>;
  /** A shop's rows, optionally filtered to a set of statuses, newest first. */
  listByShop(shopId: string, statuses?: ApprovalStatus[]): Promise<ApprovalQueueRow[]>;
}

/* -------------------------------------------------------------------------- */
/* Orchestration (pure given an injected store + clock).                      */
/* -------------------------------------------------------------------------- */

export interface EnqueueArgs {
  shopId: string;
  actionType: ApprovalActionType;
  title: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
  /** Agent id / name or automation source that proposed the action. */
  proposedBy?: string | null;
}

/** Queue an agent-proposed action for human review (status `pending`). */
export async function enqueueApproval(
  store: ApprovalQueueStore,
  args: EnqueueArgs
): Promise<ApprovalQueueRow> {
  if (!args.shopId) throw new ApprovalDecisionError("enqueueApproval: shopId is required");
  if (!args.actionType) throw new ApprovalDecisionError("enqueueApproval: actionType is required");
  if (!args.title?.trim()) throw new ApprovalDecisionError("enqueueApproval: title is required");

  return store.insert({
    shop_id: args.shopId,
    action_type: args.actionType,
    title: args.title.trim(),
    summary: args.summary ?? null,
    payload_jsonb: args.payload ?? {},
    status: "pending",
    proposed_by: args.proposedBy ?? null,
    decided_by_profile_id: null,
    decided_by_name: null,
    decided_at: null,
    decision_notes: null,
    published_at: null,
    publish_error: null,
  });
}

export interface DecisionArgs {
  id: string;
  /** Acting human's profile id (auth.uid()). */
  actorProfileId: string;
  /** Typed human name for the sign-off (optional; profile id is the attribution). */
  actorName?: string | null;
  notes?: string | null;
  /** ISO timestamp (injected for deterministic tests). */
  now: string;
}

/**
 * Approve a pending action, then publish it through the registered publisher for
 * its action_type. A `publish_failed` row may call this again to retry the same
 * approved action. Publish is attempted ONLY here (never on reject). On publish
 * success → `published`; on publisher throw → `publish_failed` (the approval
 * decision is preserved either way); with no registered publisher → `approved`.
 */
export async function approveApproval(
  store: ApprovalQueueStore,
  args: DecisionArgs,
  opts: { publishers?: PublisherRegistry } = {}
): Promise<ApprovalQueueRow> {
  if (!args.actorProfileId) {
    throw new ApprovalDecisionError("approveApproval: actorProfileId is required");
  }
  const existing = await store.get(args.id);
  if (!existing) throw new ApprovalDecisionError(`approval ${args.id} not found`);
  const retryingFailedPublish = existing.status === "publish_failed";
  if (!retryingFailedPublish) {
    const check = validateApprovalDecision(existing.status);
    if (!check.ok) throw new ApprovalDecisionError(check.reason);
  }

  // 1. Record the approval decision first, so it survives a publisher failure.
  const approved = await store.update(args.id, {
    status: "approved",
    decided_by_profile_id: retryingFailedPublish
      ? existing.decided_by_profile_id
      : args.actorProfileId,
    decided_by_name: retryingFailedPublish ? existing.decided_by_name : args.actorName ?? null,
    decided_at: retryingFailedPublish ? existing.decided_at : args.now,
    decision_notes: retryingFailedPublish ? existing.decision_notes : args.notes ?? null,
    publish_error: null,
  });

  // 2. Publish — only on approve, only via a registered publisher for the type.
  const publishers = opts.publishers ?? defaultPublishers;
  const publisher = publishers[approved.action_type];
  if (!publisher) return approved;

  try {
    await publisher(approved);
    return store.update(args.id, { status: "published", published_at: args.now });
  } catch (err) {
    return store.update(args.id, {
      status: "publish_failed",
      publish_error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Reject a pending action. Never publishes. */
export async function rejectApproval(
  store: ApprovalQueueStore,
  args: DecisionArgs
): Promise<ApprovalQueueRow> {
  if (!args.actorProfileId) {
    throw new ApprovalDecisionError("rejectApproval: actorProfileId is required");
  }
  const existing = await store.get(args.id);
  if (!existing) throw new ApprovalDecisionError(`approval ${args.id} not found`);
  const check = validateApprovalDecision(existing.status);
  if (!check.ok) throw new ApprovalDecisionError(check.reason);

  return store.update(args.id, {
    status: "rejected",
    decided_by_profile_id: args.actorProfileId,
    decided_by_name: args.actorName ?? null,
    decided_at: args.now,
    decision_notes: args.notes ?? null,
  });
}
