import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail as defaultSendEmail } from "@/lib/mail/sendgrid";
import type { MailMessage, MailResult } from "@/lib/mail/types";

export const BSM_APPROVAL_NOTIFICATION_EVENTS = [
  "comment_created",
  "decision_approved",
  "decision_declined",
  "decision_updates_requested",
] as const;

export type BsmApprovalNotificationEvent =
  (typeof BSM_APPROVAL_NOTIFICATION_EVENTS)[number];

export type BsmApprovalAdminRecipient = {
  profileId?: string;
  email?: string;
};

export type BsmApprovalNotificationInput = {
  shopId: string;
  shopName: string;
  reviewItemId: string;
  reviewItemTitle: string;
  eventKey: string;
  eventType: BsmApprovalNotificationEvent;
  actorName?: string | null;
  messagePreview?: string | null;
  appBaseUrl: string;
  recipients?: BsmApprovalAdminRecipient[];
};

export type BsmApprovalNotificationResult = {
  inAppCreated: number;
  inAppSkipped: number;
  emailSent: number;
  emailSkipped: number;
  emailFailed: number;
};

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  action_url: string;
};

type InsertOutcome =
  | { status: "created"; row: NotificationRow }
  | { status: "duplicate" };

type SendEmail = (message: MailMessage) => Promise<MailResult | unknown>;

export type BsmApprovalNotificationDeps = {
  sendEmail?: SendEmail;
  now?: Date;
};

const EVENT_COPY: Record<
  BsmApprovalNotificationEvent,
  { title: string; verb: string }
> = {
  comment_created: {
    title: "Customer commented on content",
    verb: "commented on",
  },
  decision_approved: {
    title: "Customer approved content",
    verb: "approved",
  },
  decision_declined: {
    title: "Customer declined content",
    verb: "declined",
  },
  decision_updates_requested: {
    title: "Customer requested updates",
    verb: "requested updates to",
  },
};

export function normalizeBsmApprovalAdminEmails(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.includes("@")))];
}

export function bsmApprovalReviewUrl(appBaseUrl: string, reviewItemId: string): string {
  const base = appBaseUrl.replace(/\/+$/, "");
  return `${base}/ops/bsm/content-approvals/${encodeURIComponent(reviewItemId)}`;
}

export function buildBsmApprovalNotificationCopy(input: BsmApprovalNotificationInput): {
  title: string;
  body: string;
  actionUrl: string;
} {
  const copy = EVENT_COPY[input.eventType];
  const actor = cleanText(input.actorName) ?? "A customer";
  const shop = cleanText(input.shopName) ?? "a customer shop";
  const item = cleanText(input.reviewItemTitle) ?? "a content review item";
  const preview = cleanText(input.messagePreview);
  const detail = preview ? ` Message: "${preview}"` : "";

  return {
    title: copy.title,
    body: `${actor} ${copy.verb} "${item}" for ${shop}.${detail}`,
    actionUrl: bsmApprovalReviewUrl(input.appBaseUrl, input.reviewItemId),
  };
}

export async function listBsmApprovalAdminRecipients(
  service: SupabaseClient,
  explicitRecipients: BsmApprovalAdminRecipient[] = [],
): Promise<BsmApprovalAdminRecipient[]> {
  const recipients = new Map<string, BsmApprovalAdminRecipient>();
  for (const recipient of explicitRecipients) {
    addRecipient(recipients, recipient);
  }

  for (const email of normalizeBsmApprovalAdminEmails(process.env.BSM_APPROVAL_ADMIN_EMAILS)) {
    addRecipient(recipients, { email });
  }

  const { data, error } = await service
    .from("app_user_roles")
    .select("profile_id")
    .in("role", ["psg_internal", "psg_superadmin"]);
  if (error) {
    throw new Error(`listBsmApprovalAdminRecipients: ${error.message}`);
  }

  for (const row of data ?? []) {
    const profileId = (row as { profile_id?: unknown }).profile_id;
    if (typeof profileId === "string") {
      addRecipient(recipients, { profileId });
    }
  }

  return [...recipients.values()];
}

