import { describe, it, expect, vi } from "vitest";
import {
  activeRecurringAccounts,
  firstOfCurrentMonthUTC,
  resolveRecurringBoardConfig,
  runRecurringCycle,
} from "../recurring-accounts";
import type { MirrorDealRow, MirrorSupabase } from "../mirror";
import type { PipedriveDeal, DealStatus } from "../types";
import {
  PipedriveProjectsError,
  type CreateProjectInput,
  type CreateTaskInput,
  type PipedriveProjectsClient,
} from "../projects";
import { recurringCycleTitle, type RecurringClient } from "../recurring";
import { recurringTaskCount } from "../recurring-service-template";

// ── activeRecurringAccounts (mirror reader) ─────────────────────────────────────────

function deal(partial: Partial<PipedriveDeal> & { dealId: number }): PipedriveDeal {
  return {
    dealId: partial.dealId,
    title: partial.title ?? `Deal ${partial.dealId}`,
    value: 0,
    currency: "USD",
    status: (partial.status ?? "won") as DealStatus,
    pipelineId: null,
    stageId: null,
    stageName: null,
    winProbability: null,
    orgId: partial.orgId ?? null,
    orgName: partial.orgName ?? null,
    personId: partial.personId ?? null,
    ownerId: null,
    ownerName: null,
    expectedCloseDate: null,
    closeDate: null,
    lastActivityDate: null,
  };
}

function fakeDb(deals: PipedriveDeal[]): MirrorSupabase {
  const rows: MirrorDealRow[] = deals.map((d) => ({ deal_id: d.dealId, raw: d }));
  return {
    from: () => ({
      select: async () => ({ data: rows, error: null }),
    }),
  };
}

describe("activeRecurringAccounts", () => {
  it("returns only WON deals as accounts", async () => {
    const db = fakeDb([
      deal({ dealId: 1, orgName: "Won Co", orgId: 10, personId: 100, status: "won" }),
      deal({ dealId: 2, orgName: "Open Co", orgId: 20, status: "open" }),
      deal({ dealId: 3, orgName: "Lost Co", orgId: 30, status: "lost" }),
    ]);
    const accounts = await activeRecurringAccounts(db);
    expect(accounts).toEqual([
      { orgName: "Won Co", orgId: 10, personId: 100 },
    ]);
  });

  it("dedupes to one account per org_id (first won deal wins)", async () => {
    const db = fakeDb([
      deal({ dealId: 1, orgName: "Sunrise Collision", orgId: 77, personId: 11 }),
      deal({ dealId: 2, orgName: "Sunrise Collision", orgId: 77, personId: 22 }),
      deal({ dealId: 3, orgName: "Other Shop", orgId: 88, personId: 33 }),
    ]);
    const accounts = await activeRecurringAccounts(db);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toEqual({ orgName: "Sunrise Collision", orgId: 77, personId: 11 });
    expect(accounts[1]).toEqual({ orgName: "Other Shop", orgId: 88, personId: 33 });
  });

  it("skips rows with an empty/whitespace org name", async () => {
    const db = fakeDb([
      deal({ dealId: 1, orgName: "", orgId: 10 }),
      deal({ dealId: 2, orgName: "   ", orgId: 20 }),
      deal({ dealId: 3, orgName: null, orgId: 30 }),
      deal({ dealId: 4, orgName: "Real Co", orgId: 40 }),
    ]);
    const accounts = await activeRecurringAccounts(db);
    expect(accounts).toEqual([{ orgName: "Real Co", orgId: 40, personId: null }]);
  });

  it("dedupes orgless won deals by (normalized) name", async () => {
    const db = fakeDb([
      deal({ dealId: 1, orgName: "No Org Co", orgId: null, personId: 1 }),
      deal({ dealId: 2, orgName: "no org co", orgId: null, personId: 2 }),
      deal({ dealId: 3, orgName: "Another", orgId: null, personId: 3 }),
    ]);
    const accounts = await activeRecurringAccounts(db);
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.orgName)).toEqual(["No Org Co", "Another"]);
  });
});

// ── firstOfCurrentMonthUTC ──────────────────────────────────────────────────────────

