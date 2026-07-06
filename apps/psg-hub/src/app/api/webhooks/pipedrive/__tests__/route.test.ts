import { describe, it, expect, vi, beforeEach } from "vitest";

// PSG-593 — unit test for the Pipedrive deal-won webhook HANDLER wiring
// (`api/webhooks/pipedrive/route.ts`). The underlying libs are covered by their own
// suites; here we assert the route's OWN behavior: auth gate, config guards, the
// idempotency/dedupe path, and the non-won ack.
//
// Strategy: partial-mock `@/lib/pipedrive/projects` — keep the REAL classifier helpers
// (isDealWonTransition / isDealPipelineInScope / dealPipelineId), the REAL
// provisionOnboardingBoard (so we exercise the true dedupe path via findProjectByTitle),
// and the REAL PipedriveProjectsError. We stub only the token resolver and the client
// factory so no network is touched.
const findProjectByTitle = vi.fn();
const createProject = vi.fn();
const createTask = vi.fn();

vi.mock("@/lib/pipedrive/projects", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/pipedrive/projects")>();
  return {
    ...actual,
    resolvePipedriveToken: vi.fn(() => "test-token"),
    createProjectsClient: vi.fn(() => ({
      findProjectByTitle,
      createProject,
      createTask,
    })),
  };
});

import { POST } from "../route";
import { resolvePipedriveToken } from "@/lib/pipedrive/projects";

const USER = "hookuser";
const PASS = "hookpass";
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;

function makeReq(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== undefined) headers.authorization = auth;
  return new Request("https://hub.example.com/api/webhooks/pipedrive", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A deal-update payload transitioning INTO `won` (fires provisioning). */
function wonPayload(id = 42, extra: Record<string, unknown> = {}) {
  return {
    event: "updated.deal",
    current: {
      id,
      status: "won",
      title: `Deal ${id}`,
      org_name: "Acme Collision",
      won_time: "2026-07-06 12:00:00",
      ...extra,
    },
    previous: { status: "open" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePipedriveToken).mockReturnValue("test-token");
  process.env.PIPEDRIVE_WEBHOOK_USER = USER;
  process.env.PIPEDRIVE_WEBHOOK_PASS = PASS;
  process.env.PIPEDRIVE_ONBOARDING_BOARD_ID = "3";
  process.env.PIPEDRIVE_ONBOARDING_PHASE_ID = "9";
  delete process.env.PIPEDRIVE_SALES_PIPELINE_ID; // scoping OFF → every won deal passes
  delete process.env.PIPEDRIVE_COMPANY_DOMAIN;
  // default happy provisioning stubs; individual tests override as needed
  findProjectByTitle.mockResolvedValue(null);
  createProject.mockResolvedValue({ id: 500 });
  createTask.mockResolvedValue({ id: 1 });
});

describe("POST /api/webhooks/pipedrive — auth", () => {
  it("401s when the Authorization header is missing", async () => {
    const res = await POST(makeReq(wonPayload()));
    expect(res.status).toBe(401);
    expect(findProjectByTitle).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("401s with a bad Basic-auth credential", async () => {
    const bad = `Basic ${Buffer.from("hookuser:WRONG").toString("base64")}`;
    const res = await POST(makeReq(wonPayload(), bad));
    expect(res.status).toBe(401);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("401s (fail closed) when the webhook user/pass are not configured", async () => {
    delete process.env.PIPEDRIVE_WEBHOOK_USER;
    delete process.env.PIPEDRIVE_WEBHOOK_PASS;
    const res = await POST(makeReq(wonPayload(), AUTH));
    expect(res.status).toBe(401);
  });

  it("proceeds past the auth gate with a valid Basic-auth header", async () => {
    const res = await POST(makeReq(wonPayload(), AUTH));
    expect(res.status).toBe(200);
    expect(createProject).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/webhooks/pipedrive — config guards", () => {
  it("503s and creates nothing when the Pipedrive token is unconfigured", async () => {
    vi.mocked(resolvePipedriveToken).mockReturnValue(null);
    const res = await POST(makeReq(wonPayload(), AUTH));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("pipedrive_not_configured");
    expect(findProjectByTitle).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("503s and creates nothing when the onboarding board/phase env is unset", async () => {
    delete process.env.PIPEDRIVE_ONBOARDING_BOARD_ID;
    delete process.env.PIPEDRIVE_ONBOARDING_PHASE_ID;
    const res = await POST(makeReq(wonPayload(), AUTH));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("board_not_configured");
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/pipedrive — idempotency wiring", () => {
  it("creates a project on a fresh won transition (dedupe path finds nothing)", async () => {
    const res = await POST(makeReq(wonPayload(42), AUTH));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, created: true, skippedExisting: false });
    // Dedupe lookup ran with the deterministic title before any create.
    expect(findProjectByTitle).toHaveBeenCalledWith(
      "Onboarding — Acme Collision (deal 42)",
    );
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it("re-firing the same won deal creates no second project (dedupe hit)", async () => {
    findProjectByTitle.mockResolvedValue({ id: 777 }); // project already exists
    const res = await POST(makeReq(wonPayload(42), AUTH));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      created: false,
      skippedExisting: true,
      projectId: 777,
    });
    expect(findProjectByTitle).toHaveBeenCalledTimes(1);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("an already-won deal (previous status also `won`) is a no-op", async () => {
    const payload = wonPayload(42);
    payload.previous = { status: "won" }; // not a transition INTO won
    const res = await POST(makeReq(payload, AUTH));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "not_won_transition" });
    expect(findProjectByTitle).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/pipedrive — non-won updates", () => {
  it("acks (200) a plain stage change / edit without creating a project", async () => {
    const payload = {
      event: "updated.deal",
      current: { id: 42, status: "open", title: "Deal 42", stage_id: 5 },
      previous: { status: "open", stage_id: 4 },
    };
    const res = await POST(makeReq(payload, AUTH));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, skipped: "not_won_transition" });
    expect(findProjectByTitle).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
  });
});