export async function notifyBsmApprovalAdmins(
  service: SupabaseClient,
  input: BsmApprovalNotificationInput,
  deps: BsmApprovalNotificationDeps = {},
): Promise<BsmApprovalNotificationResult> {
  const copy = buildBsmApprovalNotificationCopy(input);
  const recipients = await listBsmApprovalAdminRecipients(service, input.recipients);
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const now = (deps.now ?? new Date()).toISOString();

  const result: BsmApprovalNotificationResult = {
    inAppCreated: 0,
    inAppSkipped: 0,
    emailSent: 0,
    emailSkipped: 0,
    emailFailed: 0,
  };

  for (const recipient of recipients) {
    if (recipient.profileId) {
      const outcome = await insertNotification(service, {
        input,
        copy,
        channel: "in_app",
        recipientProfileId: recipient.profileId,
        status: "unread",
      });
      if (outcome.status === "created") result.inAppCreated += 1;
      else result.inAppSkipped += 1;
    }

    if (recipient.email) {
      const outcome = await insertNotification(service, {
        input,
        copy,
        channel: "email",
        recipientEmail: recipient.email,
        status: "queued",
      });
      if (outcome.status === "duplicate") {
        result.emailSkipped += 1;
        continue;
      }

      try {
        const sendResult = await sendEmail(toEmailMessage(outcome.row));
        await markEmailNotificationSent(service, outcome.row.id, {
          messageId: maybeMessageId(sendResult),
          now,
        });
        result.emailSent += 1;
      } catch (error) {
        await markEmailNotificationFailed(service, outcome.row.id, error, now);
        result.emailFailed += 1;
      }
    }
  }

  return result;
}

function addRecipient(
  recipients: Map<string, BsmApprovalAdminRecipient>,
  recipient: BsmApprovalAdminRecipient,
): void {
  const profileId = cleanText(recipient.profileId);
  const email = cleanText(recipient.email)?.toLowerCase();
  if (profileId) recipients.set(`profile:${profileId}`, { profileId });
  if (email && email.includes("@")) recipients.set(`email:${email}`, { email });
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function isDuplicateInsert(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

async function insertNotification(
  service: SupabaseClient,
  args: {
    input: BsmApprovalNotificationInput;
    copy: ReturnType<typeof buildBsmApprovalNotificationCopy>;
    channel: "in_app" | "email";
    recipientProfileId?: string;
    recipientEmail?: string;
    status: "unread" | "queued";
  },
): Promise<InsertOutcome> {
  const { input, copy } = args;
  const { data, error } = await service
    .from("bsm_content_approval_notifications")
    .insert({
      shop_id: input.shopId,
      review_item_id: input.reviewItemId,
      event_key: input.eventKey,
      event_type: input.eventType,
      channel: args.channel,
      recipient_profile_id: args.recipientProfileId ?? null,
      recipient_email: args.recipientEmail ?? null,
      title: copy.title,
      body: copy.body,
      action_url: copy.actionUrl,
      status: args.status,
    })
    .select("id,title,body,action_url,recipient_email")
    .single();

  if (error) {
    if (isDuplicateInsert(error)) return { status: "duplicate" };
    throw new Error(`insertBsmApprovalNotification: ${error.message}`);
  }

  return { status: "created", row: data as NotificationRow };
}

function toEmailMessage(row: NotificationRow): MailMessage {
  return {
    to: rowHasEmail(row),
    subject: row.title,
    text: `${row.body}\n\nOpen the review item: ${row.action_url}`,
    html: `<p>${escapeHtml(row.body)}</p><p><a href="${escapeHtml(row.action_url)}">Open the review item</a></p>`,
    clickTracking: false,
  };
}

function rowHasEmail(row: NotificationRow): string {
  const maybe = (row as NotificationRow & { recipient_email?: string }).recipient_email;
  if (!maybe) {
    throw new Error("email notification row did not include recipient_email");
  }
  return maybe;
}

async function markEmailNotificationSent(
  service: SupabaseClient,
  id: string,
  options: { messageId?: string; now: string },
): Promise<void> {
  const { error } = await service
    .from("bsm_content_approval_notifications")
    .update({
      status: "sent",
      attempts: 1,
      send_message_id: options.messageId ?? null,
      sent_at: options.now,
      last_error: null,
    })
    .eq("id", id);
  if (error) throw new Error(`markEmailNotificationSent: ${error.message}`);
}

async function markEmailNotificationFailed(
  service: SupabaseClient,
  id: string,
  error: unknown,
  now: string,
): Promise<void> {
  const message = error instanceof Error ? error.message : "Email send failed";
  const { error: updateError } = await service
    .from("bsm_content_approval_notifications")
    .update({
      status: "failed",
      attempts: 1,
      last_error: message.slice(0, 1000),
      sent_at: null,
      updated_at: now,
    })
    .eq("id", id);
  if (updateError) throw new Error(`markEmailNotificationFailed: ${updateError.message}`);
}

function maybeMessageId(value: unknown): string | undefined {
  if (value && typeof value === "object" && "messageId" in value) {
    const id = (value as { messageId?: unknown }).messageId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
