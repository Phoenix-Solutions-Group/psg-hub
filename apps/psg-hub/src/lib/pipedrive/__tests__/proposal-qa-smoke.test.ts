import { describe, expect, it, vi } from "vitest";
import { runProposalQaSmoke } from "../proposal-qa-smoke";
import { QA_TEST_MARKER } from "../qa-smoke";
import type { CalendarAvailabilityAdapter } from "@/lib/google-calendar/freebusy";
import type { GmailDraftAdapter } from "@/lib/gmail/drafts";
import type { PipedriveProjectsClient, CreateActivityInput } from "../projects";

function fakeGmailDrafts(): GmailDraftAdapter {
  let next = 1;
  return {
    ensureDraft: vi.fn(async () => ({
      id: `draft-${next++}`,
      messageId: "<message@psgweb.me>",
      reused: false,
    })),
  };
}

function fakeCalendar(): CalendarAvailabilityAdapter {
  return { listBusy: vi.fn(async () => []) };
}

function fakePipedrive() {
  let seq = 100;
  const organizations = new Map<number, Record<string, unknown>>();
  const persons = new Map<number, Record<string, unknown>>();
  const deals = new Map<number, Record<string, unknown>>();
  const activities = new Map<number, Record<string, unknown>>();

  const ok = (data: unknown) =>
    new Response(JSON.stringify({ success: true, data, additional_data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const notFound = () => new Response(JSON.stringify({ success: false }), { status: 404 });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const parts = u.pathname.split("/").filter(Boolean);
    const version = parts[1];
    const resource = parts[2];
    const id = parts[3] ? Number(parts[3]) : null;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (version === "v1" && resource === "organizations") {
      if (method === "POST") {
        const orgId = seq++;
        organizations.set(orgId, { id: orgId, name: body.name });
        return ok({ id: orgId });
      }
      if (id != null && method === "DELETE") {
        organizations.delete(id);
        return ok({ id });
      }
    }

    if (version === "v1" && resource === "persons") {
      if (method === "POST") {
        const personId = seq++;
        persons.set(personId, {
          id: personId,
          name: body.name,
          org_id: body.org_id,
          email: body.email,
        });
        return ok({ id: personId });
      }
      if (id != null && method === "DELETE") {
        persons.delete(id);
        return ok({ id });
      }
    }

    if (version === "v1" && resource === "deals") {
      if (method === "POST") {
        const dealId = seq++;
        deals.set(dealId, {
          id: dealId,
          title: body.title,
          pipeline_id: body.pipeline_id,
          org_id: body.org_id,
          person_id: body.person_id,
          status: "open",
        });
        return ok({ id: dealId, title: body.title, pipeline_id: body.pipeline_id });
      }
      if (id != null && method === "GET") {
        const deal = deals.get(id);
        return deal ? ok({ ...deal }) : notFound();
      }
      if (id != null && method === "DELETE") {
        deals.delete(id);
        return ok({ id });
      }
    }

    return notFound();
  }) as unknown as typeof fetch;

  const client: Partial<PipedriveProjectsClient> = {
    updateDeal: vi.fn(async (dealId, patch) => {
      const deal = deals.get(dealId);
      if (!deal) throw new Error("deal_not_found");
      Object.assign(deal, patch);
      return { id: dealId };
    }),
    listUserConnections: vi.fn(async () => ({ google: "nick@psgweb.me" })),
    listMailboxThreads: vi.fn(async () => [{ id: 1 }]),
    listDealPersons: vi.fn(async (dealId) => {
      const deal = deals.get(dealId);
      const person = deal ? persons.get(Number(deal.person_id)) : null;
      const email = Array.isArray(person?.email)
        ? String((person.email[0] as Record<string, unknown>).value)
        : null;
      return [{ id: Number(person?.id), name: String(person?.name), email }];
    }),
    listUsers: vi.fn(async () => [
      { id: 77, name: "Nick", email: "nick@psgweb.me", active: true },
    ]),
    listDealActivities: vi.fn(async (dealId) =>
      [...activities.values()]
        .filter((activity) => activity.deal_id === dealId)
        .map((activity) => ({
          id: Number(activity.id),
          subject: String(activity.subject),
          type: typeof activity.type === "string" ? activity.type : null,
          dueDate: typeof activity.due_date === "string" ? activity.due_date : null,
          dueTime: typeof activity.due_time === "string" ? activity.due_time : null,
          done: activity.done === true,
        })),
    ),
    createActivity: vi.fn(async (input: CreateActivityInput) => {
      const id = seq++;
      activities.set(id, { id, ...input });
      return { id };
    }),
    deleteActivity: vi.fn(async (activityId) => {
      activities.delete(activityId);
    }),
  };

  return { fetchImpl, client: client as PipedriveProjectsClient, organizations, persons, deals, activities };
}

describe("runProposalQaSmoke", () => {
  it("creates a marked fake deal, walks proposal automations, returns evidence, and cleans up", async () => {
    const pd = fakePipedrive();
    const evidence = await runProposalQaSmoke(
      {
        companyDomain: null,
        apiKey: "test-token",
        fetchImpl: pd.fetchImpl,
        runTag: "unit",
        env: {
          PIPEDRIVE_SALES_PIPELINE_ID: "8",
          PIPEDRIVE_QUALIFIED_STAGE_ID: "58",
          PIPEDRIVE_PROPOSAL_SENT_STAGE_ID: "59",
          GMAIL_PROPOSAL_DRAFTS_FROM_EMAIL: "nick@psgweb.me",
          GMAIL_PROPOSAL_DRAFTS_REFRESH_TOKEN: "refresh",
          GOOGLE_OAUTH_CLIENT_ID: "client",
          GOOGLE_OAUTH_CLIENT_SECRET: "secret",
          GOOGLE_CALENDAR_PROPOSAL_PREP_REFRESH_TOKEN: "refresh",
        },
        gmailDrafts: fakeGmailDrafts(),
        calendarAvailability: fakeCalendar(),
      },
      pd.client,
    );

    expect(evidence.dealTitle).toContain(QA_TEST_MARKER);
    expect(evidence.proposalPrepBlock).toMatchObject({ status: "created" });
    expect(evidence.proposalDraftSeries).toMatchObject({
      status: "created",
      draftIds: ["draft-1", "draft-2", "draft-3", "draft-4", "draft-5"],
    });
    expect(evidence.cleanupStop).toMatchObject({ status: "stopped" });
    expect(evidence.safety.noEmailSent).toBe(true);
    expect(evidence.cleanup).toEqual({
      dealDeleted: true,
      personDeleted: true,
      orgDeleted: true,
      proposalDraftActivitiesStopped: true,
    });
    expect(evidence.allChecksPass).toBe(true);
    expect(pd.deals.size).toBe(0);
    expect(pd.persons.size).toBe(0);
    expect(pd.organizations.size).toBe(0);
  });
});
