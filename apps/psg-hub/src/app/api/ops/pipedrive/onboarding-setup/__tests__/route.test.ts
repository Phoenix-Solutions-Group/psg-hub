import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Pipedrive module: keep the real PipedriveProjectsError (so the route's
// `instanceof` branch works) but stub the client factories + token resolver.
const listBoards = vi.fn();
const listPhases = vi.fn();
const listWebhooks = vi.fn();
const createWebhook = vi.fn();
// verify-e2e (PSG-602) — the read/delete/deal verbs + the board orchestrator.
const createDeal = vi.fn();
const updateDealStatus = vi.fn();
const getProject = vi.fn();
const listProjectTasks = vi.fn();
const deleteProject = vi.fn();
const deleteDeal = vi.fn();
const provision = vi.fn();

vi.mock("@/lib/pipedrive/projects", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/pipedrive/projects")>();
  return {
    ...actual,
    resolvePipedriveToken: vi.fn(() => "test-token"),
    provisionOnboardingBoard: (...args: unknown[]) => provision(...args),
    createProjectsClient: vi.fn(() => ({
      listBoards,
      listPhases,
      createDeal,
      updateDealStatus,
      getProject,
      listProjectTasks,
      deleteProject,
      deleteDeal,
    })),
    createWebhooksClient: vi.fn(() => ({ list: listWebhooks, create: createWebhook })),
  };
});

import { POST } from "../route";
import { PipedriveProjectsError } from "@/lib/pipedrive/projects";
import { WHM_ONBOARDING_TEMPLATE } from "@/lib/pipedrive/onboarding-template";

/** A realistic read-back: 5 D-phase parent rows + their 25 leaf tasks (3 contain GATE). */
function templateReadback() {
  const rows: Array<{
    id: number;
    title: string;
    due_date: string | null;
    parent_task_id: number | null;
    project_id: number;
  }> = [];
  let id = 1000;
  for (const phase of WHM_ONBOARDING_TEMPLATE) {
    const parentId = id++;
    rows.push({ id: parentId, title: phase.name, due_date: null, parent_task_id: null, project_id: 900 });
    for (const t of phase.tasks) {
      rows.push({ id: id++, title: t.title, due_date: "2026-07-07", parent_task_id: parentId, project_id: 900 });
    }
  }
  return rows;
}

const PROVISION_FIRST = {
  created: true,
  projectId: 900,
  phaseCount: 5,
  taskCount: 25,
  skippedExisting: false,
};
const PROVISION_SECOND = {
  created: false,
  projectId: 900,
  phaseCount: 0,
  taskCount: 0,
  skippedExisting: true,
};
const PROJECT_READBACK = {
  id: 900,
  title: "Onboarding — QA E2E Test (deal 555)",
  board_id: 3,
  phase_id: 9,
  start_date: "2026-07-06",
  deal_ids: [555],
};

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

describe("POST /api/ops/pipedrive/onboarding-setup — verify-e2e (PSG-602)", () => {
  beforeEach(() => {
    process.env.PIPEDRIVE_ONBOARDING_BOARD_ID = "3";
    process.env.PIPEDRIVE_ONBOARDING_PHASE_ID = "9";
    process.env.PIPEDRIVE_SALES_PIPELINE_ID = "8";
  });

  function primeHappyPath() {
    createDeal.mockResolvedValue({ id: 555 });
    updateDealStatus.mockResolvedValue(undefined);
    provision.mockResolvedValueOnce(PROVISION_FIRST).mockResolvedValueOnce(PROVISION_SECOND);
    getProject.mockResolvedValue(PROJECT_READBACK);
    listProjectTasks.mockResolvedValue(templateReadback());
    deleteProject.mockResolvedValue(undefined);
    deleteDeal.mockResolvedValue(undefined);
  }

  it("runs the full loop: deal→won→build→idempotent no-op→read→cleanup, returning evidence", async () => {
    primeHappyPath();
    const res = await POST(makeReq({ action: "verify-e2e" }, SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.ok).toBe(true);
    // 5 phases / 25 tasks / 3 gates — the approved PSG-580 template shape.
    expect(json.counts).toEqual({ phases: 5, tasks: 25, gates: 3 });
    expect(json.idempotent).toBe(true);
    expect(json.project).toEqual({
      id: 900,
      title: "Onboarding — QA E2E Test (deal 555)",
      board_id: 3,
      phase_id: 9,
      start_date: "2026-07-06",
    });
    expect(json.tasks).toHaveLength(25); // leaf tasks only, with due dates for QA
    expect(json.cleanup).toEqual({ projectDeleted: true, dealDeleted: true });

    // Deal created in the sales pipeline with the clearly-labelled throwaway title.
    expect(createDeal).toHaveBeenCalledWith(
      expect.objectContaining({ pipeline_id: 8, title: expect.stringContaining("ZZZ QA E2E") }),
    );
    expect(updateDealStatus).toHaveBeenCalledWith(555, "won");
    // Idempotency proof: provision called twice.
    expect(provision).toHaveBeenCalledTimes(2);
    // Cleanup deletes EXACTLY the ids this request created (900 / 555), nothing else.
    expect(deleteProject).toHaveBeenCalledWith(900);
    expect(deleteDeal).toHaveBeenCalledWith(555);
  });

  it("still runs cleanup (finally) when a read/assert throws", async () => {
    createDeal.mockResolvedValue({ id: 555 });
    updateDealStatus.mockResolvedValue(undefined);
    provision.mockResolvedValueOnce(PROVISION_FIRST).mockResolvedValueOnce(PROVISION_SECOND);
    getProject.mockResolvedValue(PROJECT_READBACK);
    listProjectTasks.mockRejectedValue(new Error("read blew up mid-verify"));
    deleteProject.mockResolvedValue(undefined);
    deleteDeal.mockResolvedValue(undefined);

    const res = await POST(makeReq({ action: "verify-e2e" }, SECRET));
    expect(res.status).toBe(502); // the read error is surfaced…
    // …but the throwaway artifacts were STILL cleaned up.
    expect(deleteProject).toHaveBeenCalledWith(900);
    expect(deleteDeal).toHaveBeenCalledWith(555);
  });

  it("503 when the board/phase/pipeline env is missing", async () => {
    delete process.env.PIPEDRIVE_SALES_PIPELINE_ID;
    const res = await POST(makeReq({ action: "verify-e2e" }, SECRET));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.reason).toBe("verify_env_not_configured");
    expect(createDeal).not.toHaveBeenCalled(); // nothing created before the env check
  });

  it("401s without a bearer — verify-e2e adds NO new auth surface", async () => {
    primeHappyPath();
    const res = await POST(makeReq({ action: "verify-e2e" }));
    expect(res.status).toBe(401);
    expect(createDeal).not.toHaveBeenCalled();
  });

  it("does not accept an id-to-delete from the request body (only self-created ids)", async () => {
    primeHappyPath();
    // A caller trying to smuggle a projectId/dealId to delete is ignored: cleanup still
    // targets the ids created THIS request (900 / 555), never the body's.
    const res = await POST(
      makeReq({ action: "verify-e2e", projectId: 1, dealId: 2 }, SECRET),
    );
    expect(res.status).toBe(200);
    expect(deleteProject).toHaveBeenCalledTimes(1);
    expect(deleteProject).toHaveBeenCalledWith(900);
    expect(deleteProject).not.toHaveBeenCalledWith(1);
    expect(deleteDeal).toHaveBeenCalledWith(555);
    expect(deleteDeal).not.toHaveBeenCalledWith(2);
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
