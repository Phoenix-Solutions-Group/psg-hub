import { describe, expect, it, vi } from "vitest";
import { addBusinessDays, runProposalAutomations } from "../proposal-automations";
import type { PipedriveProjectsClient } from "../projects";
import type { CalendarAvailabilityAdapter, CalendarBusyInterval } from "@/lib/google-calendar/freebusy";
import type { GmailDraftAdapter } from "@/lib/gmail/drafts";

function fakeClient(overrides: Partial<PipedriveProjectsClient> = {}) {
  const listUserConnections = vi.fn(async () => ({ google: "nick@phoenixsolutionsgroup.net" }));
  const listMailboxThreads = vi.fn(async () => [{ id: 1 }]);
  const listDealActivities = vi.fn(async () => []);
  const listDealPersons = vi.fn(async () => [
    { id: 7, name: "Pat Owner", email: "pat@example.com" },
    { id: 8, name: "Sam Partner", email: "sam@example.com" },
    { id: 9, name: "Invalid", email: "not-an-email" },
  ]);
  const listUsers = vi.fn(async () => [
    { id: 11, name: "Alex Seller", email: "alex@psgweb.me", active: true },
  ]);
  const createActivity = vi.fn(async () => ({ id: 9001 }));
  const deleteActivity = vi.fn(async () => {});
  return {
    client: {
      listUserConnections,
      listMailboxThreads,
      listDealActivities,
      listDealPersons,
      listUsers,
      createActivity,
      deleteActivity,
      ...overrides,
    } as unknown as PipedriveProjectsClient,
    listUserConnections,
    listMailboxThreads,
    listDealActivities,
    listDealPersons,
    listUsers,
    createActivity,
    deleteActivity,
  };
}

function fakeGmailDrafts(): GmailDraftAdapter & { ensureDraft: ReturnType<typeof vi.fn> } {
  let next = 1;
  return {
    ensureDraft: vi.fn(async () => ({
      id: `gmail-draft-${next++}`,
      messageId: "<message@psgweb.me>",
      reused: false,
    })),
  };
}

function fakeCalendar(
  busyByDate: Record<string, CalendarBusyInterval[]> = {},
): CalendarAvailabilityAdapter & { listBusy: ReturnType<typeof vi.fn> } {
  return {
    listBusy: vi.fn(async (input) => busyByDate[input.timeMin.slice(0, 10)] ?? []),
  };
}

function fullDayBusy(date: string, nextDate: string): CalendarBusyInterval {
  return {
    start: `${date}T00:00:00-04:00`,
    end: `${nextDate}T00:00:00-04:00`,
  };
}

const gmailEnv = {
  GMAIL_PROPOSAL_DRAFTS_REFRESH_TOKEN: "refresh-token",
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GMAIL_PROPOSAL_DRAFTS_FROM_EMAIL: "nick@psgweb.me",
  GOOGLE_CALENDAR_PROPOSAL_PREP_REFRESH_TOKEN: "calendar-refresh-token",
  PIPEDRIVE_PROOF_BLOCK_FIELD_KEY: "proof_block",
  PIPEDRIVE_PROPOSAL_NICK_PHONE: "(555) 010-1000",
  PIPEDRIVE_PROPOSAL_NICK_CALENDAR_LINK: "https://cal.example/nick",
};

