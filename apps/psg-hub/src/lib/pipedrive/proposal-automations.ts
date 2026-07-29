import type {
  CreateActivityInput,
  DealActivitySummary,
  PipedriveDealPerson,
  PipedriveProjectsClient,
  PipedriveUser,
  PipedriveUserConnections,
} from "./projects";
import {
  createGmailDraftAdapter,
  loadGmailDraftConfig,
  type GmailDraftAdapter,
  type GmailDraftRecipient,
} from "@/lib/gmail/drafts";
import {
  createGoogleCalendarAvailabilityAdapter,
  loadGoogleCalendarConfig,
  type CalendarAvailabilityAdapter,
  type CalendarBusyInterval,
} from "@/lib/google-calendar/freebusy";

type DealPayload = Record<string, unknown>;

export type ProposalAutomationResult =
  | { status: "skipped"; reason: string }
  | { status: "connection_missing"; reason: string }
  | { status: "created"; activityIds: number[]; draftIds?: string[] }
  | { status: "reused"; activityIds: number[]; draftIds?: string[] }
  | { status: "stopped"; stoppedActivityIds: number[] };

export interface ProposalAutomationSummary {
  proposalPrepBlock?: ProposalAutomationResult;
  proposalDraftSeries?: ProposalAutomationResult;
}

const DEFAULT_SALES_PIPELINE_ID = 8;
const DEFAULT_QUALIFIED_STAGE_ID = 56;
const DEFAULT_PROPOSAL_SENT_STAGE_ID = 59;
const DEFAULT_PROPOSAL_DRAFT_STOP_STAGE_IDS = [60, 61];
const PROPOSAL_PREP_SUBJECT_PREFIX = "Proposal prep:";
const PROPOSAL_DRAFT_SUBJECT_PREFIX = "Proposal follow-up draft";
const PROPOSAL_PREP_DURATION_MINUTES = 45;
const PROPOSAL_PREP_WORKDAY_START_HOUR = 7;
const PROPOSAL_PREP_WORKDAY_END_HOUR = 18;
const DEFAULT_PROPOSAL_PREP_TIME_ZONE = "America/New_York";

const PLACEHOLDER_TOUCHES = [
  { dayOffset: 2, label: "Touch 1", subject: "Quick follow-up on the proposal" },
  { dayOffset: 6, label: "Touch 2", subject: "One thing that might help" },
  { dayOffset: 11, label: "Touch 3", subject: "Anything I can clear up?" },
  { dayOffset: 16, label: "Touch 4", subject: "One more thing worth a look" },
  { dayOffset: 21, label: "Touch 5", subject: "Should I keep this open, or close it out?" },
] as const;
const CUSTOMER_CONTACT_ACTIVITY_TYPES = new Set(["call", "meeting", "email", "lunch"]);

function numberFromEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const parsed = Number(env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberListFromEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number[],
): number[] {
  const raw = env[key];
  if (!raw) return fallback;
  const values = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
  return values.length > 0 ? values : fallback;
}

