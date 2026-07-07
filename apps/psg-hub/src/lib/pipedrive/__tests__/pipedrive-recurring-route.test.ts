import { describe, it, expect, vi, beforeEach } from "vitest";

// PSG-607 — thin auth/wiring test for the monthly recurring-service cron route. The batch
// logic is covered by recurring-accounts.test.ts; here we prove the CRON_SECRET gate (401
// before any work), the pipedrive/board not-configured 503 guards, the env-default
// (onboarding) board fallback, aggregation on a clean run (200), and the 502-on-error path.

const { selectRecurringAccounts, runRecurringCycle } = vi.hoisted(() => ({
  selectRecurringAccounts: vi.fn(),
  runRecurringCycle: vi.fn(),
}));

// Partial mock: keep the REAL resolveRecurringBoardConfig + firstOfCurrentMonthUTC so the
// env-pair/fallback logic is genuinely exercised; only stub the two I/O functions.
vi.mock("@/lib/pipedrive/recurring-accounts", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/pipedrive/recurring-accounts")>();
  return { ...actual, selectRecurringAccounts, runRecurringCycle };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import { GET, POST } from "@/app/api/cron/pipedrive-recurring/route";

function req(headers: Record<string, string> = {}) {
  return new Request("https://hub.psgweb.me/api/cron/pipedrive-recurring", { headers });
}

const CLEAN = {
  cycleStart: "2026-09-01",
  total: 2,
  created: 1,
  skipped: 1,
  errored: 0,
  errors: [],
  projects: [],
};

const SELECTION = {
  accounts: [{ orgName: "Sunrise Collision", orgId: 77, personId: 11 }],
  derivedTotal: 3,
  rosterApplied: true,
  excluded: [
    { orgName: "Website-only Co", orgId: 20, personId: null },
    { orgName: "Other Website Co", orgId: 21, personId: null },
  ],
  supplementApplied: false,
  supplementAdded: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  selectRecurringAccounts.mockResolvedValue(SELECTION);
  runRecurringCycle.mockResolvedValue(CLEAN);
  process.env.CRON_SECRET = "cron-secret";
  process.env.PIPEDRIVE_API_TOKEN = "pd-token";
  process.env.PIPEDRIVE_ONBOARDING_BOARD_ID = "1";
  process.env.PIPEDRIVE_ONBOARDING_PHASE_ID = "1";
  delete process.env.PIPEDRIVE_RECURRING_BOARD_ID;
  delete process.env.PIPEDRIVE_RECURRING_PHASE_ID;
});

describe("pipedrive-recurring cron route", () => {
  it("401 with no Authorization (before any work)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(selectRecurringAccounts).not.toHaveBeenCalled();
    expect(runRecurringCycle).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret", async () => {
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
    expect(runRecurringCycle).not.toHaveBeenCalled();
  });

  it("503 when the Pipedrive token is unset", async () => {
    delete process.env.PIPEDRIVE_API_TOKEN;
    delete process.env.PIPEDRIVE_API_KEY;
    delete process.env.PIPEDRIVE_TOKEN;
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pipedrive_not_configured" });
    expect(selectRecurringAccounts).not.toHaveBeenCalled();
  });

  it("503 when neither the recurring nor onboarding board/phase pair is set", async () => {
    delete process.env.PIPEDRIVE_ONBOARDING_BOARD_ID;
    delete process.env.PIPEDRIVE_ONBOARDING_PHASE_ID;
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "board_not_configured" });
    expect(runRecurringCycle).not.toHaveBeenCalled();
  });

  it("200 on a clean run and falls back to the onboarding board when recurring vars unset", async () => {
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      created: 1,
      skipped: 1,
      errored: 0,
      // PSG-817 roster-gate audit surfaced in the response (no silent truncation).
      roster: {
        rosterApplied: true,
        derivedTotal: 3,
        selected: 1,
        excluded: 2,
        supplementApplied: false,
        supplementAdded: 0,
      },
    });
    expect(selectRecurringAccounts).toHaveBeenCalledTimes(1);
    expect(runRecurringCycle).toHaveBeenCalledTimes(1);
    // Only the roster-selected accounts flow into the cycle.
    expect(runRecurringCycle.mock.calls[0][0].accounts).toEqual(SELECTION.accounts);
    // env-default fallback: onboarding board/phase (1/1) flowed through.
    expect(runRecurringCycle.mock.calls[0][0]).toMatchObject({ boardId: 1, phaseId: 1 });
  });

  it("prefers the dedicated recurring board pair when set", async () => {
    process.env.PIPEDRIVE_RECURRING_BOARD_ID = "3";
    process.env.PIPEDRIVE_RECURRING_PHASE_ID = "4";
    await POST(req({ authorization: "Bearer cron-secret" }));
    expect(runRecurringCycle.mock.calls[0][0]).toMatchObject({ boardId: 3, phaseId: 4 });
  });

  it("502 when any account errored so the monthly cron alerts", async () => {
    runRecurringCycle.mockResolvedValue({
      ...CLEAN,
      created: 0,
      skipped: 0,
      errored: 1,
      errors: [{ orgName: "Boom Co", orgId: 9, reason: "HTTP 500" }],
    });
    const res = await POST(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ errored: 1 });
  });
});
