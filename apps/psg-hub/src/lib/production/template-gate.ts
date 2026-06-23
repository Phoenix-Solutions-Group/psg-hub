/**
 * Template proof / approve / release gate (v1.x, PSG-217 / PSG-115b).
 *
 * The mail-merge engine (./templates.ts) renders a template's exact merged HTML
 * and reports the unresolved `{{tokens}}`. This module adds the *governance*
 * layer on top so no un-approved template can ever be mailed in a live batch:
 *
 *   Draft  → Approve (named sign-off, audited) → Release (eligible for live)
 *
 * A template is identified by its product key (thank_you / warranty / envelope)
 * plus a CONTENT HASH of the template body. The hash is the linchpin: an
 * approval is bound to the exact bytes that were proofed, so editing a template
 * after release silently invalidates the approval (hash mismatch) and forces a
 * fresh proof + sign-off. Fail-closed by construction.
 *
 * This module is PURE — no DB, no network, no clock. `node:crypto` is a
 * deterministic, side-effect-free hash and is the only import beyond the engine.
 * The DB I/O (read/write the mail_template_approvals row) lives in the
 * server-only service layer (src/lib/ops/template-approvals.ts); the routes glue
 * the two together.
 */

import { createHash } from "node:crypto";
import {
  defaultTemplate,
  renderMailContent,
  type MailMergeData,
  type MailProduct,
  type MailTemplate,
  type RenderedMailContent,
} from "./templates";
import type { MailPieceType } from "./types";

/** The catalog of templates that can be proofed / approved. Mirrors MailProduct. */
export const TEMPLATE_KEYS = [
  "thank_you",
  "warranty",
  "envelope",
  "service_recovery",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Narrow an arbitrary string to a known template key. */
export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/** Human label for a template key (UI / audit payloads). */
export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  thank_you: "Thank-you + ACRB survey letter",
  warranty: "Warranty letter",
  envelope: "Envelope",
  service_recovery: "Owner service-recovery letter",
};

/**
 * Stable content hash of a template's render-relevant bytes. Same template →
 * same hash across processes/deploys; ANY change to the merged content (front /
 * back / body HTML, piece type, size, color) changes the hash → the prior
 * approval no longer matches → re-approval required. Field order is fixed so the
 * hash is canonical.
 */