function relId(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const row = v as Record<string, unknown>;
    const n = Number(row.value ?? row.id);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function relName(v: unknown): string | null {
  if (v && typeof v === "object") {
    const name = (v as Record<string, unknown>).name;
    return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
  }
  return null;
}

function stageId(deal: DealPayload | null | undefined): number | null {
  return deal ? relId(deal.stage_id) : null;
}

function dealPipelineId(deal: DealPayload | null | undefined): number | null {
  return deal ? relId(deal.pipeline_id) : null;
}

function dealId(deal: DealPayload | null | undefined): number | null {
  const id = Number(deal?.id);
  return Number.isFinite(id) ? id : null;
}

function personId(deal: DealPayload): number | undefined {
  return relId(deal.person_id) ?? undefined;
}

function orgId(deal: DealPayload): number | undefined {
  return relId(deal.org_id) ?? undefined;
}

function ownerId(deal: DealPayload): number | undefined {
  return relId(deal.user_id) ?? relId(deal.owner_id) ?? undefined;
}

function dealTitle(deal: DealPayload): string {
  return typeof deal.title === "string" && deal.title.trim() !== ""
    ? deal.title.trim()
    : `Deal ${dealId(deal) ?? "unknown"}`;
}

function dealOrgName(deal: DealPayload): string | null {
  return (
    (typeof deal.org_name === "string" && deal.org_name.trim() !== ""
      ? deal.org_name.trim()
      : null) ?? relName(deal.org_id)
  );
}

function dealValue(deal: DealPayload): string | null {
  const value = Number(deal.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  const currency = typeof deal.currency === "string" && deal.currency ? deal.currency : "USD";
  return `${currency} ${value.toLocaleString("en-US")}`;
}

function stringField(
  deal: DealPayload,
  env: Record<string, string | undefined>,
  envKey: string,
): string | null {
  const fieldKey = env[envKey]?.trim();
  const value = fieldKey ? deal[fieldKey] : null;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function proposalContext(
  current: DealPayload,
  env: Record<string, string | undefined>,
): {
  proofPoint: string;
  nickPhone: string;
  nickCalendarLink: string;
} {
  const proofPoint =
    stringField(current, env, "PIPEDRIVE_PROOF_BLOCK_FIELD_KEY") ??
    env.PIPEDRIVE_PROPOSAL_FALLBACK_PROOF_BLOCK?.trim() ??
    "Most independent shops we work with see the biggest jump in the first 90 days, once the new work is live. That is usually the point where it is worth looking at the numbers together.";

  return {
    proofPoint,
    nickPhone: env.PIPEDRIVE_PROPOSAL_NICK_PHONE?.trim() || "my direct line",
    nickCalendarLink: env.PIPEDRIVE_PROPOSAL_NICK_CALENDAR_LINK?.trim() || "reply here and we can set a time",
  };
}

function ownerIdFromEnv(env: Record<string, string | undefined>): number | undefined {
  const parsed = Number(env.PIPEDRIVE_PROPOSAL_PREP_OWNER_ID ?? env.PIPEDRIVE_PROPOSAL_OWNER_ID);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isoDateFromDeal(deal: DealPayload): string {
  const stamp =
    typeof deal.update_time === "string" && deal.update_time.trim() !== ""
      ? deal.update_time
      : typeof deal.add_time === "string" && deal.add_time.trim() !== ""
        ? deal.add_time
        : new Date().toISOString();
  return stamp.slice(0, 10);
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addBusinessDays(startDate: string, days: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return startDate;
  let added = 0;
  while (added < days) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) added += 1;
  }
  while (isWeekend(date)) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(startDate: string, days: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return startDate;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isStageTransition(
  current: DealPayload | null,
  previous: DealPayload | null | undefined,
  targetStageId: number,
): boolean {
  if (!current) return false;
  const currentStageId = stageId(current);
  const previousStageId = stageId(previous);
  return currentStageId === targetStageId && previousStageId !== currentStageId;
}

function isSalesPipeline(
  current: DealPayload | null,
  env: Record<string, string | undefined>,
): boolean {
  const expected = numberFromEnv(env, "PIPEDRIVE_SALES_PIPELINE_ID", DEFAULT_SALES_PIPELINE_ID);
  return current != null && dealPipelineId(current) === expected;
}

function hasGoogleConnection(connections: PipedriveUserConnections): boolean {
  const google = connections.google;
  if (typeof google === "string") return google.trim() !== "";
  if (google && typeof google === "object") return Object.keys(google).length > 0;
  return google === true;
}

function validEmail(email: string | null | undefined): string | null {
  const value = typeof email === "string" ? email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

function recipientFromPerson(person: PipedriveDealPerson): GmailDraftRecipient | null {
  const email = validEmail(person.email);
  if (!email) return null;
  return { email, name: person.name };
}

async function proposalRecipients(
  client: PipedriveProjectsClient,
  current: DealPayload,
): Promise<GmailDraftRecipient[]> {
  const id = dealId(current)!;
  const people = client.listDealPersons ? await client.listDealPersons(id) : [];
  const recipients = people.map(recipientFromPerson).filter((r): r is GmailDraftRecipient => r != null);
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function proposalOwner(client: PipedriveProjectsClient, current: DealPayload): Promise<PipedriveUser | null> {
  const id = ownerId(current);
  if (id == null || !client.listUsers) return null;
  const users = await client.listUsers();
  return users.find((user) => user.id === id && user.active) ?? null;
}

async function verifyConnections(
  client: PipedriveProjectsClient,
): Promise<"connected" | "missing_client_method" | "missing_google" | "mailbox_unreachable"> {
  if (!client.listUserConnections || !client.listMailboxThreads) return "missing_client_method";
  const connections = await client.listUserConnections();
  if (!hasGoogleConnection(connections)) return "missing_google";
  await client.listMailboxThreads("drafts", 1);
  return "connected";
}

async function existingOpenActivities(
  client: PipedriveProjectsClient,
  currentDealId: number,
): Promise<DealActivitySummary[]> {
  if (!client.listDealActivities) return [];
  return (await client.listDealActivities(currentDealId)).filter((activity) => !activity.done);
}

async function dealActivities(
  client: PipedriveProjectsClient,
  currentDealId: number,
): Promise<DealActivitySummary[]> {
  return client.listDealActivities ? client.listDealActivities(currentDealId) : [];
}

async function ensureActivity(
  client: PipedriveProjectsClient,
  existing: DealActivitySummary[],
  input: CreateActivityInput,
): Promise<{ id: number; created: boolean }> {
  const reused = existing.find(
    (activity) =>
      activity.subject === input.subject &&
      activity.dueDate === input.due_date &&
      (input.due_time == null || activity.dueTime == null || activity.dueTime === input.due_time),
  );
  if (reused) return { id: reused.id, created: false };
  if (!client.createActivity) throw new Error("Pipedrive createActivity client is unavailable");
  const created = await client.createActivity(input);
  return { id: created.id, created: true };
}

interface ProposalPrepSlot {
  date: string;
  time: string;
  fallbackAfterWindow: boolean;
}

function proposalPrepTimeZone(env: Record<string, string | undefined>): string {
  const value = env.PIPEDRIVE_PROPOSAL_PREP_TIME_ZONE;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULT_PROPOSAL_PREP_TIME_ZONE;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function zonedParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function zonedInstant(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [year, month, day] = date.split("-").map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += Date.UTC(year, month - 1, day, hour, minute, 0, 0) - asIfUtc;
  }
  return new Date(guess);
}

function slotOverlapsBusy(start: Date, end: Date, busy: CalendarBusyInterval[]): boolean {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return busy.some((interval) => {
    const busyStart = new Date(interval.start).getTime();
    const busyEnd = new Date(interval.end).getTime();
    return Number.isFinite(busyStart) && Number.isFinite(busyEnd) && startMs < busyEnd && endMs > busyStart;
  });
}

function candidateBusinessDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const date = new Date(`${startDate}T00:00:00.000Z`);
  while (dates.length < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function firstOpenSlotOnDate(
  date: string,
  busy: CalendarBusyInterval[],
  timeZone: string,
): ProposalPrepSlot | null {
  const latestStart = PROPOSAL_PREP_WORKDAY_END_HOUR * 60 - PROPOSAL_PREP_DURATION_MINUTES;
  for (
    let minute = PROPOSAL_PREP_WORKDAY_START_HOUR * 60;
    minute <= latestStart;
    minute += 15
  ) {
    const hour = Math.floor(minute / 60);
    const minuteOfHour = minute % 60;
    const start = zonedInstant(date, hour, minuteOfHour, timeZone);
    const end = new Date(start.getTime() + PROPOSAL_PREP_DURATION_MINUTES * 60 * 1000);
    if (!slotOverlapsBusy(start, end, busy)) {
      return { date, time: formatTime(hour, minuteOfHour), fallbackAfterWindow: false };
    }
  }
  return null;
}

async function findProposalPrepSlot(
  calendarAvailability: CalendarAvailabilityAdapter,
  startDate: string,
  env: Record<string, string | undefined>,
): Promise<ProposalPrepSlot> {
  const timeZone = proposalPrepTimeZone(env);
  const calendarId =
    env.GOOGLE_CALENDAR_PROPOSAL_PREP_CALENDAR_ID?.trim() ||
    env.GOOGLE_CALENDAR_ID?.trim() ||
    "primary";
  const searchDates = [
    ...candidateBusinessDates(startDate, 3).map((date) => ({ date, fallbackAfterWindow: false })),
    ...candidateBusinessDates(addBusinessDays(startDate, 3), 10).map((date) => ({
      date,
      fallbackAfterWindow: true,
    })),
  ];

  for (const candidate of searchDates) {
    const busy = await calendarAvailability.listBusy({
      calendarId,
      timeZone,
      timeMin: zonedInstant(candidate.date, 0, 0, timeZone).toISOString(),
      timeMax: zonedInstant(candidate.date, 23, 59, timeZone).toISOString(),
    });
    const slot = firstOpenSlotOnDate(candidate.date, busy, timeZone);
    if (slot) return { ...slot, fallbackAfterWindow: candidate.fallbackAfterWindow };
  }

  throw new Error("no_proposal_prep_slot_available");
}

function proposalPrepActivity(
  current: DealPayload,
  slot: ProposalPrepSlot,
  ownerId?: number,
): CreateActivityInput {
  const id = dealId(current)!;
  const lines = [
    `Deal: ${dealTitle(current)} (#${id})`,
    dealOrgName(current) ? `Company: ${dealOrgName(current)}` : null,
    dealValue(current) ? `Value: ${dealValue(current)}` : null,
    "Purpose: 45-minute proposal build/review block before sending the proposal.",
    slot.fallbackAfterWindow
      ? "Scheduling note: no open 45-minute slot was available inside the 3-business-day target, so this is the earliest later open weekday slot."
      : null,
  ].filter((line): line is string => line != null);

  return {
    subject: `${PROPOSAL_PREP_SUBJECT_PREFIX} ${dealTitle(current)}`,
    type: "meeting",
    owner_id: ownerId,
    deal_id: id,
    person_id: personId(current),
    org_id: orgId(current),
    due_date: slot.date,
    due_time: slot.time,
    duration: "00:45",
    busy: true,
    done: false,
    note: lines.join("\n"),
  };
}

function proposalDraftActivity(
  current: DealPayload,
  touch: (typeof PLACEHOLDER_TOUCHES)[number],
  dueDate: string,
  draftId: string,
  ownerId?: number,
): CreateActivityInput {
  const id = dealId(current)!;
  return {
    subject: `${PROPOSAL_DRAFT_SUBJECT_PREFIX} ${touch.label}: ${dealTitle(current)}`,
    type: "email",
    owner_id: ownerId,
    deal_id: id,
    person_id: personId(current),
    org_id: orgId(current),
    due_date: dueDate,
    done: false,
    note: [
      "Gmail draft ready. Review manually before sending.",
      `Gmail draft ID: ${draftId}`,
      `Draft subject: ${touch.subject}`,
      "Safety: this automation creates drafts only and never sends email.",
    ].join("\n"),
  };
}

function proposalDraftBody(
  current: DealPayload,
  touch: (typeof PLACEHOLDER_TOUCHES)[number],
  env: Record<string, string | undefined>,
): string {
  const ctx = proposalContext(current, env);
  if (touch.label === "Touch 1") {
    return [
      "Hi there,",
      "",
      "Just making sure the proposal I sent came through OK and made sense on your end. No rush at all.",
      "",
      `If anything is unclear, or you want to walk through the numbers, reply here or give me a call at ${ctx.nickPhone}.`,
      "",
      "Thanks,",
      "Nick",
    ].join("\n");
  }
  if (touch.label === "Touch 2") {
    return [
      "Hi there,",
      "",
      "Thought this was worth passing along while you look over the proposal.",
      "",
      ctx.proofPoint,
      "",
      "That is all. Happy to send the full details if it helps.",
      "",
      "Nick",
    ].join("\n");
  }
  if (touch.label === "Touch 3") {
    return [
      "Hi there,",
      "",
      "Circling back on the proposal I sent. If there is a question on price or timing, or you are weighing a couple of options, just tell me which one. I would rather know than guess, and I can usually work with any of it.",
      "",
      `If it is easier to talk it through, here is my calendar: ${ctx.nickCalendarLink}`,
      "",
      "Nick",
    ].join("\n");
  }
  if (touch.label === "Touch 4") {
    return [
      "Hi there,",
      "",
      "One more thing worth putting in front of you before you decide.",
      "",
      ctx.proofPoint,
      "",
      "Not trying to push. I just did not want it to get lost if it is useful to you.",
      "",
      "Nick",
    ].join("\n");
  }
  return [
    "Hi there,",
    "",
    "It has been a few weeks since I sent the proposal, so I will just ask straight: where do you stand?",
    "",
    "Yes, no, or \"not yet\" all work for me. I would rather know than keep it sitting open. If you need more time, tell me roughly how long and I will check back then.",
    "",
    `${ctx.nickPhone}, or just reply here.`,
    "",
    "Nick",
  ].join("\n");
}

function mailboxAddress(env: Record<string, string | undefined>): string | null {
  return (
    validEmail(env.GMAIL_PROPOSAL_DRAFTS_FROM_EMAIL) ??
    validEmail(env.GMAIL_DRAFTS_FROM_EMAIL) ??
    null
  );
}

function automationId(current: DealPayload, touch: (typeof PLACEHOLDER_TOUCHES)[number]): string {
  return `pipedrive:deal:${dealId(current)}:proposal-follow-up:${touch.label
    .toLowerCase()
    .replace(/\s+/g, "-")}`;
}

function activityTimestamp(activity: DealActivitySummary): string | null {
  return activity.markedAsDoneTime ?? activity.updateTime ?? activity.addTime ?? activity.dueDate;
}

function compareIsoDateLike(a: string, b: string): number {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

function hasCustomerContactSince(
  activities: DealActivitySummary[],
  sinceDate: string,
  dueDate: string,
): boolean {
  return activities.some((activity) => {
    if (activity.subject.startsWith(PROPOSAL_DRAFT_SUBJECT_PREFIX)) return false;
    if (!activity.done) return false;
    const type = activity.type?.toLowerCase() ?? "";
    if (!CUSTOMER_CONTACT_ACTIVITY_TYPES.has(type)) return false;
    const timestamp = activityTimestamp(activity);
    if (!timestamp) return false;
    return compareIsoDateLike(timestamp, sinceDate) >= 0 && compareIsoDateLike(timestamp, dueDate) <= 0;
  });
}

async function createProposalPrepBlock(
  client: PipedriveProjectsClient,
  current: DealPayload,
  env: Record<string, string | undefined>,
  calendarAvailability: CalendarAvailabilityAdapter,
): Promise<ProposalAutomationResult> {
  const connection = await verifyConnections(client);
  if (connection !== "connected") return { status: "connection_missing", reason: connection };

  const id = dealId(current)!;
  let slot: ProposalPrepSlot;
  try {
    slot = await findProposalPrepSlot(calendarAvailability, isoDateFromDeal(current), env);
  } catch (error) {
    return {
      status: "connection_missing",
      reason: error instanceof Error ? error.message : "calendar_availability_failed",
    };
  }
  const existing = await existingOpenActivities(client, id);
  const ensured = await ensureActivity(
    client,
    existing,
    proposalPrepActivity(current, slot, ownerIdFromEnv(env)),
  );
  return {
    status: ensured.created ? "created" : "reused",
    activityIds: [ensured.id],
  };
}

async function createProposalDraftSeries(
  client: PipedriveProjectsClient,
  current: DealPayload,
  env: Record<string, string | undefined>,
  gmailDrafts: GmailDraftAdapter,
): Promise<ProposalAutomationResult> {
  const connection = await verifyConnections(client);
  if (connection !== "connected") return { status: "connection_missing", reason: connection };
  const gmailConfig = loadGmailDraftConfig(env);
  if (!gmailConfig.ok) return { status: "connection_missing", reason: gmailConfig.reason };
  const fromEmail = mailboxAddress(env);
  if (!fromEmail) return { status: "connection_missing", reason: "missing_gmail_from_email" };

  const id = dealId(current)!;
  const activities = await dealActivities(client, id);
  const existing = activities.filter((activity) => !activity.done);
  const recipients = await proposalRecipients(client, current);
  if (recipients.length === 0) return { status: "skipped", reason: "no_recipient_email" };
  const owner = await proposalOwner(client, current);
  const from = { email: fromEmail, name: owner?.name ?? env.GMAIL_PROPOSAL_DRAFTS_FROM_NAME ?? "Phoenix Solutions Group" };
  const replyTo = owner?.email && validEmail(owner.email) ? { email: owner.email, name: owner.name } : null;
  const results = [];
  const draftIds: string[] = [];
  const proposalSentDate = isoDateFromDeal(current);
  for (const [index, touch] of PLACEHOLDER_TOUCHES.entries()) {
    const subject = touch.subject;
    const dueDate = addCalendarDays(proposalSentDate, touch.dayOffset);
    const previousTouchDate =
      index === 0
        ? proposalSentDate
        : addCalendarDays(proposalSentDate, PLACEHOLDER_TOUCHES[index - 1].dayOffset);
    const activitySubject = `${PROPOSAL_DRAFT_SUBJECT_PREFIX} ${touch.label}: ${dealTitle(current)}`;
    const reused = existing.find(
      (activity) => activity.subject === activitySubject && activity.dueDate === dueDate,
    );
    if (reused) {
      results.push({ id: reused.id, created: false });
      continue;
    }
    if (hasCustomerContactSince(activities, previousTouchDate, dueDate)) continue;
    const draft = await gmailDrafts.ensureDraft({
      automationId: automationId(current, touch),
      from,
      replyTo,
      to: recipients,
      subject,
      text: proposalDraftBody(current, touch, env),
    });
    draftIds.push(draft.id);
    results.push(
      await ensureActivity(
        client,
        existing,
        proposalDraftActivity(
          current,
          touch,
          dueDate,
          draft.id,
          ownerIdFromEnv(env),
        ),
      ),
    );
  }
  if (results.length === 0) return { status: "skipped", reason: "recent_customer_contact" };
  return {
    status: results.some((result) => result.created) ? "created" : "reused",
    activityIds: results.map((result) => result.id),
    ...(draftIds.length > 0 ? { draftIds } : {}),
  };
}

async function stopProposalDraftSeries(
  client: PipedriveProjectsClient,
  current: DealPayload,
): Promise<ProposalAutomationResult> {
  const id = dealId(current)!;
  const existing = await existingOpenActivities(client, id);
  const draftActivities = existing.filter((activity) =>
    activity.subject.startsWith(PROPOSAL_DRAFT_SUBJECT_PREFIX),
  );
  if (draftActivities.length === 0) return { status: "skipped", reason: "no_open_draft_activities" };
  if (!client.deleteActivity) throw new Error("Pipedrive deleteActivity client is unavailable");
  for (const activity of draftActivities) await client.deleteActivity(activity.id);
  return {
    status: "stopped",
    stoppedActivityIds: draftActivities.map((activity) => activity.id),
  };
}

export async function runProposalAutomations(
  client: PipedriveProjectsClient,
  current: DealPayload | null,
  previous: DealPayload | null | undefined,
  env: Record<string, string | undefined> = process.env,
  gmailDrafts: GmailDraftAdapter = createGmailDraftAdapter(loadGmailDraftConfig(env)),
  calendarAvailability: CalendarAvailabilityAdapter = createGoogleCalendarAvailabilityAdapter(
    loadGoogleCalendarConfig(env),
  ),
): Promise<ProposalAutomationSummary> {
  if (!current || dealId(current) == null || !isSalesPipeline(current, env)) return {};

  const qualifiedStageId = numberFromEnv(
    env,
    "PIPEDRIVE_QUALIFIED_STAGE_ID",
    DEFAULT_QUALIFIED_STAGE_ID,
  );
  const proposalSentStageId = numberFromEnv(
    env,
    "PIPEDRIVE_PROPOSAL_SENT_STAGE_ID",
    DEFAULT_PROPOSAL_SENT_STAGE_ID,
  );
  const stopStageIds = numberListFromEnv(
    env,
    "PIPEDRIVE_PROPOSAL_DRAFT_STOP_STAGE_IDS",
    DEFAULT_PROPOSAL_DRAFT_STOP_STAGE_IDS,
  );

  const summary: ProposalAutomationSummary = {};
  if (isStageTransition(current, previous, qualifiedStageId)) {
    summary.proposalPrepBlock = await createProposalPrepBlock(client, current, env, calendarAvailability);
  }
  if (isStageTransition(current, previous, proposalSentStageId)) {
    summary.proposalDraftSeries = await createProposalDraftSeries(client, current, env, gmailDrafts);
  }
  const status = typeof current.status === "string" ? current.status.toLowerCase() : "";
  const currentStageId = stageId(current);
  const previousStageId = stageId(previous);
  const movedOutOfProposalSent =
    previousStageId === proposalSentStageId && currentStageId !== proposalSentStageId;
  if (
    status === "won" ||
    status === "lost" ||
    movedOutOfProposalSent ||
    (currentStageId != null && stopStageIds.includes(currentStageId))
  ) {
    const stopped = await stopProposalDraftSeries(client, current);
    if (stopped.status === "stopped") summary.proposalDraftSeries = stopped;
  }
  return summary;
}
