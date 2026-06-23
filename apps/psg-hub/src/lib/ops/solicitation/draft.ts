// PSG-248 — solicitation copy builder + compliance validator (PURE).
//
// Builds the email + SMS copy for a review request. The copy is deliberately
// plain and human (no marketing-speak / AI vocabulary) and BAKES IN the legal
// footers so a draft cannot be enqueued without them:
//   - email  → one-click unsubscribe link + the sender's physical postal address
//              + a plain "why you got this" line (CAN-SPAM §5).
//   - sms    → a "Reply STOP to opt out" notice (TCPA / CTIA).
// validateDraftCompliance re-checks the rendered strings so the gate (and QA) can
// PROVE every required element is present rather than trusting the builder.

import type { SolicitationChannel, SolicitationDraft } from "./types";

export interface SolicitationDraftInput {
  shopName: string;
  recipientFirstName?: string | null;
  /** Where the customer leaves the review (their GBP / Yelp write-a-review URL). */
  reviewUrl: string;
  /** Full unsubscribe URL incl. the signed token — required when email is targeted. */
  unsubscribeUrl?: string | null;
  /** The sender's physical postal address — required by CAN-SPAM on the email. */
  senderPostalAddress: string;
  channels: SolicitationChannel[];
}

/** Minimal HTML escape for interpolating names/values into the email HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Hi Jordan" when a first name is known, else a neutral "Hi there". */
function greeting(firstName?: string | null): string {
  const name = (firstName ?? "").trim();
  return name === "" ? "Hi there" : `Hi ${name}`;
}

function buildEmail(input: SolicitationDraftInput): SolicitationDraft["email"] {
  const hi = greeting(input.recipientFirstName);
  const { shopName, reviewUrl, senderPostalAddress } = input;
  const unsubscribeUrl = input.unsubscribeUrl ?? "";

  const subject = `How was your visit to ${shopName}?`;

  const text = [
    `${hi},`,
    "",
    `Thanks for trusting ${shopName} with your repair. If you have a minute, a short review helps other drivers find us and tells our team how we did.`,
    "",
    `Leave a review: ${reviewUrl}`,
    "",
    "Thanks,",
    `The team at ${shopName}`,
    "",
    "—",
    `You got this email because you recently had work done at ${shopName}.`,
    `${shopName}, ${senderPostalAddress}`,
    `Don't want these? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(hi)},</p>`,
    `<p>Thanks for trusting ${escapeHtml(shopName)} with your repair. If you have a minute, a short review helps other drivers find us and tells our team how we did.</p>`,
    `<p><a href="${escapeHtml(reviewUrl)}">Leave a review</a></p>`,
    `<p>Thanks,<br/>The team at ${escapeHtml(shopName)}</p>`,
    `<hr/>`,
    `<p style="font-size:12px;color:#555">`,
    `You got this email because you recently had work done at ${escapeHtml(shopName)}.<br/>`,
    `${escapeHtml(shopName)}, ${escapeHtml(senderPostalAddress)}<br/>`,
    `Don't want these? <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>.`,
    `</p>`,
  ].join("\n");

  return { subject, text, html };
}

function buildSms(input: SolicitationDraftInput): SolicitationDraft["sms"] {
  const hi = greeting(input.recipientFirstName);
  // Kept short and to the point; the STOP notice is mandatory (TCPA/CTIA).
  const body =
    `${hi}, thanks for choosing ${input.shopName}. ` +
    `Mind leaving a quick review? ${input.reviewUrl} ` +
    `Reply STOP to opt out.`;
  return { body };
}

/** Build the per-channel solicitation copy for the requested channels. */
export function buildSolicitationDraft(
  input: SolicitationDraftInput
): SolicitationDraft {
  const draft: SolicitationDraft = {};
  if (input.channels.includes("email")) draft.email = buildEmail(input);
  if (input.channels.includes("sms")) draft.sms = buildSms(input);
  return draft;
}

/**
 * Re-validate that a rendered draft carries every legally-required element for the
 * channels it targets. Returns a list of human-readable issues; an empty list
 * means the draft is compliant. The gate refuses to enqueue a draft with issues.
 */
export function validateDraftCompliance(
  draft: SolicitationDraft,
  opts: { unsubscribeUrl?: string | null; senderPostalAddress?: string | null } = {}
): string[] {
  const issues: string[] = [];

  if (draft.email) {
    const { text, html, subject } = draft.email;
    if (!subject.trim()) issues.push("email: subject is empty");
    const unsub = (opts.unsubscribeUrl ?? "").trim();
    if (unsub === "") {
      issues.push("email: no unsubscribe URL provided (CAN-SPAM)");
    } else if (!text.includes(unsub) || !html.includes(unsub)) {
      issues.push("email: unsubscribe link missing from body (CAN-SPAM)");
    }
    const postal = (opts.senderPostalAddress ?? "").trim();
    if (postal === "") {
      issues.push("email: no sender postal address provided (CAN-SPAM)");
    } else if (!text.includes(postal) || !html.includes(postal)) {
      issues.push("email: physical postal address missing from body (CAN-SPAM)");
    }
  }

  if (draft.sms) {
    if (!/reply stop/i.test(draft.sms.body)) {
      issues.push("sms: missing 'Reply STOP to opt out' notice (TCPA)");
    }
  }

  return issues;
}
