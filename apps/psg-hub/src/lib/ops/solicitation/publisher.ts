// PSG-248 — the review_solicitation Publisher for the PSG-245 approval queue.
//
// Registered into the server publisher registry (../approval-queue/registry.server.ts)
// so that approving a queued review_solicitation action — and ONLY approving it —
// sends the solicitation. The publisher re-derives the compliance decision at SEND
// time (consent + opt-out + household suppression), so a STOP/unsubscribe that
// arrived AFTER the draft was queued is still honored. Every channel — sent,
// failed, or skipped — writes one immutable row to the send audit.
//
// Idempotent: a send row already present for (approval, channel, contact) is never
// re-sent, so a re-published / retried approval cannot double-text a customer.
//
// Failure semantics: a provider throw records a `failed` audit row. The publisher
// throws (→ approval status `publish_failed`) ONLY when every channel that was
// supposed to send failed AND none succeeded; a partial success (email sent, SMS
// skipped for no-consent) resolves normally so the approval reads `published`.

import "server-only";
import type { Publisher, ApprovalQueueRow } from "../approval-queue/gate";
import { sendEmail as defaultSendEmail } from "@/lib/mail/sendgrid";
import { sendSms as defaultSendSms } from "@/lib/sms/twilio";
import { isSuppressed as defaultIsSuppressed } from "../mail/suppression";
import { contactHash, normalizeContact } from "./contact";
import { isOptedOut } from "./optout";
import { buildSendPlan } from "./plan";
import type { SolicitationStore, SendAuditRow } from "./store";
import type { SolicitationChannel, SolicitationPayload } from "./types";
import { SOLICITATION_CHANNELS } from "./types";

export interface SolicitationPublisherDeps {
  store: SolicitationStore;
  sendEmail?: typeof defaultSendEmail;
  sendSms?: typeof defaultSendSms;
  /** Household do-not-contact check; defaults to the mail suppression engine. */
  isSuppressed?: typeof defaultIsSuppressed;
  /** Injected clock for deterministic tests. */
  now?: () => string;
  /** Salt override for contact hashing (tests). */
  hashSalt?: string;
}

/** Narrow + validate the opaque approval payload into a SolicitationPayload. */
export function parseSolicitationPayload(
  payload: Record<string, unknown>
): SolicitationPayload {
  const p = payload as Partial<SolicitationPayload>;
  if (!p || typeof p !== "object") {
    throw new Error("review_solicitation: payload missing");
  }
  if (!Array.isArray(p.channels) || p.channels.length === 0) {
    throw new Error("review_solicitation: channels[] required");
  }
  const channels = p.channels.filter((c): c is SolicitationChannel =>
    (SOLICITATION_CHANNELS as readonly string[]).includes(c)
  );
  if (channels.length === 0) {
    throw new Error("review_solicitation: no valid channels");
  }
  if (!p.recipient || typeof p.recipient !== "object") {
    throw new Error("review_solicitation: recipient required");
  }
  if (!p.draft || typeof p.draft !== "object") {
    throw new Error("review_solicitation: draft required");
  }
  return {
    shopId: String(p.shopId ?? ""),
    shopName: String(p.shopName ?? ""),
    channels,
    recipient: p.recipient,
    consent: p.consent ?? {},
    draft: p.draft,
    companyId: p.companyId ?? null,
  };
}

function rawContact(
  payload: SolicitationPayload,
  channel: SolicitationChannel
): string | null | undefined {
  return channel === "email" ? payload.recipient.email : payload.recipient.phone;
}

/** Build the review_solicitation publisher bound to its deps. */
export function createSolicitationPublisher(
  deps: SolicitationPublisherDeps
): Publisher {
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const sendSms = deps.sendSms ?? defaultSendSms;
  const isSuppressed = deps.isSuppressed ?? defaultIsSuppressed;
  const now = deps.now ?? (() => new Date().toISOString());
  const salt = deps.hashSalt;

  return async function publish(row: ApprovalQueueRow): Promise<{ ref?: string }> {
    const approvalId = row.id;
    if (!approvalId) {
      throw new Error("review_solicitation: approval row has no id");
    }
    const payload = parseSolicitationPayload(row.payload_jsonb);

    // Household-level do-not-contact (shared with direct mail). Only meaningful
    // when a household key is carried; absent → not suppressed by this list.
    let suppressed = false;
    const hk = payload.recipient.householdKey;
    if (hk) {
      const result = await isSuppressed({ householdKey: hk });
      suppressed = result.suppressed;
    }

    // Per-channel contact + opt-out status.
    const hashByChannel: Partial<Record<SolicitationChannel, string>> = {};
    const hasContact: Partial<Record<SolicitationChannel, boolean>> = {};
    const optedOut: Partial<Record<SolicitationChannel, boolean>> = {};
    for (const channel of payload.channels) {
      const ch = contactHash(channel, rawContact(payload, channel), { salt });
      hashByChannel[channel] = ch;
      hasContact[channel] = ch !== "";
      if (ch !== "") {
        const events = await deps.store.getOptOutEvents(channel, ch);
        optedOut[channel] = isOptedOut(events);
      }
    }

    const plan = buildSendPlan({
      channels: payload.channels,
      consent: payload.consent,
      optedOut,
      hasContact,
      suppressed,
    });

    let sentCount = 0;
    let failedCount = 0;
    const refs: string[] = [];

    for (const decision of plan) {
      const ch = hashByChannel[decision.channel] ?? "";
      const base: SendAuditRow = {
        shop_id: payload.shopId || row.shop_id,
        approval_id: approvalId,
        channel: decision.channel,
        contact_hash: ch,
        status: "skipped",
        company_id: payload.companyId ?? null,
        created_at: now(),
      };

      if (decision.action === "skip") {
        await deps.store.recordSend({ ...base, skip_reason: decision.reason });
        continue;
      }

      // Idempotency: never re-send for a (approval, channel, contact) already
      // recorded — a retried publish must not double-contact the customer.
      if (ch !== "" && (await deps.store.sendExists(approvalId, decision.channel, ch))) {
        continue;
      }

      try {
        const ref = await dispatch(decision.channel, payload, {
          sendEmail,
          sendSms,
        });
        sentCount += 1;
        if (ref) refs.push(ref);
        await deps.store.recordSend({ ...base, status: "sent", provider_ref: ref });
      } catch (err) {
        failedCount += 1;
        await deps.store.recordSend({
          ...base,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Throw to mark publish_failed only on a total send failure (nothing got out).
    if (failedCount > 0 && sentCount === 0) {
      throw new Error(
        `review_solicitation: all ${failedCount} send(s) failed for approval ${approvalId}`
      );
    }
    return { ref: refs.join(",") || undefined };
  };
}

/** Send one channel; returns the provider reference. Throws on provider failure. */
async function dispatch(
  channel: SolicitationChannel,
  payload: SolicitationPayload,
  senders: { sendEmail: typeof defaultSendEmail; sendSms: typeof defaultSendSms }
): Promise<string | undefined> {
  if (channel === "email") {
    const email = payload.draft.email;
    const to = normalizeContact("email", payload.recipient.email);
    if (!email || to === "") throw new Error("email: no draft or no recipient");
    const result = await senders.sendEmail({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    return result.messageId;
  }
  const sms = payload.draft.sms;
  const to = normalizeContact("sms", payload.recipient.phone);
  if (!sms || to === "") throw new Error("sms: no draft or no recipient");
  const result = await senders.sendSms({ to, body: sms.body });
  return result.sid;
}
