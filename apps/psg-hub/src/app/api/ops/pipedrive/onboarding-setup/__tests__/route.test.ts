import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Pipedrive module: keep the real PipedriveProjectsError (so the route's
// `instanceof` branch works) but stub the client factories + token resolver.
const listBoards = vi.fn();
const listPhases = vi.fn();
const listWebhooks = vi.fn();
const createWebhook = vi.fn();

vi.mock("@/lib/pipedrive/projects", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/pipedrive/projects")>();
  return {
    ...actual,
    resolvePipedriveToken: vi.fn(() => "test-token"),
    createProjectsClient: vi.fn(() => ({ listBoards, listPhases })),
    createWebhooksClient: vi.fn(() => ({ list: listWebhooks, create: createWebhook })),
  };
});

// PSG-607 — recurring actions (`recurring-qa-smoke`, `recurring-run`). Stub the heavy live
// helpers; keep the real resolveRecurringBoardConfig so the env-pair/fallback is exercised.
const { runRecurringQaSmoke } = vi.hoisted(() => ({ runRecurringQaSmoke: vi.fn() }));
const { activeRecurringAccounts, runRecurringCycle } = vi.hoisted(() => ({
  activeRecurringAccounts: vi.fn(),
  runRecurringCycle: vi.fn(),
}));
vi.mock("@/lib/pipedrive/recurring-qa-smoke", () => ({ runRecurringQaSmoke }));
vi.mock("@/lib/pipedrive/recurring-accounts", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/pipedrive/recurring-accounts")>();
  return { ...actual, activeRecurringAccounts, runRecurringCycle };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import { POST } from "../route";
import { PipedriveProjectsError } from "@/lib/pipedrive/projects";

const SECRET = "s3cr3t-onboarding-setup-value-0123456789ab";
const HOOK_URL = "https://hub.example.com/api/webhooks/pipedrive";

function makeReq(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request("https://hub.example.com/api/ops/pipedrive/onboarding-setup", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ONBOARDING_SETUP_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.com";
  process.env.PIPEDRIVE_WEBHOOK_USER = "hookuser";
  process.env.PIPEDRIVE_WEBHOOK_PASS = "hookpass";
  delete process.env.PIPEDRIVE_COMPANY_DOMAIN;
});

describe("POST /api/ops/pipedrive/onboarding-setup — auth", () => {
  it("401s with no bearer token", async () => {
    const res = await POST(makeReq({ action: "discover" }));
    expect(res.status).toBe(401);
    expect(listBoards).not.toHaveBeenCalled();
  });

  it("401s with a wrong bearer token", async () => {
    const res = await POST(makeReq({ action: "discover" }, "wrong-token"));
    expect(res.status).toBe(401);
    expect(listBoards).not.toHaveBeenCalled();
  });

  it("401s when the secret is not configured (fail closed)", async () => {
    delete process.env.ONBOARDING_SETUP_SECRET;
    const res = await POST(makeReq({ action: "discover" }, SECRET));
    expect(res.status).toBe(401);
  });

  it("passes auth with the correct bearer token", async () => {
    listBoards.mockResolvedValue([{ id: 1, name: "Delivery" }]);
    const res = await POST(makeReq({ action: "discover" }, SECRET));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/ops/pipedrive/onboarding-setup — discover", () => {
  it("returns boards, and phases when a boardId is given", async () => {
    listBoards.mockResolvedValue([
      { id: 3, name: "Delivery" },
      { id: 4, name: "Sales" },
    ]);
    listPhases.mockResolvedValue([
      { id: 9, name: "Not started", board_id: 3 },
      { id: 10, name: "In progress", board_id: 3 },
    ]);
    const res = await POST(makeReq({ action: "discover", boardId: 3 }, SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      boards: [
        { id: 3, name: "Delivery" },
        { id: 4, name: "Sales" },
      ],
      phases: [
        { id: 9, name: "Not started", board_id: 3 },
        { id: 10, name: "In progress", board_id: 3 },
      ],
    });
    expect(listPhases).toHaveBeenCalledWith(3);
  });

  it("returns boards only (no phases) when boardId is omitted", async () => {
    listBoards.mockResolvedValue([{ id: 3, name: "Delivery" }]);
    const res = await POST(makeReq({ action: "discover" }, SECRET));
    const json = await res.json();
    expect(json.boards).toHaveLength(1);
    expect(json.phases).toBeUndefined();
    expect(listPhases).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/pipedrive/onboarding-setup — register", () => {
  it("is idempotent: reuses an existing webhook and does not POST a duplicate", async () => {
    listWebhooks.mockResolvedValue([
      { id: 41, subscription_url: "https://other.example.com/x" },
      { id: 55, subscription_url: HOOK_URL },
    ]);
    const res = await POST(
      makeReq({ action: "register", boardId: 3, phaseId: 9 }, SECRET),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      alreadyRegistered: true,
      id: 55,
      boardId: 3,
      phaseId: 9,
    });
    expect(createWebhook).not.toHaveBeenCalled();
  });

  it("creates the deal-won webhook when none exists yet", async () => {
    listWebhooks.mockResolvedValue([]);
    createWebhook.mockResolvedValue({ id: 99 });
    const res = await POST(
      makeReq({ action: "register", boardId: 3, phaseId: 9 }, SECRET),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, alreadyRegistered: false, id: 99 });
    expect(createWebhook).toHaveBeenCalledTimes(1);
    expect(createWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionUrl: HOOK_URL,
        eventAction: "updated",
        eventObject: "deal",
        httpAuthUser: "hookuser",
        httpAuthPass: "hookpass",
      }),
    );
  });

  it("400s when boardId/phaseId are missing", async () => {
    const res = await POST(makeReq({ action: "register" }, SECRET));
    expect(res.status).toBe(400);
    expect(listWebhooks).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/pipedrive/onboarding-setup — hygiene & errors", () => {
  it("400s on unknown action", async () => {
    const res = await POST(makeReq({ action: "nope" }, SECRET));
    expect(res.status).toBe(400);
  });

  it("scrubs any URL / api_token from a surfaced error message", async () => {
    listBoards.mockRejectedValue(
      new PipedriveProjectsError(
        "https://co.pipedrive.com/api/v2/boards?api_token=SUPERSECRET failed",
        500,
      ),
    );
    const res = await POST(makeReq({ action: "discover" }, SECRET));
    expect(res.status).toBe(502);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("SUPERSECRET");
    expect(raw).not.toContain("api_token=SUPERSECRET");
    expect(raw).not.toContain("pipedrive.com");
    expect(raw).toContain("[url]");
  });
});

describe("POST /api/ops/pipedrive/onboarding-setup — recurring-qa-smoke (PSG-607)", () => {
  beforeEach(() => {
    process.env.PIPEDRIVE_ONBOARDING_BOARD_ID = "1";
    process.env.PIPEDRIVE_ONBOARDING_PHASE_ID = "1";
    delete process.env.PIPEDRIVE_RECURRING_BOARD_ID;
    delete process.env.PIPEDRIVE_RECURRING_PHASE_ID;
    runRecurringQaSmoke.mockResolvedValue({ allChecksPass: true, tree: { parentTasks: 3 } });
  });

  it("200 returns evidence, resolving board/phase from the onboarding fallback", async () => {
    const res = await POST(makeReq({ action: "recurring-qa-smoke", runTag: "t1" }, SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, evidence: { allChecksPass: true } });
    expect(runRecurringQaSmoke.mock.calls[0][0]).toMatchObject({
      boardId: 1,
      phaseId: 1,
      runTag: "t1",
    });
  });

  it("prefers the dedicated recurring board pair when set", async () => {
    process.env.PIPEDRIVE_RECURRING_BOARD_ID = "3";
    process.env.PIPEDRIVE_RECURRING_PHASE_ID = "4";
    await POST(makeReq({ action: "recurring-qa-smoke" }, SECRET));
    expect(runRecurringQaSmoke.mock.calls[0][0]).toMatchObject({ boardId: 3, phaseId: 4 });
  });

  it("503 board_not_configured when no board/phase pair is set", async () => {
    delete process.env.PIPEDRIVE_ONBOARDING_BOARD_ID;
    delete process.env.PIPEDRIVE_ONBOARDING_PHASE_ID;
    const res = await POST(makeReq({ action: "recurring-qa-smoke" }, SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "board_not_configured" });
    expect(runRecurringQaSmoke).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/pipedrive/onboarding-setup — recurring-run (PSG-607)", () => {
  beforeEach(() => {
    process.env.PIPEDRIVE_ONBOARDING_BOARD_ID = "1";
    process.env.PIPEDRIVE_ONBOARDING_PHASE_ID = "1";
    activeRecurringAccounts.mockResolvedValue([
      { orgName: "Sunrise", orgId: 77, personId: 11 },
    ]);
    runRecurringCycle.mockResolvedValue({
      cycleStart: "2026-09-01",
      total: 1,
      created: 1,
      skipped: 0,
      errored: 0,
      errors: [],
      projects: [{ orgName: "Sunrise", orgId: 77, projectId: 900, created: true }],
    });
  });

  it("200 spawns a cycle for the matched org id (only that account)", async () => {
    const res = await POST(makeReq({ action: "recurring-run", orgId: 77 }, SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, result: { created: 1 } });
    expect(runRecurringCycle.mock.calls[0][0].accounts).toEqual([
      { orgName: "Sunrise", orgId: 77, personId: 11 },
    ]);
  });

  it("400 when orgId is missing/non-numeric", async () => {
    const res = await POST(makeReq({ action: "recurring-run" }, SECRET));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "orgId_required" });
    expect(runRecurringCycle).not.toHaveBeenCalled();
  });

  it("404 when no active account matches the org id", async () => {
    const res = await POST(makeReq({ action: "recurring-run", orgId: 999 }, SECRET));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ reason: "account_not_found" });
    expect(runRecurringCycle).not.toHaveBeenCalled();
  });

  it("502 when the matched account errored", async () => {
    runRecurringCycle.mockResolvedValue({
      cycleStart: "2026-09-01",
      total: 1,
      created: 0,
      skipped: 0,
      errored: 1,
      errors: [{ orgName: "Sunrise", orgId: 77, reason: "HTTP 500" }],
      projects: [],
    });
    const res = await POST(makeReq({ action: "recurring-run", orgId: 77 }, SECRET));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});
