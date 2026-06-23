// PSG-217 / PSG-115b — mail template approval service (DB I/O layer).
//
// The pure gate logic (state machine, eligibility, content hash) lives in
// src/lib/production/template-gate.ts. This module is the thin, server-only
// persistence + orchestration layer over the mail_template_approvals table:
// load the current approval for a template version, and run the
// Draft→Approve→Release→Revoke transitions (each consults the pure validator,
// then writes the row). DB access is hidden behind the small `ApprovalStore`
// interface so the orchestration is unit-testable with an in-memory fake; the
// supabase-backed store is exercised end-to-end by the routes + QA.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateApprovalTransition,
  type TemplateApprovalStatus,
} from "@/lib/production/template-gate";

/** The mail_template_approvals row shape used by the gate. */
export interface TemplateApprovalRow {
  id?: string;
  template_key: string;
  content_hash: string;
  status: TemplateApprovalStatus;
  approved_by_profile_id: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  released_by_profile_id: string | null;
  released_at: string | null;
  revoked_by_profile_id: string | null;
  revoked_at: string | null;
  notes: string | null;
  created_by_profile_id: string | null;
}

/** Minimal persistence surface — implemented over supabase, faked in tests. */
export interface ApprovalStore {
  /** The current approval row for a template version, or null. */
  get(templateKey: string, contentHash: string): Promise<TemplateApprovalRow | null>;
  /** Upsert by (template_key, content_hash); returns the stored row. */
  save(row: TemplateApprovalRow): Promise<TemplateApprovalRow>;
  /** Every approval row for the given keys (for the gate index page). */
  listByKeys(templateKeys: string[]): Promise<TemplateApprovalRow[]>;
}

const TABLE = "mail_template_approvals";
const COLUMNS =
  "id, template_key, content_hash, status, approved_by_profile_id, approved_by_name, " +
  "approved_at, released_by_profile_id, released_at, revoked_by_profile_id, revoked_at, " +
  "notes, created_by_profile_id";

/** Supabase-backed ApprovalStore (service-role client; RLS bypassed by design). */
export function supabaseApprovalStore(service: SupabaseClient): ApprovalStore {
  return {
    async get(templateKey, contentHash) {
      const { data, error } = await service
        .from(TABLE)
        .select(COLUMNS)
        .eq("template_key", templateKey)
        .eq("content_hash", contentHash)
        .maybeSingle();
      if (error) throw new Error(`template-approvals get failed: ${error.message}`);
      return (data as unknown as TemplateApprovalRow | null) ?? null;
    },
    async save(row) {
      const { data, error } = await service
        .from(TABLE)
        .upsert(row, { onConflict: "template_key,content_hash" })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`template-approvals save failed: ${error.message}`);
      return data as unknown as TemplateApprovalRow;
    },
    async listByKeys(templateKeys) {
      const { data, error } = await service
        .from(TABLE)
        .select(COLUMNS)
        .in("template_key", templateKeys);
      if (error) throw new Error(`template-approvals list failed: ${error.message}`);
      return (data as unknown as TemplateApprovalRow[] | null) ?? [];
    },
  };
}

/** A fresh draft row (no approval yet) — the base every transition builds on. */
function draftRow(
  templateKey: string,
  contentHash: string,
  actorProfileId: string
): TemplateApprovalRow {
  return {
    template_key: templateKey,
    content_hash: contentHash,
    status: "draft",
    approved_by_profile_id: null,
    approved_by_name: null,
    approved_at: null,
    released_by_profile_id: null,
    released_at: null,
    revoked_by_profile_id: null,
    revoked_at: null,
    notes: null,
    created_by_profile_id: actorProfileId,
  };
}

/** Raised when a transition is rejected by the state machine (→ HTTP 409). */
export class ApprovalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalTransitionError";
  }
}

export interface ApproveArgs {
  templateKey: string;
  contentHash: string;
  actorProfileId: string;
  /** Named sign-off — the human name attributed to the approval. */
  approverName: string;
  notes?: string | null;
  /** ISO timestamp (injected for deterministic tests). */
  now: string;
}

/** Approve (named sign-off) a template version. Draft/none/approved/revoked → approved. */
export async function approveTemplateVersion(
  store: ApprovalStore,
  args: ApproveArgs
): Promise<TemplateApprovalRow> {
  const existing = await store.get(args.templateKey, args.contentHash);
  const check = validateApprovalTransition(existing?.status ?? null, "approve");
  if (!check.ok) throw new ApprovalTransitionError(check.reason);

  const base = existing ?? draftRow(args.templateKey, args.contentHash, args.actorProfileId);
  return store.save({
    ...base,
    status: "approved",
    approved_by_profile_id: args.actorProfileId,
    approved_by_name: args.approverName,
    approved_at: args.now,
    // A re-approval clears any prior revocation.
    revoked_by_profile_id: null,
    revoked_at: null,
    notes: args.notes ?? base.notes ?? null,
  });
}

export interface ReleaseArgs {
  templateKey: string;
  contentHash: string;
  actorProfileId: string;
  now: string;
}

/** Release an approved template version → eligible for live batches. */
export async function releaseTemplateVersion(
  store: ApprovalStore,
  args: ReleaseArgs
): Promise<TemplateApprovalRow> {
  const existing = await store.get(args.templateKey, args.contentHash);
  const check = validateApprovalTransition(existing?.status ?? null, "release");
  if (!check.ok) throw new ApprovalTransitionError(check.reason);

  // existing is guaranteed non-null here: only 'approved' passes the validator.
  return store.save({
    ...(existing as TemplateApprovalRow),
    status: "released",
    released_by_profile_id: args.actorProfileId,
    released_at: args.now,
  });
}

export interface RevokeArgs {
  templateKey: string;
  contentHash: string;
  actorProfileId: string;
  now: string;
}

/** Revoke an approved/released template version → no longer eligible for live. */
export async function revokeTemplateVersion(
  store: ApprovalStore,
  args: RevokeArgs
): Promise<TemplateApprovalRow> {
  const existing = await store.get(args.templateKey, args.contentHash);
  const check = validateApprovalTransition(existing?.status ?? null, "revoke");
  if (!check.ok) throw new ApprovalTransitionError(check.reason);

  return store.save({
    ...(existing as TemplateApprovalRow),
    status: "revoked",
    revoked_by_profile_id: args.actorProfileId,
    revoked_at: args.now,
  });
}
