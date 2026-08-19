import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactHash } from "@/lib/ops/solicitation/contact";
import type { PipedrivePersonContact } from "@/lib/pipedrive/client";
import { pathForTrigger } from "./sequences";
import type {
  NurtureContact,
  NurtureExitReason,
  NurturePath,
  NurtureTrigger,
} from "./types";

type DbError = { message: string };

interface QueryResult<T = unknown> {
  data: T | null;
  error: DbError | null;
}

interface QueryBuilder<T = unknown> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  in(column: string, values: unknown[]): QueryBuilder<T>;
  lte(column: string, value: unknown): QueryBuilder<T>;
  is(column: string, value: unknown): QueryBuilder<T>;
  or(filters: string): QueryBuilder<T>;
  single(): QueryBuilder<T>;
  upsert(row: Record<string, unknown>, options?: { onConflict?: string }): QueryBuilder<T>;
  update(row: Record<string, unknown>): QueryBuilder<T>;
}

export interface NurtureSupabase {
  from<T = unknown>(table: string): QueryBuilder<T>;
}

export interface NurturePipedriveContactClient {
  fetchPersonContact(personId: number): Promise<PipedrivePersonContact | null>;
}

export interface EnrollNurtureArgs {
  trigger: NurtureTrigger;
  triggerRef: string;
  contact: NurtureContact;
  path?: NurturePath;
  pipedriveDealId?: number | null;
  pipedrivePersonId?: number | null;
  pipedriveOrgId?: number | null;
  companyId?: string | null;
  enrolledAt?: string;
  templateJsonb?: Record<string, unknown>;
  pipedriveClient?: NurturePipedriveContactClient | null;
}

export interface EnrollNurtureResult {
  path: NurturePath;
  triggerRef: string;
  emailContactHash: string | null;
  smsContactHash: string | null;
}

export interface StalledDealRow {
  deal_id: number;
  person_id: number | null;
  org_id: number | null;
  last_activity_date: string | null;
}

const ENROLLMENTS_TABLE = "nurture_enrollments";
const STALLED_DEAL_SELECT = "deal_id, person_id, org_id, last_activity_date";

function assertPath(trigger: NurtureTrigger, explicit?: NurturePath): NurturePath {
  const path = explicit ?? pathForTrigger(trigger);
  if (!path) throw new Error(`Unsupported nurture trigger: ${trigger}`);
  return path;
}

function normalizeTriggerRef(triggerRef: string): string {
  const ref = triggerRef.trim();
  if (!ref) throw new Error("Nurture enrollment requires trigger_ref");
  return ref;
}

function hashesFor(contact: NurtureContact): {
  emailContactHash: string | null;
  smsContactHash: string | null;
} {
  const emailContactHash = contactHash("email", contact.email) || null;
  const smsContactHash = contactHash("sms", contact.phone) || null;
  return { emailContactHash, smsContactHash };
}

function contactPayload(contact: NurtureContact): Record<string, unknown> {
  return {
    firstName: contact.firstName ?? null,
    shopName: contact.shopName ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
  };
}

function hasContactDetail(contact: NurtureContact): boolean {
  return Boolean(contact.email?.trim() || contact.phone?.trim());
}

async function hydratePipedriveContact(args: EnrollNurtureArgs): Promise<NurtureContact> {
  const contact = args.contact;
  if (hasContactDetail(contact) || !args.pipedriveClient || args.pipedrivePersonId == null) {
    return contact;
  }

  const person = await args.pipedriveClient
    .fetchPersonContact(args.pipedrivePersonId)
    .catch(() => null);
  if (!person) return contact;
  return {
    ...contact,
    firstName: contact.firstName ?? person.firstName,
    email: contact.email ?? person.email,
    phone: contact.phone ?? person.phone,
  };
}