describe("firstOfCurrentMonthUTC", () => {
  it("returns YYYY-MM-01 for the month of the given date (UTC)", () => {
    expect(firstOfCurrentMonthUTC(new Date("2026-09-15T12:34:56Z"))).toBe("2026-09-01");
    expect(firstOfCurrentMonthUTC(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-01");
    expect(firstOfCurrentMonthUTC(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });

  it("uses UTC, not local time, at a month boundary", () => {
    // 2026-10-01 00:30 UTC is still September in US timezones — must stay 2026-10-01.
    expect(firstOfCurrentMonthUTC(new Date("2026-10-01T00:30:00Z"))).toBe("2026-10-01");
  });
});

// ── resolveRecurringBoardConfig (env pair + onboarding fallback) ─────────────────────

describe("resolveRecurringBoardConfig", () => {
  it("uses the dedicated recurring env pair when set", () => {
    expect(
      resolveRecurringBoardConfig({
        PIPEDRIVE_RECURRING_BOARD_ID: "5",
        PIPEDRIVE_RECURRING_PHASE_ID: "6",
        PIPEDRIVE_ONBOARDING_BOARD_ID: "1",
        PIPEDRIVE_ONBOARDING_PHASE_ID: "1",
      }),
    ).toEqual({ boardId: 5, phaseId: 6 });
  });

  it("falls back to the onboarding board pair when recurring vars are unset", () => {
    expect(
      resolveRecurringBoardConfig({
        PIPEDRIVE_ONBOARDING_BOARD_ID: "1",
        PIPEDRIVE_ONBOARDING_PHASE_ID: "2",
      }),
    ).toEqual({ boardId: 1, phaseId: 2 });
  });

  it("returns null when neither pair is configured", () => {
    expect(resolveRecurringBoardConfig({})).toBeNull();
  });

  it("rejects blank strings (Number('') is a finite 0 — must not pass)", () => {
    expect(
      resolveRecurringBoardConfig({
        PIPEDRIVE_RECURRING_BOARD_ID: "",
        PIPEDRIVE_RECURRING_PHASE_ID: "",
      }),
    ).toBeNull();
    expect(
      resolveRecurringBoardConfig({
        PIPEDRIVE_ONBOARDING_BOARD_ID: "1",
        PIPEDRIVE_ONBOARDING_PHASE_ID: "  ",
      }),
    ).toBeNull();
  });
});

// ── runRecurringCycle (per-account provisioning + error capture) ─────────────────────

/**
 * Fake Projects client keyed off the project title (which carries the account org name):
 * "EXISTING" ⇒ idempotent skip, "BOOM" ⇒ createProject throws, otherwise a fresh create.
 */
function fakeClient(): PipedriveProjectsClient {
  let nextId = 2000;
  return {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    findProjectByTitle: vi.fn(async (title: string) =>
      title.includes("EXISTING") ? { id: 999 } : null,
    ),
    createProject: vi.fn(async (input: CreateProjectInput) => {
      if (input.title.includes("BOOM")) {
        throw new PipedriveProjectsError("Pipedrive POST /api/v2/projects returned HTTP 500", 500);
      }
      return { id: nextId++ };
    }),
    createTask: vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ })),
  };
}

const CYCLE = "2026-09-01";

describe("runRecurringCycle", () => {
  it("aggregates created / skipped / errored and never aborts on one failure", async () => {
    const accounts: RecurringClient[] = [
      { orgName: "Fresh Co", orgId: 1, personId: 11 },
      { orgName: "EXISTING Co", orgId: 2, personId: 22 },
      { orgName: "BOOM Co", orgId: 3, personId: 33 },
    ];
    const result = await runRecurringCycle({
      client: fakeClient(),
      accounts,
      cycleStart: CYCLE,
      boardId: 1,
      phaseId: 1,
    });
    expect(result.total).toBe(3);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errored).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ orgName: "BOOM Co", orgId: 3 });
    // The created + skipped accounts are recorded with their project ids.
    expect(result.projects).toHaveLength(2);
    expect(result.projects.find((p) => p.orgName === "EXISTING Co")).toMatchObject({
      projectId: 999,
      created: false,
    });
  });

  it("builds the 8-task template for a fresh account and titles it deterministically", async () => {
    const client = fakeClient();
    const account: RecurringClient = { orgName: "Fresh Co", orgId: 1, personId: 11 };
    const result = await runRecurringCycle({
      client,
      accounts: [account],
      cycleStart: CYCLE,
      boardId: 7,
      phaseId: 8,
    });
    expect(result.created).toBe(1);
    // 3 group parents + 8 leaf tasks.
    expect(client.createTask).toHaveBeenCalledTimes(3 + recurringTaskCount());
    expect(client.findProjectByTitle).toHaveBeenCalledWith(
      recurringCycleTitle(account, CYCLE),
    );
  });

  it("returns a clean zero result for no active accounts", async () => {
    const result = await runRecurringCycle({
      client: fakeClient(),
      accounts: [],
      cycleStart: CYCLE,
      boardId: 1,
      phaseId: 1,
    });
    expect(result).toMatchObject({ total: 0, created: 0, skipped: 0, errored: 0 });
  });
});
