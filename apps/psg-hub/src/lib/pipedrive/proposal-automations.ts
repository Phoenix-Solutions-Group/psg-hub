import type {
  CreateActivityInput,
  DealActivitySummary,
  PipedriveProjectsClient,
  PipedriveUserConnections,
} from "./projects";

type DealPayload = Record<string, unknown>;

export type ProposalAutomationResult =
  | { status: "skipped"; reason: string }
  | { status: "connection_missing"; reason: string }
  | { status: "created"; activityIds: number[] }
  | { status: "reused"; activityIds: number[] }
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

const PLACEHOLDER_TOUCHES = [
  { dayOffset: 2, label: "Touch 1", subject: "Checking this landed clearly" },
  { dayOffset: 5, label: "Touch 2", subject: "A useful proof point for your plan" },
  { dayOffset: 9, label: "Touch 3", subject: "Where are you in the decision?" },
  { dayOffset: 14, label: "Touch 4", subject: "Quick recap of the plan and timing" },
  { dayOffset: 21, label: "Touch 5", subject: "Should I keep this open?" },
] as const;

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

async function ensureActivity(
  client: PipedriveProjectsClient,
  existing: DealActivitySummary[],
  input: CreateActivityInput,
): Promise<{ id: number; created: boolean }> {
  const reused = existing.find(
    (activity) => activity.subject === input.subject && activity.dueDate === input.due_date,
  );
  if (reused) return { id: reused.id, created: false };
  if (!client.createActivity) throw new Error("Pipedrive createActivity client is unavailable");
  const created = await client.createActivity(input);
  return { id: created.id, created: true };
}

function proposalPrepActivity(
  current: DealPayload,
  dueDate: string,
  ownerId?: number,
): CreateActivityInput {
  const id = dealId(current)!;
  const lines = [
    `Deal: ${dealTitle(current)} (#${id})`,
    dealOrgName(current) ? `Company: ${dealOrgName(current)}` : null,
    dealValue(current) ? `Value: ${dealValue(current)}` : null,
    "Purpose: 45-minute proposal build/review block before sending the proposal.",
  ].filter((line): line is string => line != null);

  return {
    subject: `${PROPOSAL_PREP_SUBJECT_PREFIX} ${dealTitle(current)}`,
    type: "meeting",
    owner_id: ownerId,
    deal_id: id,
    person_id: personId(current),
    org_id: orgId(current),
    due_date: dueDate,
    due_time: "09:00",
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
      "Draft only. Do not auto-send.",
      `Placeholder subject: ${touch.subject}`,
      "Final copy will be swapped in from the marketing copy task before QA.",
    ].join("\n"),
  };
}

async function createProposalPrepBlock(
  client: PipedriveProjectsClient,
  current: DealPayload,
  env: Record<string, string | undefined>,
): Promise<ProposalAutomationResult> {
  const connection = await verifyConnections(client);
  if (connection !== "connected") return { status: "connection_missing", reason: connection };

  const id = dealId(current)!;
  const dueDate = addBusinessDays(
    isoDateFromDeal(current),
    Math.min(numberFromEnv(env, "PIPEDRIVE_PROPOSAL_PREP_BUSINESS_DAY_OFFSET", 1), 3),
  );
  const existing = await existingOpenActivities(client, id);
  const ensured = await ensureActivity(
    client,
    existing,
    proposalPrepActivity(current, dueDate, ownerIdFromEnv(env)),
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
): Promise<ProposalAutomationResult> {
  const connection = await verifyConnections(client);
  if (connection !== "connected") return { status: "connection_missing", reason: connection };

  const id = dealId(current)!;
  const existing = await existingOpenActivities(client, id);
  const results = [];
  for (const touch of PLACEHOLDER_TOUCHES) {
    results.push(
      await ensureActivity(
        client,
        existing,
        proposalDraftActivity(
          current,
          touch,
          addBusinessDays(isoDateFromDeal(current), touch.dayOffset),
          ownerIdFromEnv(env),
        ),
      ),
    );
  }
  return {
    status: results.some((result) => result.created) ? "created" : "reused",
    activityIds: results.map((result) => result.id),
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
    summary.proposalPrepBlock = await createProposalPrepBlock(client, current, env);
  }
  if (isStageTransition(current, previous, proposalSentStageId)) {
    summary.proposalDraftSeries = await createProposalDraftSeries(client, current, env);
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