describe("proposal automations", () => {
  it("adds three business days and skips weekends", () => {
    expect(addBusinessDays("2026-07-17", 3)).toBe("2026-07-22");
    expect(addBusinessDays("2026-07-20", 3)).toBe("2026-07-23");
  });

  it("creates one proposal-prep activity in the first conflict-free 45-minute working-hours slot", async () => {
    const { client, createActivity } = fakeClient();
    await expect(
      runProposalAutomations(
        client,
        {
          id: 42,
          title: "Wallace website proposal",
          pipeline_id: 8,
          stage_id: 56,
          value: 6500,
          currency: "USD",
          update_time: "2026-07-17 14:22:00",
        },
        { stage_id: 57 },
        {},
        fakeGmailDrafts(),
        fakeCalendar({
          "2026-07-20": [
            { start: "2026-07-20T07:00:00-04:00", end: "2026-07-20T08:00:00-04:00" },
          ],
        }),
      ),
    ).resolves.toEqual({
      proposalPrepBlock: { status: "created", activityIds: [9001] },
    });
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Proposal prep: Wallace website proposal",
        type: "meeting",
        due_date: "2026-07-20",
        due_time: "08:00",
        duration: "00:45",
        busy: true,
        done: false,
      }),
    );
  });

  it("skips a fully blocked day and uses the next eligible weekday inside the 3-business-day window", async () => {
    const { client, createActivity } = fakeClient();

    await runProposalAutomations(
      client,
      {
        id: 42,
        title: "Wallace website proposal",
        pipeline_id: 8,
        stage_id: 56,
        update_time: "2026-07-17 14:22:00",
      },
      { stage_id: 57 },
      {},
      fakeGmailDrafts(),
      fakeCalendar({
        "2026-07-20": [fullDayBusy("2026-07-20", "2026-07-21")],
      }),
    );

    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: "2026-07-21",
        due_time: "07:00",
      }),
    );
  });

  it("uses the earliest later weekday and flags Nick when no slot exists inside 3 business days", async () => {
    const { client, createActivity } = fakeClient();

    await runProposalAutomations(
      client,
      {
        id: 42,
        title: "Wallace website proposal",
        pipeline_id: 8,
        stage_id: 56,
        update_time: "2026-07-17 14:22:00",
      },
      { stage_id: 57 },
      {},
      fakeGmailDrafts(),
      fakeCalendar({
        "2026-07-20": [fullDayBusy("2026-07-20", "2026-07-21")],
        "2026-07-21": [fullDayBusy("2026-07-21", "2026-07-22")],
        "2026-07-22": [fullDayBusy("2026-07-22", "2026-07-23")],
      }),
    );

    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: "2026-07-23",
        due_time: "07:00",
        note: expect.stringContaining("no open 45-minute slot was available inside the 3-business-day target"),
      }),
    );
  });

  it("creates five Gmail drafts and non-sending follow-up activities on Proposal Sent", async () => {
    let nextId = 9001;
    const createActivity = vi.fn(async () => ({ id: nextId++ }));
    const { client } = fakeClient({
      createActivity,
    });
    const gmailDrafts = fakeGmailDrafts();
    await expect(
      runProposalAutomations(
        client,
        {
          id: 42,
          title: "Wallace website proposal",
          pipeline_id: 8,
          stage_id: 59,
          person_id: { value: 7, name: "Pat Owner" },
          org_id: { value: 9, name: "Wallace Collision" },
          user_id: { value: 11, name: "Alex Seller" },
          update_time: "2026-07-17 14:22:00",
          proof_block: "Most independent shops see the first useful signals after the new work is live.",
        },
        { stage_id: 56 },
        gmailEnv,
        gmailDrafts,
        fakeCalendar(),
      ),
    ).resolves.toEqual({
      proposalDraftSeries: {
        status: "created",
        activityIds: [9001, 9002, 9003, 9004, 9005],
        draftIds: [
          "gmail-draft-1",
          "gmail-draft-2",
          "gmail-draft-3",
          "gmail-draft-4",
          "gmail-draft-5",
        ],
      },
    });

    expect(gmailDrafts.ensureDraft).toHaveBeenCalledTimes(5);
    expect(gmailDrafts.ensureDraft).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        automationId: "pipedrive:deal:42:proposal-follow-up:touch-1",
        from: { email: "nick@psgweb.me", name: "Alex Seller" },
        replyTo: { email: "alex@psgweb.me", name: "Alex Seller" },
        to: [
          { email: "pat@example.com", name: "Pat Owner" },
          { email: "sam@example.com", name: "Sam Partner" },
        ],
        subject: "Quick follow-up on the proposal",
        text: expect.stringContaining("Hi there,"),
      }),
    );
    expect(gmailDrafts.ensureDraft).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        subject: "One thing that might help",
        text: expect.stringContaining("Most independent shops see the first useful signals"),
      }),
    );
    expect(createActivity).toHaveBeenCalledTimes(5);
    expect(createActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        subject: "Proposal follow-up draft Touch 1: Wallace website proposal",
        type: "email",
        due_date: "2026-07-19",
        done: false,
        note: expect.stringContaining("Gmail draft ID: gmail-draft-1"),
      }),
    );
  });

  it("skips only the touch whose lookback window already has logged customer contact", async () => {
    let nextId = 9001;
    const createActivity = vi.fn(async () => ({ id: nextId++ }));
    const { client } = fakeClient({
      createActivity,
      listDealActivities: vi.fn(async () => [
        {
          id: 700,
          subject: "Connected with decision maker",
          type: "call",
          dueDate: "2026-07-18",
          markedAsDoneTime: "2026-07-18 13:00:00",
          done: true,
        },
      ]),
    });
    const gmailDrafts = fakeGmailDrafts();

    await expect(
      runProposalAutomations(
        client,
        {
          id: 42,
          title: "Wallace website proposal",
          pipeline_id: 8,
          stage_id: 59,
          update_time: "2026-07-17 14:22:00",
        },
        { stage_id: 56 },
        gmailEnv,
        gmailDrafts,
        fakeCalendar(),
      ),
    ).resolves.toEqual({
      proposalDraftSeries: {
        status: "created",
        activityIds: [9001, 9002, 9003, 9004],
        draftIds: ["gmail-draft-1", "gmail-draft-2", "gmail-draft-3", "gmail-draft-4"],
      },
    });

    expect(gmailDrafts.ensureDraft).toHaveBeenCalledTimes(4);
    expect(gmailDrafts.ensureDraft).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        automationId: "pipedrive:deal:42:proposal-follow-up:touch-2",
      }),
    );
    expect(createActivity).not.toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Proposal follow-up draft Touch 1: Wallace website proposal",
      }),
    );
  });

  it("stops open draft activities when the deal is lost", async () => {
    const { client, deleteActivity } = fakeClient({
      listDealActivities: vi.fn(async () => [
        {
          id: 801,
          subject: "Proposal follow-up draft Touch 1: Wallace website proposal",
          type: "email",
          dueDate: "2026-07-21",
          done: false,
        },
      ]),
    });

    await expect(
      runProposalAutomations(
        client,
        { id: 42, title: "Wallace website proposal", pipeline_id: 8, stage_id: 59, status: "lost" },
        { stage_id: 59, status: "open" },
        {},
        fakeGmailDrafts(),
        fakeCalendar(),
      ),
    ).resolves.toEqual({
      proposalDraftSeries: { status: "stopped", stoppedActivityIds: [801] },
    });
    expect(deleteActivity).toHaveBeenCalledWith(801);
  });
});
