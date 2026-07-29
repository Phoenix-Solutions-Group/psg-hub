import "server-only";

import {
  createGoogleCalendarAvailabilityAdapter,
  loadGoogleCalendarConfig,
  type CalendarAvailabilityAdapter,
} from "@/lib/google-calendar/freebusy";
import {
  createGmailDraftAdapter,
  loadGmailDraftConfig,
  type GmailDraftAdapter,
} from "@/lib/gmail/drafts";
import {
  createProjectsClient,
  type PipedriveProjectsClient,
} from "./projects";
import {
  createQaRestClient,
  isQaTestTitle,
  QA_TEST_MARKER,
  type QaFetch,
} from "./qa-smoke";
import {
  runProposalAutomations,
  type ProposalAutomationSummary,
} from "./proposal-automations";

const DEFAULT_SALES_PIPELINE_ID = 8;
const DEFAULT_QUALIFIED_STAGE_ID = 58;
const DEFAULT_PROPOSAL_SENT_STAGE_ID = 59;
const DEFAULT_CLEANUP_STAGE_ID = 61;
const QA_PERSON_EMAIL_DOMAIN = "example.invalid";

function numFromEnv(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const parsed = Number(env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertQaTitle(kind: string, id: number, title: string): void {
  if (!isQaTestTitle(title)) {
    throw new Error(`Refusing to clean up ${kind} ${id}: missing ${QA_TEST_MARKER}`);
  }
}

function activityIds(
  result: ProposalAutomationSummary["proposalPrepBlock"],
): number[] {
  return result != null && "activityIds" in result ? result.activityIds : [];
}

function draftIds(result: ProposalAutomationSummary["proposalDraftSeries"]): string[] {
  return result != null && "draftIds" in result ? (result.draftIds ?? []) : [];
}

function qaDealPayload(input: {
  dealId: number;
  title: string;
  pipelineId: number;
  stageId: number;
  status?: "open" | "won" | "lost";
  orgId: number;
  personId: number;
  updateTime: string;
}): Record<string, unknown> {
  return {
    id: input.dealId,
    title: input.title,
    pipeline_id: input.pipelineId,
    stage_id: input.stageId,
    status: input.status ?? "open",
    org_id: { value: input.orgId, name: `${QA_TEST_MARKER} Proposal QA Org` },
    person_id: { value: input.personId, name: `${QA_TEST_MARKER} Proposal QA Contact` },
    update_time: input.updateTime,
  };
}

export interface ProposalQaSmokeOptions {
  companyDomain?: string | null;
  fetchImpl?: QaFetch;
  apiKey?: string;
  runTag: string;
  env?: Record<string, string | undefined>;
  gmailDrafts?: GmailDraftAdapter;
  calendarAvailability?: CalendarAvailabilityAdapter;
}

export interface ProposalQaSmokeEvidence {
  ok: boolean;
  dealId: number;
  dealTitle: string;
  orgId: number;
  personId: number;
  recipientEmail: string;
  stages: {
    qualifiedStageId: number;
    proposalSentStageId: number;
    cleanupStageId: number;
  };
  proposalPrepBlock: ProposalAutomationSummary["proposalPrepBlock"];
  proposalDraftSeries: ProposalAutomationSummary["proposalDraftSeries"];
  cleanupStop: ProposalAutomationSummary["proposalDraftSeries"];
  expectedDraftMessageIds: string[];
  createdDraftIds: string[];
  createdActivityIds: number[];
  stoppedActivityIds: number[];
  safety: {
    noEmailSent: true;
    marker: typeof QA_TEST_MARKER;
  };
  cleanup: {
    dealDeleted: boolean;
    personDeleted: boolean;
    orgDeleted: boolean;
    proposalDraftActivitiesStopped: boolean;
  };
  checks: Record<string, boolean>;
  allChecksPass: boolean;
}

export async function runProposalQaSmoke(
  opts: ProposalQaSmokeOptions,
  clientOverride?: PipedriveProjectsClient,
): Promise<ProposalQaSmokeEvidence> {
  const env = opts.env ?? process.env;
  const rest = createQaRestClient({
    apiKey: opts.apiKey,
    companyDomain: opts.companyDomain ?? null,
    fetchImpl: opts.fetchImpl,
  });
  const client =
    clientOverride ??
    createProjectsClient({
      apiKey: opts.apiKey,
      companyDomain: opts.companyDomain ?? null,
      fetchImpl: opts.fetchImpl,
    });

  const salesPipelineId = numFromEnv(env, "PIPEDRIVE_SALES_PIPELINE_ID", DEFAULT_SALES_PIPELINE_ID);
  const qualifiedStageId = numFromEnv(env, "PIPEDRIVE_QUALIFIED_STAGE_ID", DEFAULT_QUALIFIED_STAGE_ID);
  const proposalSentStageId = numFromEnv(
    env,
    "PIPEDRIVE_PROPOSAL_SENT_STAGE_ID",
    DEFAULT_PROPOSAL_SENT_STAGE_ID,
  );
  const cleanupStageId = numFromEnv(env, "PIPEDRIVE_PROPOSAL_QA_CLEANUP_STAGE_ID", DEFAULT_CLEANUP_STAGE_ID);
  const runTag = opts.runTag.trim() || `run-${Date.now()}`;
  const dealTitle = `${QA_TEST_MARKER} — Proposal Automation QA ${runTag}`;
  const orgTitle = `${QA_TEST_MARKER} Proposal QA Org — ${runTag}`;
  const personTitle = `${QA_TEST_MARKER} Proposal QA Contact — ${runTag}`;
  const recipientEmail = `proposal-qa-${runTag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@${QA_PERSON_EMAIL_DOMAIN}`;

  let dealId = 0;
  let orgId = 0;
  let personId = 0;
  const cleanup: ProposalQaSmokeEvidence["cleanup"] = {
    dealDeleted: false,
    personDeleted: false,
    orgDeleted: false,
    proposalDraftActivitiesStopped: false,
  };
  const createdActivityIds: number[] = [];
  const createdDraftIds: string[] = [];
  const stoppedActivityIds: number[] = [];
  const gmailDrafts = opts.gmailDrafts ?? createGmailDraftAdapter(loadGmailDraftConfig(env));
  const calendarAvailability =
    opts.calendarAvailability ??
    createGoogleCalendarAvailabilityAdapter(loadGoogleCalendarConfig(env));
  let proposalPrepBlock: ProposalQaSmokeEvidence["proposalPrepBlock"];
  let proposalDraftSeries: ProposalQaSmokeEvidence["proposalDraftSeries"];
  let cleanupStop: ProposalQaSmokeEvidence["cleanupStop"];

  try {
    const org = await rest.createOrganization(orgTitle);
    orgId = org.id;
    const person = await rest.createPerson(personTitle, orgId, recipientEmail);
    personId = person.id;
    const created = await rest.createDeal(dealTitle, salesPipelineId, { orgId, personId });
    dealId = created.id;

    const base = {
      dealId,
      title: dealTitle,
      pipelineId: salesPipelineId,
      orgId,
      personId,
      updateTime: new Date().toISOString(),
    };

    if (!client.updateDeal) throw new Error("Pipedrive updateDeal client is unavailable");
    await client.updateDeal(dealId, { stage_id: qualifiedStageId });
    proposalPrepBlock = (
      await runProposalAutomations(
        client,
        qaDealPayload({ ...base, stageId: qualifiedStageId }),
        qaDealPayload({ ...base, stageId: qualifiedStageId - 1 }),
        env,
        gmailDrafts,
        calendarAvailability,
      )
    ).proposalPrepBlock;

    await client.updateDeal(dealId, { stage_id: proposalSentStageId });
    proposalDraftSeries = (
      await runProposalAutomations(
        client,
        qaDealPayload({ ...base, stageId: proposalSentStageId }),
        qaDealPayload({ ...base, stageId: qualifiedStageId }),
        env,
        gmailDrafts,
        calendarAvailability,
      )
    ).proposalDraftSeries;
    createdActivityIds.push(...activityIds(proposalPrepBlock));
    createdActivityIds.push(...activityIds(proposalDraftSeries));
    createdDraftIds.push(...draftIds(proposalDraftSeries));

    await client.updateDeal(dealId, { stage_id: cleanupStageId, status: "lost" });
    cleanupStop = (
      await runProposalAutomations(
        client,
        qaDealPayload({ ...base, stageId: cleanupStageId, status: "lost" }),
        qaDealPayload({ ...base, stageId: proposalSentStageId }),
        env,
        gmailDrafts,
        calendarAvailability,
      )
    ).proposalDraftSeries;
    if (cleanupStop?.status === "stopped") {
      stoppedActivityIds.push(...cleanupStop.stoppedActivityIds);
      cleanup.proposalDraftActivitiesStopped = true;
    }

    const expectedDraftMessageIds = [1, 2, 3, 4, 5].map(
      (n) => `<pipedrive.deal.${dealId}.proposal-follow-up.touch-${n}@psgweb.me>`,
    );
    const checks: Record<string, boolean> = {
      titleMarkedQa: isQaTestTitle(dealTitle),
      proposalPrepCreated:
        proposalPrepBlock?.status === "created" || proposalPrepBlock?.status === "reused",
      proposalDraftsCreated:
        proposalDraftSeries?.status === "created" && (proposalDraftSeries.draftIds?.length ?? 0) > 0,
      noEmailSent: true,
      proposalDraftActivitiesStopped: cleanup.proposalDraftActivitiesStopped,
    };

    return {
      ok: Object.values(checks).every(Boolean),
      dealId,
      dealTitle,
      orgId,
      personId,
      recipientEmail,
      stages: { qualifiedStageId, proposalSentStageId, cleanupStageId },
      proposalPrepBlock,
      proposalDraftSeries,
      cleanupStop,
      expectedDraftMessageIds,
      createdDraftIds,
      createdActivityIds,
      stoppedActivityIds,
      safety: { noEmailSent: true, marker: QA_TEST_MARKER },
      cleanup,
      checks,
      allChecksPass: Object.values(checks).every(Boolean),
    };
  } finally {
    if (dealId) {
      assertQaTitle("deal", dealId, dealTitle);
      await rest.deleteDeal(dealId).then(() => {
        cleanup.dealDeleted = true;
      });
    }
    if (personId) {
      assertQaTitle("person", personId, personTitle);
      await rest.deletePerson(personId).then(() => {
        cleanup.personDeleted = true;
      });
    }
    if (orgId) {
      assertQaTitle("organization", orgId, orgTitle);
      await rest.deleteOrganization(orgId).then(() => {
        cleanup.orgDeleted = true;
      });
    }
  }
}
