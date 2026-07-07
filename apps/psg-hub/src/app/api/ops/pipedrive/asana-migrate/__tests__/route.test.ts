import { describe, it, expect, vi, beforeEach } from "vitest";

// PSG-644 — route tests for the secret-gated Asana → Pipedrive migration action. Security
// surface: fail-closed bearer auth, both-tokens-required gate, no-secret-leak error
// scrubbing, and dry-run vs migrate dispatch. The heavy orchestrator + both client
// factories are stubbed; the REAL error classes are kept so the route's `instanceof`
// branches (status/reason mapping) are exercised.

const migrateClientOpenTasks = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pipedrive/asana-migrate", () => ({ migrateClientOpenTasks }));

// Keep the real AsanaClientError; stub the token resolver + client factory.
vi.mock("@/lib/pipedrive/asana-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/pipedrive/asana-client")>();
  return {
    ...actual,
    resolveAsanaToken: vi.fn(() => "asana-token"),
    createAsanaClient: vi.fn(() => ({})),
  };
});

// Keep the real PipedriveProjectsError; stub the token resolver + client factory.
vi.mock("@/lib/pipedrive/projects", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/pipedrive/projects")>();
  return {
    ...actual,
    resolvePipedriveToken: vi.fn(() => "pd-token"),
    createProjectsClient: vi.fn(() => ({})),
  };
});

import { POST } from "../route";
import { AsanaClientError, resolveAsanaToken } from "@/lib/pipedrive/asana-client";
import { PipedriveProjectsError, resolvePipedriveToken } from "@/lib/pipedrive/projects";

const SECRET = "asana-migration-secret-value-0123456789abcdef";

