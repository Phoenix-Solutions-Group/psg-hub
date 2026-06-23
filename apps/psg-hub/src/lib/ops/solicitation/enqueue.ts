// PSG-248 — draft + govern: build a compliant solicitation and queue it for approval.
//
// This is the "drafted, governed" half of the acceptance, in one call: it renders
// the copy (draft.ts), mints the per-recipient unsubscribe link, REFUSES to queue
// anything that fails the CAN-SPAM / TCPA compliance check, and enqueues the action
// through the generic approval queue (PSG-245) as action_type "review_solicitation".
// Nothing is sent here — sending happens ONLY when a human approves the queued item
// (publisher.ts). A cron (daily review run) or an HTTP route is a thin wrapper that
// picks recipients and calls this once per recipient.

import {
  enqueueApproval,
  type ApprovalQueueRow,
  type ApprovalQueueStore,
} from "../approval-queue/gate";
import { buildSolicitationDraft, validateDraftCompliance } from "./draft";
import { makeUnsubscribeToken } from "./token";
import {
  SOLICITATION_ACTION_TYPE,
  type ChannelConsent,
  type SolicitationChannel,
  type SolicitationPayload,
} from "./types";

export class SolicitationComplianceError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`solicitation draft is not compliant: ${issues.join("; ")}`);
    this.name = "SolicitationComplianceError";
    this.issues = issues;
  }
}

export interface EnqueueSolicitationArgs {
  shopId: string;
  shopName: string;
  channels: SolicitationChannel[];
  recipient: {
    firstName?: string | null;
    email?: string | null;
    phone?: string | null;
    householdKey?: string | null;
  };
  consent: ChannelConsent;
  /** Where the customer leaves the review (their GBP / Yelp write-a-review URL). */
  reviewUrl: string;
  /** The sender's physical postal address — required by CAN-SPAM on the email. */
  senderPostalAddress: string;
  /** Public base URL the unsubscribe link is built against (e.g. NEXT_PUBLIC_APP_URL). */
  appBaseUrl: string;
  /** Agent id / automation source that proposed this. */
  proposedBy?: string | null;
  companyId?: string | null;
}

/** Build the absolute one-click unsubscribe URL for an email recipient. */
function unsubscribeUrlFor(args: EnqueueSolicitationArgs): string {
  if (!args.channels.includes("email") || !args.recipient.email) return "";
  const token = makeUnsubscribeToken("email", args.recipient.email);
  if (token === "") return "";
  const base = args.appBaseUrl.replace(/\/+$/, "");
  return `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Draft a compliant solicitation and queue it for human approval. THROWS a
 * SolicitationComplianceError (→ caller maps to 422) when the rendered draft is
 * missing a legally-required element, so a non-compliant message can never reach
 * the queue. Returns the queued approval_queue row.
 */
export async function enqueueSolicitation(
  store: ApprovalQueueStore,
  args: EnqueueSolicitationArgs
): Promise<ApprovalQueueRow> {
  const unsubscribeUrl = unsubscribeUrlFor(args);

  const draft = buildSolicitationDraft({
    shopName: args.shopName,
    recipientFirstName: args.recipient.firstName,
    reviewUrl: args.reviewUrl,
    unsubscribeUrl,
    senderPostalAddress: args.senderPostalAddress,
    channels: args.channels,
  });

  const issues = validateDraftCompliance(draft, {
    unsubscribeUrl,
    senderPostalAddress: args.senderPostalAddress,
  });
  if (issues.length > 0) throw new SolicitationComplianceError(issues);

  const payload: SolicitationPayload = {
    shopId: args.shopId,
    shopName: args.shopName,
    channels: args.channels,
    recipient: args.recipient,
    consent: args.consent,
    draft,
    companyId: args.companyId ?? null,
  };

  const channelLabel = args.channels.join(" + ");
  return enqueueApproval(store, {
    shopId: args.shopId,
    actionType: SOLICITATION_ACTION_TYPE,
    title: `Review request (${channelLabel})`,
    summary: `Ask ${args.recipient.firstName ?? "a recent customer"} for a review of ${args.shopName}.`,
    payload: payload as unknown as Record<string, unknown>,
    proposedBy: args.proposedBy ?? null,
  });
}
