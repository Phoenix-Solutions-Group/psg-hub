import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail as defaultSendEmail } from "@/lib/mail/sendgrid";
import type { MailMessage } from "@/lib/mail/types";
import { contactHash, normalizeContact } from "@/lib/ops/solicitation/contact";
import { isOptedOut } from "@/lib/ops/solicitation/optout";
import { supabaseSolicitationStore } from "@/lib/ops/solicitation/store";
import { makeUnsubscribeToken } from "@/lib/ops/solicitation/token";
import type { SolicitationChannel } from "@/lib/ops/solicitation/types";
import { sendSms as defaultSendSms } from "@/lib/sms/twilio";
import type { SmsMessage } from "@/lib/sms/types";
import { NURTURE_PATHS } from "./sequences";
import type { NurturePath, NurtureSkipReason, NurtureStepDefinition } from "./types";

type StepStatus = "sent" | "skipped" | "failed";

export interface NurtureEnrollmentRow {
  id: string;
  path: NurturePath;
  status: "active" | "exited" | "completed";
  email_contact_hash: string | null;
  sms_contact_hash: string | null;
  company_id: string | null;
  enrolled_at: string;
  contact_jsonb?: NurtureContactPayload | null;
  template_jsonb?: NurtureTemplatePayload | null;
}

export interface NurtureContactPayload {
  firstName?: string | null;
  shopName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface NurtureEmailTemplate {
  subject: string;
  text: string;
  html: string;
  from?: MailMessage["from"];
  replyTo?: MailMessage["replyTo"];
}

export interface NurtureSmsTemplate {
  body: string;
}

export interface NurtureStepTemplate {
  email?: NurtureEmailTemplate;
  sms?: NurtureSmsTemplate;
}

export interface NurtureTemplatePayload {
  senderPostalAddress?: string | null;
  publicBaseUrl?: string | null;
  steps?: Record<string, NurtureStepTemplate | undefined>;
}

export interface NurtureStepEventRow {
  enrollment_id: string;
  step_id: string;
  channel: SolicitationChannel;
  status: StepStatus;
  skip_reason?: string | null;
  provider_ref?: string | null;
  error?: string | null;
  company_id?: string | null;
}

interface NurtureConsentEvent {
  state: "opted_in" | "opted_out";
  created_at?: string;
}

export interface NurturePublisherStore {
  claimDueEnrollments(limit: number, asOf: Date): Promise<NurtureEnrollmentRow[]>;
  eventExists(enrollmentId: string, stepId: string, channel: SolicitationChannel): Promise<boolean>;
  recordStepEvent(row: NurtureStepEventRow): Promise<void>;
  latestConsent(channel: SolicitationChannel, contactHash: string): Promise<NurtureConsentEvent | null>;
  isOptedOut(channel: SolicitationChannel, contactHash: string): Promise<boolean>;
}

export interface RunNurturePublisherArgs {
  store: NurturePublisherStore;
  sendEmail?: typeof defaultSendEmail;
  sendSms?: typeof defaultSendSms;
  limit?: number;
  asOf?: Date;
  publicBaseUrl?: string;
  senderPostalAddress?: string;
  hashSalt?: string;
  /**
   * Fail-closed release gate. Nick's 2026-07-12 instruction: no nurture email or SMS
   * may leave the system until the board approves outbound sending.
   */
  outboundApproved?: boolean;
}

export interface RunNurturePublisherResult {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 50;

function dueAt(enrolledAt: string, step: NurtureStepDefinition): Date {
  return new Date(new Date(enrolledAt).getTime() + step.dayOffset * DAY_MS);
}

function isDue(enrollment: NurtureEnrollmentRow, step: NurtureStepDefinition, asOf: Date): boolean {
  return dueAt(enrollment.enrolled_at, step).getTime() <= asOf.getTime();
}

function rawContact(enrollment: NurtureEnrollmentRow, channel: SolicitationChannel): string | null | undefined {
  return channel === "email" ? enrollment.contact_jsonb?.email : enrollment.contact_jsonb?.phone;
}

function expectedHash(enrollment: NurtureEnrollmentRow, channel: SolicitationChannel): string | null {
  return channel === "email" ? enrollment.email_contact_hash : enrollment.sms_contact_hash;
}

function renderVars(
  value: string,
  vars: Record<string, string>
): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? "");
}