export function templateContentHash(template: MailTemplate): string {
  const canonical = JSON.stringify({
    product: template.product,
    pieceType: template.pieceType,
    frontHtml: template.frontHtml ?? null,
    backHtml: template.backHtml ?? null,
    bodyHtml: template.bodyHtml ?? null,
    size: template.size ?? null,
    color: template.color ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Current content hash for a template key (resolves the default template). */
export function currentTemplateHash(key: TemplateKey): string {
  return templateContentHash(defaultTemplate(key));
}

/**
 * Representative seed sample data used to render a deterministic proof. It fills
 * every standard merge field so a fully-authored template shows zero missing
 * tokens, while a template that references an unfilled field still surfaces it.
 * Intentionally obvious demo values — never a real customer.
 */
export const SAMPLE_MERGE_DATA: MailMergeData = {
  customer: {
    firstName: "Jordan",
    lastName: "Rivera",
    vehicle: "2021 Honda CR-V",
    vehicleShort: "CR-V",
    serviceDate: "2026-05-14",
    letterDate: "May 2026",
    addressLine1: "742 Evergreen Terrace",
    city: "Lincoln",
    state: "NE",
    zip: "68508",
    surveySecurityCode: "DEMO-4821",
    surveyId: "SID-90042",
    roNumber: "RO-10042",
  },
  company: {
    name: "Demo Body Works",
    phone: "(555) 014-2200",
    email: "service@demobodyworks.example",
    websiteUrl: "demobodyworks.example",
    city: "Lincoln",
    state: "NE",
  },
  program: {
    greeting: "We truly appreciate your business.",
    footer: "Demo Body Works ·",
    logo: "https://cdn.example/demo-body-works.png",
    addressLine1: "1200 Industrial Pkwy",
    addressLine2: "Lincoln, NE 68508",
    ownerName: "Pat Morgan",
    ownerFirstName: "Pat",
    ownerTitle: "Owner",
    ownerSignatureUrl: "https://cdn.example/pat-morgan-sig.png",
    ownerDirectLine: "(555) 014-2201",
    surveyUrl: "www.theacrb.com",
    tagline: "We keep our customers by keeping our customers satisfied",
    pieceCode: "PS682",
    jobNumber: "1042.07",
    hasWarranty: "true",
  },
};

/** A rendered proof of a template: merged HTML surfaces + unresolved tokens. */
export interface TemplateProof {
  key: TemplateKey;
  label: string;
  pieceType: MailPieceType;
  contentHash: string;
  content: RenderedMailContent;
}

/**
 * Render the exact merged HTML for a template on sample data, carrying the
 * content hash (so a proof a human approves is bound to specific bytes) and the
 * engine's missing-token report. `data` defaults to the deterministic sample.
 */
export function buildTemplateProof(
  key: TemplateKey,
  data: MailMergeData = SAMPLE_MERGE_DATA
): TemplateProof {
  const template = defaultTemplate(key);
  return {
    key,
    label: TEMPLATE_LABELS[key],
    pieceType: template.pieceType,
    contentHash: templateContentHash(template),
    content: renderMailContent(template, data),
  };
}

/* -------------------------------------------------------------------------- */
/* Approval state machine (pure).                                             */
/* -------------------------------------------------------------------------- */

export const TEMPLATE_APPROVAL_STATUSES = [
  "draft",
  "approved",
  "released",
  "revoked",
] as const;
export type TemplateApprovalStatus = (typeof TEMPLATE_APPROVAL_STATUSES)[number];

/** The approval facts the gate reasons about (subset of the DB row). */
export interface TemplateApprovalState {
  templateKey: string;
  contentHash: string;
  status: TemplateApprovalStatus;
}

export type TemplateApprovalAction = "approve" | "release" | "revoke";

/** Why a template is NOT eligible for a live batch. */
export type IneligibleReason = "no_approval" | "not_released" | "stale_hash";

/**
 * A template is eligible for a LIVE batch iff there is a `released` approval
 * whose content hash matches the CURRENT template content. Anything else —
 * missing approval, not yet released, or released against stale bytes — fails
 * closed.
 */
export function isTemplateEligibleForLiveBatch(
  approval: TemplateApprovalState | null | undefined,
  currentContentHash: string
): boolean {
  return ineligibleReason(approval, currentContentHash) === null;
}

/** The eligibility verdict, or null when the template IS eligible. */
export function ineligibleReason(
  approval: TemplateApprovalState | null | undefined,
  currentContentHash: string
): IneligibleReason | null {
  if (!approval) return "no_approval";
  if (approval.status !== "released") return "not_released";
  if (approval.contentHash !== currentContentHash) return "stale_hash";
  return null;
}

/** Thrown when a live-batch action is attempted against an ineligible template. */
export class TemplateNotApprovedError extends Error {
  readonly templateKey: string;
  readonly reason: IneligibleReason;
  constructor(templateKey: string, reason: IneligibleReason) {
    super(messageForReason(templateKey, reason));
    this.name = "TemplateNotApprovedError";
    this.templateKey = templateKey;
    this.reason = reason;
  }
}

function messageForReason(templateKey: string, reason: IneligibleReason): string {
  switch (reason) {
    case "no_approval":
      return `Template "${templateKey}" has no approval — proof, approve, and release it before adding it to a live batch.`;
    case "not_released":
      return `Template "${templateKey}" is approved but not yet released — release it before adding it to a live batch.`;
    case "stale_hash":
      return `Template "${templateKey}" changed since it was released — re-proof and re-approve the new version before adding it to a live batch.`;
  }
}

/**
 * Throw `TemplateNotApprovedError` unless the template is eligible for a live
 * batch. The single chokepoint the batch-generation path calls so an un-approved
 * template can never enter a live run.
 */
export function assertTemplateEligibleForLiveBatch(
  templateKey: string,
  approval: TemplateApprovalState | null | undefined,
  currentContentHash: string
): void {
  const reason = ineligibleReason(approval, currentContentHash);
  if (reason) throw new TemplateNotApprovedError(templateKey, reason);
}

/**
 * Validate a Draft→Approve→Release→Revoke transition. Pure decision the service
 * layer consults before writing. `current` is null when no approval row exists.
 *
 *   approve: allowed from none/draft/approved(re-sign)/revoked; never from released
 *            (a released version is frozen — edit the template to start a new one).
 *   release: only from approved (must be signed off first).
 *   revoke:  only from approved or released (nothing to revoke otherwise).
 */
export function validateApprovalTransition(
  current: TemplateApprovalStatus | null,
  action: TemplateApprovalAction
): { ok: true } | { ok: false; reason: string } {
  switch (action) {
    case "approve":
      if (current === "released") {
        return { ok: false, reason: "already released; edit the template to begin a new version" };
      }
      return { ok: true };
    case "release":
      if (current !== "approved") {
        return { ok: false, reason: "template must be approved before it can be released" };
      }
      return { ok: true };
    case "revoke":
      if (current !== "approved" && current !== "released") {
        return { ok: false, reason: "only an approved or released template can be revoked" };
      }
      return { ok: true };
  }
}

// Re-export for callers that already import MailProduct semantics.
export type { MailProduct };