export async function enrollNurturePath(
  service: SupabaseClient | NurtureSupabase,
  args: EnrollNurtureArgs
): Promise<EnrollNurtureResult> {
  const path = assertPath(args.trigger, args.path);
  const triggerRef = normalizeTriggerRef(args.triggerRef);
  const contact = await hydratePipedriveContact(args);
  const { emailContactHash, smsContactHash } = hashesFor(contact);

  if (!emailContactHash && !smsContactHash && args.pipedriveDealId == null) {
    throw new Error("Nurture enrollment requires a contact hash or Pipedrive deal id");
  }

  const { error } = await (service as NurtureSupabase)
    .from(ENROLLMENTS_TABLE)
    .upsert(
      {
        path,
        status: "active",
        pipedrive_deal_id: args.pipedriveDealId ?? null,
        pipedrive_person_id: args.pipedrivePersonId ?? null,
        pipedrive_org_id: args.pipedriveOrgId ?? null,
        email_contact_hash: emailContactHash,
        sms_contact_hash: smsContactHash,
        trigger_ref: triggerRef,
        contact_jsonb: contactPayload(contact),
        template_jsonb: args.templateJsonb ?? {},
        company_id: args.companyId ?? null,
        enrolled_at: args.enrolledAt ?? new Date().toISOString(),
        exit_reason: null,
        exited_at: null,
      },
      { onConflict: "path,trigger_ref" }
    );
  if (error) throw new Error(`Nurture enrollment failed: ${error.message}`);

  return { path, triggerRef, emailContactHash, smsContactHash };
}

export async function exitNurtureEnrollments(
  service: SupabaseClient | NurtureSupabase,
  args: {
    reason: NurtureExitReason;
    triggerRef?: string;
    path?: NurturePath;
    pipedriveDealId?: number;
    email?: string | null;
    phone?: string | null;
    exitedAt?: string;
  }
): Promise<void> {
  let query = (service as NurtureSupabase)
    .from(ENROLLMENTS_TABLE)
    .update({
      status: args.reason === "completed" ? "completed" : "exited",
      exit_reason: args.reason,
      exited_at: args.exitedAt ?? new Date().toISOString(),
    })
    .eq("status", "active");

  if (args.path) query = query.eq("path", args.path);
  if (args.triggerRef) query = query.eq("trigger_ref", normalizeTriggerRef(args.triggerRef));
  if (args.pipedriveDealId != null) query = query.eq("pipedrive_deal_id", args.pipedriveDealId);

  const contactFilters: string[] = [];
  const emailHash = contactHash("email", args.email);
  const smsHash = contactHash("sms", args.phone);
  if (emailHash) contactFilters.push(`email_contact_hash.eq.${emailHash}`);
  if (smsHash) contactFilters.push(`sms_contact_hash.eq.${smsHash}`);
  if (contactFilters.length > 0) query = query.or(contactFilters.join(","));

  const { error } = await query;
  if (error) throw new Error(`Nurture exit failed: ${error.message}`);
}

export function stalledDealCutoff(now = new Date(), days = 14): string {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms).toISOString().slice(0, 10);
}

export async function enrollStalledPipedriveDeals(
  service: SupabaseClient | NurtureSupabase,
  args: {
    now?: Date;
    daysWithoutMovement?: number;
    pipedriveClient?: NurturePipedriveContactClient | null;
  } = {}
): Promise<{ scanned: number; enrolled: number }> {
  const cutoff = stalledDealCutoff(args.now, args.daysWithoutMovement ?? 14);
  const { data, error } = await (service as NurtureSupabase)
    .from<StalledDealRow[]>("pipedrive_deals")
    .select(STALLED_DEAL_SELECT)
    .eq("status", "open")
    .or(`last_activity_date.lte.${cutoff},last_activity_date.is.null`);
  if (error) throw new Error(`Stalled deal lookup failed: ${error.message}`);

  const rows = data ?? [];
  let enrolled = 0;
  for (const deal of rows) {
    await enrollNurturePath(service, {
      trigger: "deal_stale_14_days",
      triggerRef: `pipedrive:deal:${deal.deal_id}:stale_14_days`,
      contact: {},
      pipedriveDealId: deal.deal_id,
      pipedrivePersonId: deal.person_id,
      pipedriveOrgId: deal.org_id,
      pipedriveClient: args.pipedriveClient,
    });
    enrolled += 1;
  }

  return { scanned: rows.length, enrolled };
}
