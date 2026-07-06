import { describe, it, expect, vi } from "vitest";
import {
  provisionOnboardingBoard,
  onboardingProjectTitle,
  isDealWonTransition,
  dealPipelineId,
  isDealPipelineInScope,
  resolvePipedriveToken,
  createProjectsClient,
  PipedriveProjectsError,
  type PipedriveProjectsClient,
  type CreateProjectInput,
  type CreateTaskInput,
  type WonDeal,
} from "../projects";
import { WHM_ONBOARDING_TEMPLATE, templateTaskCount } from "../onboarding-template";

const DEAL: WonDeal = {
  id: 4242,
  title: "Sunrise Collision",
  orgName: "Sunrise Collision LLC",
  orgId: 77,
  personId: 12,
  wonDate: "2026-07-06",
};

function fakeClient(overrides: Partial<PipedriveProjectsClient> = {}) {
  let nextId = 1000;
  const createProject = vi.fn(async (_input: CreateProjectInput) => ({ id: 900 }));
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const findProjectByTitle = vi.fn(async (_title: string) => null as { id: number } | null);
  const client: PipedriveProjectsClient = {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    createProject,
    createTask,
    findProjectByTitle,
    // verify-e2e (PSG-602) verbs — unused by provisionOnboardingBoard, stubbed for the type.
    getProject: vi.fn(async () => ({
      id: 900,
      title: "",
      board_id: 0,
      phase_id: 0,
      start_date: "",
      deal_ids: [],
    })),
    listProjectTasks: vi.fn(async () => []),
    deleteProject: vi.fn(async () => {}),
    createDeal: vi.fn(async () => ({ id: 555 })),
    updateDealStatus: vi.fn(async () => {}),
    deleteDeal: vi.fn(async () => {}),
    ...overrides,
  };
  return { client, createProject, createTask, findProjectByTitle };
}