function appBaseUrl(enrollment: NurtureEnrollmentRow, args: RunNurturePublisherArgs): string {
  return (
    enrollment.template_jsonb?.publicBaseUrl ??
    args.publicBaseUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://hub.psgweb.me"
  ).replace(/\/+$/, "");
}

function senderPostalAddress(enrollment: NurtureEnrollmentRow, args: RunNurturePublisherArgs): string {
  return (
    enrollment.template_jsonb?.senderPostalAddress ??
    args.senderPostalAddress ??
    process.env.NURTURE_SENDER_POSTAL_ADDRESS ??
    ""
  ).trim();
}

function outboundApproved(args: RunNurturePublisherArgs): boolean {
  return args.outboundApproved ?? process.env.NURTURE_OUTBOUND_APPROVED === "true";
}

function unsubscribeUrl(enrollment: NurtureEnrollmentRow, email: string, args: RunNurturePublisherArgs): string {
  const token = makeUnsubscribeToken("email", email);
  if (!token) return "";
  return `${appBaseUrl(enrollment, args)}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

function renderEmail(
  enrollment: NurtureEnrollmentRow,
  template: NurtureEmailTemplate,
  args: RunNurturePublisherArgs
): { message: MailMessage; issues: string[] } {
  const to = normalizeContact("email", enrollment.contact_jsonb?.email);
  const postalAddress = senderPostalAddress(enrollment, args);
  const unsub = unsubscribeUrl(enrollment, to, args);
  const vars = {
    first_name: enrollment.contact_jsonb?.firstName?.trim() ?? "",
    shop_name: enrollment.contact_jsonb?.shopName?.trim() ?? "",
    unsubscribe_url: unsub,
    physical_address: postalAddress,
  };
  const subject = renderVars(template.subject, vars);
  const text = renderVars(template.text, vars);
  const html = renderVars(template.html, vars);
  const issues: string[] = [];
  if (!subject.trim()) issues.push("email subject missing");
  if (!postalAddress || !text.includes(postalAddress) || !html.includes(postalAddress)) {
    issues.push("physical mailing address missing");
  }
  if (!unsub || !text.includes(unsub) || !html.includes(unsub)) {
    issues.push("one-click unsubscribe link missing");
  }
  return {
    message: {
      to,
      subject,
      text,
      html,
      from: template.from,
      replyTo: template.replyTo,
    },
    issues,
  };
}

function renderSms(
  enrollment: NurtureEnrollmentRow,
  template: NurtureSmsTemplate
): { message: SmsMessage; issues: string[] } {
  const to = normalizeContact("sms", enrollment.contact_jsonb?.phone);
  const body = renderVars(template.body, {
    first_name: enrollment.contact_jsonb?.firstName?.trim() ?? "",
    shop_name: enrollment.contact_jsonb?.shopName?.trim() ?? "",
  });
  const issues = /reply stop/i.test(body) ? [] : ["Reply STOP opt-out notice missing"];
  return { message: { to, body }, issues };
}

async function sendStep(
  enrollment: NurtureEnrollmentRow,
  step: NurtureStepDefinition,
  channel: SolicitationChannel,
  args: RunNurturePublisherArgs
): Promise<{ status: StepStatus; skipReason?: NurtureSkipReason; providerRef?: string; error?: string }> {
  if (!outboundApproved(args)) {
    return { status: "skipped", skipReason: "board_approval_required" };
  }
  const storedHash = expectedHash(enrollment, channel);
  const normalized = normalizeContact(channel, rawContact(enrollment, channel));
  const computedHash = contactHash(channel, normalized, { salt: args.hashSalt });
  if (!storedHash || !normalized || storedHash !== computedHash) {
    return { status: "skipped", skipReason: "no_contact" };
  }
  if (await args.store.eventExists(enrollment.id, step.id, channel)) {
    return { status: "skipped", skipReason: "already_audited" };
  }
  if (await args.store.isOptedOut(channel, storedHash)) {
    return { status: "skipped", skipReason: "opted_out" };
  }
  if (channel === "sms") {
    const consent = await args.store.latestConsent("sms", storedHash);
    if (consent?.state !== "opted_in") {
      return { status: "skipped", skipReason: "no_consent" };
    }
  }

  const template = enrollment.template_jsonb?.steps?.[step.id]?.[channel];
  if (!template) return { status: "skipped", skipReason: "missing_template" };

  try {
    if (channel === "email") {
      const rendered = renderEmail(enrollment, template as NurtureEmailTemplate, args);
      if (rendered.issues.length > 0) {
        return {
          status: "skipped",
          skipReason: "non_compliant_template",
          error: rendered.issues.join("; "),
        };
      }
      const result = await (args.sendEmail ?? defaultSendEmail)(rendered.message);
      return { status: "sent", providerRef: result.messageId };
    }
    const rendered = renderSms(enrollment, template as NurtureSmsTemplate);
    if (rendered.issues.length > 0) {
      return {
        status: "skipped",
        skipReason: "non_compliant_template",
        error: rendered.issues.join("; "),
      };
    }
    const result = await (args.sendSms ?? defaultSendSms)(rendered.message);
    return { status: "sent", providerRef: result.sid };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runNurturePublisher(args: RunNurturePublisherArgs): Promise<RunNurturePublisherResult> {
  const asOf = args.asOf ?? new Date();
  const enrollments = await args.store.claimDueEnrollments(args.limit ?? DEFAULT_LIMIT, asOf);
  const result: RunNurturePublisherResult = {
    claimed: enrollments.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const enrollment of enrollments) {
    const steps = NURTURE_PATHS[enrollment.path]?.steps ?? [];
    for (const step of steps) {
      if (!isDue(enrollment, step, asOf)) continue;
      for (const channel of step.channels) {
        const outcome = await sendStep(enrollment, step, channel, args);
        if (outcome.skipReason === "already_audited") continue;
        await args.store.recordStepEvent({
          enrollment_id: enrollment.id,
          step_id: step.id,
          channel,
          status: outcome.status,
          skip_reason: outcome.skipReason ?? null,
          provider_ref: outcome.providerRef ?? null,
          error: outcome.error ?? null,
          company_id: enrollment.company_id,
        });
        result[outcome.status] += 1;
      }
    }
  }

  return result;
}

export function supabaseNurturePublisherStore(service: SupabaseClient): NurturePublisherStore {
  const solicitationStore = supabaseSolicitationStore(service);
  return {
    async claimDueEnrollments(limit) {
      const { data, error } = await service
        .from("nurture_enrollments")
        .select(
          "id,path,status,email_contact_hash,sms_contact_hash,company_id,enrolled_at,contact_jsonb,template_jsonb"
        )
        .eq("status", "active")
        .order("enrolled_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`nurture enrollment claim failed: ${error.message}`);
      return (data as unknown as NurtureEnrollmentRow[] | null) ?? [];
    },
    async eventExists(enrollmentId, stepId, channel) {
      const { data, error } = await service
        .from("nurture_step_events")
        .select("id")
        .eq("enrollment_id", enrollmentId)
        .eq("step_id", stepId)
        .eq("channel", channel)
        .maybeSingle();
      if (error) throw new Error(`nurture event lookup failed: ${error.message}`);
      return data != null;
    },
    async recordStepEvent(row) {
      const { error } = await service
        .from("nurture_step_events")
        .upsert(
          {
            enrollment_id: row.enrollment_id,
            step_id: row.step_id,
            channel: row.channel,
            status: row.status,
            skip_reason: row.skip_reason ?? null,
            provider_ref: row.provider_ref ?? null,
            error: row.error ?? null,
            company_id: row.company_id ?? null,
          },
          {
            onConflict: "enrollment_id,step_id,channel",
            ignoreDuplicates: true,
          }
        );
      if (error) throw new Error(`nurture event record failed: ${error.message}`);
    },
    async latestConsent(channel, contactHashValue) {
      const { data, error } = await service
        .from("nurture_consent_events")
        .select("state,created_at")
        .eq("channel", channel)
        .eq("contact_hash", contactHashValue)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`nurture consent lookup failed: ${error.message}`);
      return (data as NurtureConsentEvent | null) ?? null;
    },
    async isOptedOut(channel, contactHashValue) {
      return isOptedOut(await solicitationStore.getOptOutEvents(channel, contactHashValue));
    },
  };
}