function makeReq(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request("https://hub.example.com/api/ops/pipedrive/asana-migrate", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const OK_BODY = {
  action: "dry-run",
  asanaProjectGid: "911403155718602",
  pipedriveProjectId: 95,
};

function fakeResult(overrides: Record<string, unknown> = {}) {
  return {
    clientLabel: "Alamo Heights",
    dryRun: true,
    asanaProjectGid: "911403155718602",
    pipedriveProjectId: 95,
    openTaskCount: 5,
    createdCount: 0,
    skippedAlreadyMigratedCount: 0,
    archivedCount: 149,
    historyCsv: "asana_gid,name\r\n1,Old task",
    tasks: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ASANA_MIGRATION_SECRET = SECRET;
  delete process.env.PIPEDRIVE_COMPANY_DOMAIN;
  vi.mocked(resolveAsanaToken).mockReturnValue("asana-token");
  vi.mocked(resolvePipedriveToken).mockReturnValue("pd-token");
  migrateClientOpenTasks.mockResolvedValue(fakeResult());
});

describe("POST /api/ops/pipedrive/asana-migrate — auth (fail-closed)", () => {
  it("401s with no bearer token, and never runs the migration", async () => {
    const res = await POST(makeReq(OK_BODY));
    expect(res.status).toBe(401);
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });

  it("401s with a wrong bearer token", async () => {
    const res = await POST(makeReq(OK_BODY, "wrong-token"));
    expect(res.status).toBe(401);
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });

  it("401s (locked) when the secret env var is unset", async () => {
    delete process.env.ASANA_MIGRATION_SECRET;
    const res = await POST(makeReq(OK_BODY, "anything"));
    expect(res.status).toBe(401);
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/pipedrive/asana-migrate — token gate", () => {
  it("503s when the Asana token is not configured", async () => {
    vi.mocked(resolveAsanaToken).mockReturnValue("");
    const res = await POST(makeReq(OK_BODY, SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "asana_not_configured" });
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });

  it("503s when the Pipedrive token is not configured", async () => {
    vi.mocked(resolvePipedriveToken).mockReturnValue("");
    const res = await POST(makeReq(OK_BODY, SECRET));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reason: "pipedrive_not_configured" });
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/pipedrive/asana-migrate — validation", () => {
  it("400s on bad JSON", async () => {
    const res = await POST(makeReq("{not json", SECRET));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "bad_json" });
  });

  it("400s on an unknown action", async () => {
    const res = await POST(makeReq({ ...OK_BODY, action: "delete-everything" }, SECRET));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "unknown_action" });
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });

  it("400s when required ids are missing", async () => {
    const res = await POST(makeReq({ action: "dry-run" }, SECRET));
    expect(res.status).toBe(400);
    expect(migrateClientOpenTasks).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/pipedrive/asana-migrate — dispatch", () => {
  it("runs a dry-run with dryRun:true and returns the result", async () => {
    const res = await POST(makeReq(OK_BODY, SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.openTaskCount).toBe(5);
    expect(json.result.createdCount).toBe(0);
    const arg = migrateClientOpenTasks.mock.calls[0][0];
    expect(arg.dryRun).toBe(true);
    expect(arg.asanaProjectGid).toBe("911403155718602");
    expect(arg.pipedriveProjectId).toBe(95);
  });

  it("runs a real migrate with dryRun:false", async () => {
    migrateClientOpenTasks.mockResolvedValue(fakeResult({ dryRun: false, createdCount: 5 }));
    const res = await POST(makeReq({ ...OK_BODY, action: "migrate" }, SECRET));
    expect(res.status).toBe(200);
    expect(migrateClientOpenTasks.mock.calls[0][0].dryRun).toBe(false);
  });

  it("coerces an assigneeMap to positive-int values only", async () => {
    await POST(
      makeReq(
        { ...OK_BODY, assigneeMap: { "111": 42, "222": "not-a-number", "333": -1, "444": 7 } },
        SECRET,
      ),
    );
    expect(migrateClientOpenTasks.mock.calls[0][0].assigneeMap).toEqual({ "111": 42, "444": 7 });
  });

  it("omits the CSV when includeHistoryCsv is false", async () => {
    const res = await POST(makeReq({ ...OK_BODY, includeHistoryCsv: false }, SECRET));
    const json = await res.json();
    expect(json.result.historyCsv).toBe("[omitted]");
  });

  it("passes the PSG-802 scope-filter flags through, coercing lists to clean strings", async () => {
    await POST(
      makeReq(
        {
          ...OK_BODY,
          excludeStaleRemnants: true,
          excludeStaleTitles: ["Extra Monthly Task", "  ", 42, "  Trim Me  "],
          excludeGids: ["111", "", 222, "  333  "],
        },
        SECRET,
      ),
    );
    const arg = migrateClientOpenTasks.mock.calls[0][0];
    expect(arg.excludeStaleRemnants).toBe(true);
    expect(arg.excludeStaleTitles).toEqual(["Extra Monthly Task", "Trim Me"]);
    expect(arg.excludeGids).toEqual(["111", "333"]);
  });

  it("defaults the scope filter OFF when the flags are absent", async () => {
    await POST(makeReq(OK_BODY, SECRET));
    const arg = migrateClientOpenTasks.mock.calls[0][0];
    expect(arg.excludeStaleRemnants).toBe(false);
    expect(arg.excludeStaleTitles).toEqual([]);
    expect(arg.excludeGids).toEqual([]);
  });
});

describe("POST /api/ops/pipedrive/asana-migrate — error mapping + secret scrubbing", () => {
  it("maps an AsanaClientError to reason=asana_error and scrubs any URL/token", async () => {
    migrateClientOpenTasks.mockRejectedValue(
      new AsanaClientError(
        "boom https://app.asana.com/api/1.0/tasks?api_token=SECRETVAL failed",
        403,
      ),
    );
    const res = await POST(makeReq(OK_BODY, SECRET));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.reason).toBe("asana_error");
    expect(json.detail).not.toContain("SECRETVAL");
    expect(json.detail).not.toContain("app.asana.com");
    expect(json.detail).toContain("[url]");
  });

  it("maps a PipedriveProjectsError to reason=pipedrive_error", async () => {
    migrateClientOpenTasks.mockRejectedValue(
      new PipedriveProjectsError("Pipedrive POST /api/v2/tasks returned HTTP 500", 500),
    );
    const res = await POST(makeReq(OK_BODY, SECRET));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ reason: "pipedrive_error" });
  });

  it("maps an unknown error to reason=internal_error", async () => {
    migrateClientOpenTasks.mockRejectedValue(new Error("kaboom"));
    const res = await POST(makeReq(OK_BODY, SECRET));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ reason: "internal_error" });
  });
});