describe("provisionOnboardingBoard", () => {
  it("creates one project + one parent task per phase + every leaf task", async () => {
    const { client, createProject, createTask } = fakeClient();
    const res = await provisionOnboardingBoard({
      client,
      deal: DEAL,
      boardId: 3,
      phaseId: 9,
    });

    expect(res.created).toBe(true);
    expect(res.skippedExisting).toBe(false);
    expect(res.phaseCount).toBe(WHM_ONBOARDING_TEMPLATE.length);
    expect(res.taskCount).toBe(templateTaskCount());

    expect(createProject).toHaveBeenCalledTimes(1);
    // parent tasks (5 phases) + 25 leaf tasks = 30 createTask calls.
    expect(createTask).toHaveBeenCalledTimes(
      WHM_ONBOARDING_TEMPLATE.length + templateTaskCount(),
    );

    // Project links the deal, sets Day-0 start, and drops into the given board/phase.
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 3,
        phase_id: 9,
        start_date: "2026-07-06",
        deal_ids: [4242],
        org_ids: [77],
        person_ids: [12],
      }),
    );
  });

  it("dates the first D1 task at Day 0 + offset and the final task at Day 55", async () => {
    const { client, createTask } = fakeClient();
    await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });

    const leafCalls = createTask.mock.calls.map((c) => c[0]);
    const welcome = leafCalls.find((t) =>
      t.title.startsWith("Send welcome email"),
    );
    const signoff = leafCalls.find((t) =>
      t.title.startsWith("Client sign-off"),
    );
    expect(welcome?.due_date).toBe("2026-07-07"); // Day 1
    expect(signoff?.due_date).toBe("2026-08-30"); // Day 55
    // Leaf tasks are nested under a phase parent.
    expect(welcome?.parent_task_id).toBeDefined();
  });

  it("assigns tasks to users when a role→user map is supplied", async () => {
    const { client, createTask } = fakeClient();
    await provisionOnboardingBoard({
      client,
      deal: DEAL,
      boardId: 3,
      phaseId: 9,
      roleUserMap: { AS: 501, Analytics: 502 },
    });
    const calls = createTask.mock.calls.map((c) => c[0]);
    const asTask = calls.find((t) => t.title.startsWith("Send welcome email"));
    expect(asTask?.assignee_id).toBe(501);
    // Unmapped roles (Ads/Web/CRO here) must stay UNASSIGNED — no hard failure.
    const adsTask = calls.find((t) => t.title.startsWith("D2a Ads account audit"));
    expect(adsTask?.assignee_id).toBeUndefined();
  });

  it("is idempotent: an existing project short-circuits (no double create)", async () => {
    const { client, createProject, createTask } = fakeClient({
      findProjectByTitle: vi.fn(async () => ({ id: 900 })),
    });
    const res = await provisionOnboardingBoard({
      client,
      deal: DEAL,
      boardId: 3,
      phaseId: 9,
    });
    expect(res.skippedExisting).toBe(true);
    expect(res.created).toBe(false);
    expect(createProject).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("createProjectsClient — transport (PSG-588: /api/ base path + v1/v2 per endpoint)", () => {
  /** A fetch stub that records the URL/method it was called with and returns `data`. */
  function recordingFetch(data: unknown = []) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data }),
      } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  const TOKEN = "tok_secret_value";
  function client(fetchImpl: typeof fetch) {
    return createProjectsClient({ apiKey: TOKEN, companyDomain: "psg", fetchImpl });
  }

  it("hits /api/v2 FLAT paths for projects/boards/phases/tasks (never bare /v1/ and never /projects/boards)", async () => {
    const cases: Array<[string, (c: PipedriveProjectsClient) => Promise<unknown>, string, string, unknown]> = [
      ["boards", (c) => c.listBoards(), "GET", "https://psg.pipedrive.com/api/v2/boards", []],
      ["phases", (c) => c.listPhases(3), "GET", "https://psg.pipedrive.com/api/v2/phases", []],
      ["projects (find)", (c) => c.findProjectByTitle("x"), "GET", "https://psg.pipedrive.com/api/v2/projects", []],
      ["projects (create)", (c) => c.createProject({ title: "x", board_id: 1, phase_id: 2 }), "POST", "https://psg.pipedrive.com/api/v2/projects", { id: 1 }],
      ["tasks (create)", (c) => c.createTask({ title: "t", project_id: 9 }), "POST", "https://psg.pipedrive.com/api/v2/tasks", { id: 1 }],
    ];
    for (const [, run, method, prefix, data] of cases) {
      const { fetchImpl, calls } = recordingFetch(data);
      await run(client(fetchImpl));
      const u = new URL(calls[0].url);
      expect(calls[0].method).toBe(method);
      expect(`${u.origin}${u.pathname}`).toBe(prefix);
      expect(u.pathname.startsWith("/api/")).toBe(true); // the whole PSG-588 fix
      expect(u.pathname).not.toContain("/projects/boards");
      expect(u.pathname).not.toContain("/projects/phases");
      expect(u.searchParams.get("api_token")).toBe(TOKEN); // token in query, not path
    }
  });

  it("keeps users on /api/v1 (no v2 users endpoint) and passes board_id + limit params", async () => {
    const { fetchImpl, calls } = recordingFetch([]);
    const c = client(fetchImpl);
    await c.listUsers();
    expect(new URL(calls[0].url).pathname).toBe("/api/v1/users");

    const phases = recordingFetch([]);
    await client(phases.fetchImpl).listPhases(42);
    expect(new URL(phases.calls[0].url).searchParams.get("board_id")).toBe("42");

    const find = recordingFetch([]);
    await client(find.fetchImpl).findProjectByTitle("x");
    expect(new URL(find.calls[0].url).searchParams.get("limit")).toBe("500");
  });

  it("sends the v2 array shape (org_ids/person_ids), not the singular v1 fields", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 1 });
    await client(fetchImpl).createProject({
      title: "x",
      board_id: 1,
      phase_id: 2,
      deal_ids: [4242],
      org_ids: [77],
      person_ids: [12],
    });
    const body = JSON.parse(calls[0].body ?? "{}");
    expect(body.org_ids).toEqual([77]);
    expect(body.person_ids).toEqual([12]);
    expect(body).not.toHaveProperty("org_id");
    expect(body).not.toHaveProperty("person_id");
  });

  it("never leaks the token or URL in error messages on non-2xx", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    const c = createProjectsClient({ apiKey: TOKEN, companyDomain: "psg", fetchImpl });
    let err: PipedriveProjectsError | undefined;
    try {
      await c.listBoards();
    } catch (e) {
      err = e as PipedriveProjectsError;
    }
    expect(err).toBeInstanceOf(PipedriveProjectsError);
    expect(err?.status).toBe(404);
    expect(err?.message).toContain("/api/v2/boards");
    expect(err?.message).not.toContain(TOKEN); // token must never appear in the message
  });

  it("throws a secret-free error when no token is configured", () => {
    expect(() => createProjectsClient({ apiKey: "", fetchImpl: fetch })).toThrow(
      /Missing Pipedrive token/,
    );
  });
});

describe("createProjectsClient — verify-e2e verbs (PSG-602: read + delete + deal)", () => {
  const TOKEN = "tok_secret_value";
  function client(fetchImpl: typeof fetch) {
    return createProjectsClient({ apiKey: TOKEN, companyDomain: "psg", fetchImpl });
  }
  /** A fetch stub that records URL/method/body and returns `{success,data,additional_data}`. */
  function recordingFetch(data: unknown = {}, additional?: { next_cursor?: string | null }) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data, additional_data: additional }),
      } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("getProject GETs /api/v2/projects/{id} and maps deal_ids", async () => {
    const { fetchImpl, calls } = recordingFetch({
      id: 900,
      title: "Onboarding — QA E2E Test (deal 42)",
      board_id: 3,
      phase_id: 9,
      start_date: "2026-07-06",
      deal_ids: [42],
    });
    const p = await client(fetchImpl).getProject(900);
    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("GET");
    expect(u.pathname).toBe("/api/v2/projects/900");
    expect(u.searchParams.get("api_token")).toBe(TOKEN);
    expect(p).toEqual({
      id: 900,
      title: "Onboarding — QA E2E Test (deal 42)",
      board_id: 3,
      phase_id: 9,
      start_date: "2026-07-06",
      deal_ids: [42],
    });
  });

  it("listProjectTasks GETs /api/v2/tasks?project_id= and follows cursor pagination", async () => {
    const calls: Array<{ url: string }> = [];
    let page = 0;
    const fetchImpl = (async (input: string | URL) => {
      calls.push({ url: String(input) });
      const body =
        page === 0
          ? {
              success: true,
              data: [{ id: 1, title: "phase", parent_task_id: null, project_id: 900 }],
              additional_data: { next_cursor: "CURSOR_2" },
            }
          : {
              success: true,
              data: [
                { id: 2, title: "leaf", due_date: "2026-07-07", parent_task_id: 1, project_id: 900 },
              ],
              additional_data: { next_cursor: null },
            };
      page += 1;
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;

    const tasks = await client(fetchImpl).listProjectTasks(900);
    expect(calls).toHaveLength(2); // followed the cursor to a 2nd page
    expect(new URL(calls[0].url).pathname).toBe("/api/v2/tasks");
    expect(new URL(calls[0].url).searchParams.get("project_id")).toBe("900");
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe("CURSOR_2");
    expect(tasks).toEqual([
      { id: 1, title: "phase", due_date: null, parent_task_id: null, project_id: 900 },
      { id: 2, title: "leaf", due_date: "2026-07-07", parent_task_id: 1, project_id: 900 },
    ]);
  });

  it("deleteProject DELETEs /api/v2/projects/{id}", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 900 });
    await client(fetchImpl).deleteProject(900);
    expect(calls[0].method).toBe("DELETE");
    expect(new URL(calls[0].url).pathname).toBe("/api/v2/projects/900");
  });

  it("createDeal POSTs /api/v2/deals with title+pipeline_id (and optional org/person)", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 555 });
    const res = await client(fetchImpl).createDeal({
      title: "ZZZ QA E2E 2026-07-06 — delete me",
      pipeline_id: 8,
      org_id: 77,
    });
    expect(res).toEqual({ id: 555 });
    expect(calls[0].method).toBe("POST");
    expect(new URL(calls[0].url).pathname).toBe("/api/v2/deals");
    const sent = JSON.parse(calls[0].body ?? "{}");
    expect(sent).toEqual({
      title: "ZZZ QA E2E 2026-07-06 — delete me",
      pipeline_id: 8,
      org_id: 77,
    });
    expect(sent).not.toHaveProperty("person_id"); // omitted when absent
  });

  it("updateDealStatus PATCHes /api/v2/deals/{id} with {status:'won'}", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 555 });
    await client(fetchImpl).updateDealStatus(555, "won");
    expect(calls[0].method).toBe("PATCH");
    expect(new URL(calls[0].url).pathname).toBe("/api/v2/deals/555");
    expect(JSON.parse(calls[0].body ?? "{}")).toEqual({ status: "won" });
  });

  it("deleteDeal DELETEs /api/v2/deals/{id}", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 555 });
    await client(fetchImpl).deleteDeal(555);
    expect(calls[0].method).toBe("DELETE");
    expect(new URL(calls[0].url).pathname).toBe("/api/v2/deals/555");
  });

  it("never leaks the token or URL in errors on non-2xx (deal verbs)", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 403, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    let err: PipedriveProjectsError | undefined;
    try {
      await client(fetchImpl).createDeal({ title: "x", pipeline_id: 8 });
    } catch (e) {
      err = e as PipedriveProjectsError;
    }
    expect(err).toBeInstanceOf(PipedriveProjectsError);
    expect(err?.status).toBe(403);
    expect(err?.message).not.toContain(TOKEN);
  });
});

describe("onboardingProjectTitle", () => {
  it("is deterministic and prefers the org name", () => {
    expect(onboardingProjectTitle(DEAL)).toBe(
      "Onboarding — Sunrise Collision LLC (deal 4242)",
    );
  });
  it("falls back to the deal title when org name is absent", () => {
    expect(
      onboardingProjectTitle({ ...DEAL, orgName: null }),
    ).toBe("Onboarding — Sunrise Collision (deal 4242)");
  });
});

describe("isDealWonTransition", () => {
  it("fires only on the transition INTO won", () => {
    expect(
      isDealWonTransition({ current: { status: "won" }, previous: { status: "open" } }),
    ).toBe(true);
  });
  it("ignores an already-won deal re-sent (idempotent webhook)", () => {
    expect(
      isDealWonTransition({ current: { status: "won" }, previous: { status: "won" } }),
    ).toBe(false);
  });
  it("ignores non-won updates", () => {
    expect(
      isDealWonTransition({ current: { status: "open" }, previous: { status: "open" } }),
    ).toBe(false);
    expect(isDealWonTransition({ current: { status: "lost" }, previous: null })).toBe(
      false,
    );
  });
});

describe("dealPipelineId", () => {
  it("reads a bare numeric pipeline_id", () => {
    expect(dealPipelineId({ pipeline_id: 8 })).toBe(8);
    expect(dealPipelineId({ pipeline_id: "8" })).toBe(8);
  });
  it("reads a nested { value } pipeline_id", () => {
    expect(dealPipelineId({ pipeline_id: { value: 8, name: "Sales" } })).toBe(8);
  });
  it("returns null when absent or unparseable", () => {
    expect(dealPipelineId({})).toBeNull();
    expect(dealPipelineId(null)).toBeNull();
    expect(dealPipelineId({ pipeline_id: "n/a" })).toBeNull();
  });
});

describe("isDealPipelineInScope", () => {
  it("passes every deal when no pipeline is configured (scoping off)", () => {
    expect(isDealPipelineInScope({ pipeline_id: 3 }, null)).toBe(true);
    expect(isDealPipelineInScope({ pipeline_id: 8 }, undefined)).toBe(true);
  });
  it("passes only deals won in the configured sales pipeline", () => {
    expect(isDealPipelineInScope({ pipeline_id: 8 }, 8)).toBe(true);
    expect(isDealPipelineInScope({ pipeline_id: { value: 8 } }, 8)).toBe(true);
  });
  it("rejects won deals from other pipelines", () => {
    expect(isDealPipelineInScope({ pipeline_id: 3 }, 8)).toBe(false);
    expect(isDealPipelineInScope({}, 8)).toBe(false);
  });
});

describe("resolvePipedriveToken", () => {
  it("reads the canonical PIPEDRIVE_API_TOKEN (what Vercel actually holds)", () => {
    expect(resolvePipedriveToken({ PIPEDRIVE_API_TOKEN: "tok_canonical" })).toBe(
      "tok_canonical",
    );
  });
  it("accepts PIPEDRIVE_API_KEY as an alias", () => {
    expect(resolvePipedriveToken({ PIPEDRIVE_API_KEY: "tok_alias" })).toBe("tok_alias");
  });
  it("prefers PIPEDRIVE_API_TOKEN over the aliases", () => {
    expect(
      resolvePipedriveToken({
        PIPEDRIVE_API_TOKEN: "tok_canonical",
        PIPEDRIVE_TOKEN: "tok_two",
        PIPEDRIVE_API_KEY: "tok_alias",
      }),
    ).toBe("tok_canonical");
  });
  it("trims whitespace and skips empty values", () => {
    expect(
      resolvePipedriveToken({ PIPEDRIVE_API_TOKEN: "   ", PIPEDRIVE_API_KEY: "  tok  " }),
    ).toBe("tok");
  });
  it("returns empty string when no token env is set", () => {
    expect(resolvePipedriveToken({})).toBe("");
  });
});
