import { describe, it, expect, vi } from "vitest";
import {
  provisionOnboardingBoard,
  onboardingProjectTitle,
  isDealWonTransition,
  dealPipelineId,
  isDealPipelineInScope,
  resolvePipedriveToken,
  createProjectsClient,
  normalizePhaseName,
  PipedriveProjectsError,
  type PipedriveProjectsClient,
  type CreateProjectInput,
  type CreateTaskInput,
  type ProjectPhase,
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

  it("maps assignee_id → assignee_ids:[id] on the v2 tasks wire body (PSG-680 regression)", async () => {
    // The v2 Tasks API assigns via `assignee_ids` (array); the singular `assignee_id` is
    // silently ignored (proven live), which left every provisioned task UNASSIGNED. Lock
    // the translation: createTask + updateTask must emit `assignee_ids`, never `assignee_id`.
    const create = recordingFetch({ id: 1 });
    await client(create.fetchImpl).createTask({ title: "t", project_id: 9, assignee_id: 777 });
    const createBody = JSON.parse(create.calls[0].body!);
    expect(createBody.assignee_ids).toEqual([777]);
    expect("assignee_id" in createBody).toBe(false);

    const update = recordingFetch({ id: 1 });
    await client(update.fetchImpl).updateTask!(1, { assignee_id: 888 });
    const updateBody = JSON.parse(update.calls[0].body!);
    expect(updateBody.assignee_ids).toEqual([888]);
    expect("assignee_id" in updateBody).toBe(false);

    // No assignee → no assignee field at all (unmapped role stays unassigned, not []).
    const none = recordingFetch({ id: 1 });
    await client(none.fetchImpl).createTask({ title: "t", project_id: 9 });
    const noneBody = JSON.parse(none.calls[0].body!);
    expect("assignee_ids" in noneBody).toBe(false);
    expect("assignee_id" in noneBody).toBe(false);
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

  it("listDealProducts reads /api/v1/deals/{id}/products and normalizes name + sku (PSG-668)", async () => {
    const { fetchImpl, calls } = recordingFetch([
      { product_id: 26, name: "Website Design & Build", sku: "psg_p_026 " },
      { product_id: 5, name: "Legacy line", product: { code: "OLD_CODE" } },
      { product_id: 9, name: "No sku item" },
    ]);
    const rows = await client(fetchImpl).listDealProducts!(3915);
    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("GET");
    expect(u.pathname).toBe("/api/v1/deals/3915/products");
    expect(u.searchParams.get("api_token")).toBe(TOKEN);
    expect(rows).toEqual([
      { name: "Website Design & Build", sku: "psg_p_026", productId: 26 },
      { name: "Legacy line", sku: "OLD_CODE", productId: 5 }, // falls back to product.code
      { name: "No sku item", sku: null, productId: 9 },
    ]);
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

describe("createProjectsClient — PSG-642 thin v2-Tasks adapter (updateTask + attachProjectFile)", () => {
  const TOKEN = "tok_secret_value";
  /** Recording fetch that captures method/url/body (string OR FormData). */
  function recordingFetch(data: unknown = { id: 1 }) {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: init?.body,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data }),
      } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }
  function client(fetchImpl: typeof fetch) {
    return createProjectsClient({ apiKey: TOKEN, companyDomain: "psg", fetchImpl });
  }

  it("updateTask PATCHes /api/v2/tasks/{id} with only the changed fields, token in query", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 55 });
    const driveLink = "See report: https://drive.google.com/file/d/abc/view";
    const res = await client(fetchImpl).updateTask!(55, { description: driveLink });
    expect(res.id).toBe(55);

    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("PATCH");
    expect(`${u.origin}${u.pathname}`).toBe("https://psg.pipedrive.com/api/v2/tasks/55");
    expect(u.pathname.startsWith("/api/")).toBe(true); // PSG-588 base-path discipline
    expect(u.searchParams.get("api_token")).toBe(TOKEN); // token in query, not path
    expect(JSON.parse(String(calls[0].body))).toEqual({ description: driveLink });
  });

  it("attachProjectFile POSTs multipart to /api/v1/files with the file + project_id", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 900 });
    const res = await client(fetchImpl).attachProjectFile!({
      projectId: 42,
      fileName: "report.pdf",
      content: "PDFBYTES",
      contentType: "application/pdf",
    });
    expect(res.id).toBe(900);

    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("POST");
    expect(`${u.origin}${u.pathname}`).toBe("https://psg.pipedrive.com/api/v1/files");
    expect(u.searchParams.get("api_token")).toBe(TOKEN);
    // Body is FormData (boundary derived by fetch — we never set Content-Type by hand).
    expect(calls[0].body).toBeInstanceOf(FormData);
    const form = calls[0].body as FormData;
    expect(form.get("project_id")).toBe("42");
    expect(form.has("file")).toBe(true);
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("updateTask surfaces a secret-free error on non-2xx (path + status only)", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 400, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    let err: PipedriveProjectsError | undefined;
    try {
      await client(fetchImpl).updateTask!(7, { description: "x" });
    } catch (e) {
      err = e as PipedriveProjectsError;
    }
    expect(err).toBeInstanceOf(PipedriveProjectsError);
    expect(err?.status).toBe(400);
    expect(err?.message).toContain("/api/v2/tasks/7");
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

describe("normalizePhaseName (PSG-715)", () => {
  it("strips a leading <letter><n> label so template names match bare board phases", () => {
    expect(normalizePhaseName("P1 — Discovery & Planning")).toBe("discovery & planning");
    expect(normalizePhaseName("D4 — Foundation Build")).toBe("foundation build");
    // hyphen and en-dash variants both strip
    expect(normalizePhaseName("P2 - Design")).toBe("design");
    // a bare board phase (no label) normalizes to the same key → matches
    expect(normalizePhaseName("Discovery & Planning")).toBe("discovery & planning");
    // no false strip of real words that merely start with a letter
    expect(normalizePhaseName("Launch")).toBe("launch");
  });
});

describe("provisionOnboardingBoard — phase stamping (PSG-715)", () => {
  // Board phases named to match the template's phases (with the label stripped) so every
  // task resolves a target phase. The bug: the engine created tasks but never called the
  // task→phase placement endpoint, so all tasks landed in "Phase unassigned".
  function phasesMatchingTemplate(boardId: number): ProjectPhase[] {
    return WHM_ONBOARDING_TEMPLATE.map((p, i) => ({
      id: 500 + i,
      name: p.name.replace(/^\s*[a-z]\d+\s*[—–-]\s*/i, ""), // bare board phase name
      board_id: boardId,
    }));
  }

  it("stamps every created task (parents + leaves) into its matching board phase", async () => {
    const setTaskPhaseOrGroup = vi.fn(async () => {});
    const listPhases = vi.fn(async (boardId: number) => phasesMatchingTemplate(boardId));
    const { client } = fakeClient({ listPhases, setTaskPhaseOrGroup });

    const res = await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });

    const totalTasks = WHM_ONBOARDING_TEMPLATE.length + templateTaskCount(); // parents + leaves
    expect(res.phasedTaskCount).toBe(totalTasks);
    expect(setTaskPhaseOrGroup).toHaveBeenCalledTimes(totalTasks);
    // Each placement targets a real phase id on the project, via phaseId (not group).
    for (const call of setTaskPhaseOrGroup.mock.calls) {
      const [projectId, , placement] = call as unknown as [
        number,
        number,
        { phaseId?: number; groupId?: number },
      ];
      expect(projectId).toBe(900); // the fake project id
      expect(placement.phaseId).toBeGreaterThanOrEqual(500);
      expect(placement.groupId).toBeUndefined();
    }
  });

  it("resolves the phase by NORMALIZED name (label-stripped, case-insensitive)", async () => {
    const setTaskPhaseOrGroup = vi.fn(async () => {});
    // D1 tasks must land in the phase whose bare name matches "Onboard & Access".
    const listPhases = vi.fn(async (boardId: number) => phasesMatchingTemplate(boardId));
    const { client } = fakeClient({ listPhases, setTaskPhaseOrGroup });
    await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });

    const d1PhaseId = 500; // first template phase → id 500 in the fake board
    const d1 = WHM_ONBOARDING_TEMPLATE[0]!;
    // The D1 parent + all D1 leaves are placed into phase 500.
    const d1Placements = setTaskPhaseOrGroup.mock.calls.filter(
      (c) => (c as unknown as [number, number, { phaseId?: number }])[2].phaseId === d1PhaseId,
    );
    expect(d1Placements.length).toBe(1 + d1.tasks.length);
  });

  it("degrades gracefully when the board has NO matching phases (no stamping, no throw)", async () => {
    const setTaskPhaseOrGroup = vi.fn(async () => {});
    const listPhases = vi.fn(async () => [
      { id: 1, name: "Kick-off", board_id: 3 },
      { id: 2, name: "Closing", board_id: 3 },
    ]);
    const { client } = fakeClient({ listPhases, setTaskPhaseOrGroup });

    const res = await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });
    expect(res.phasedTaskCount).toBe(0);
    expect(setTaskPhaseOrGroup).not.toHaveBeenCalled();
    expect(res.created).toBe(true); // provisioning still succeeds
  });

  it("degrades gracefully when the client cannot place tasks (no setTaskPhaseOrGroup)", async () => {
    // fakeClient() without the optional method → today's clients before this fix.
    const listPhases = vi.fn(async (boardId: number) => phasesMatchingTemplate(boardId));
    const { client } = fakeClient({ listPhases });
    const res = await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });
    expect(res.phasedTaskCount).toBe(0);
    expect(res.created).toBe(true);
  });

  it("a placement failure never aborts provisioning (task still created)", async () => {
    const setTaskPhaseOrGroup = vi.fn(async () => {
      throw new Error("pipedrive 500");
    });
    const listPhases = vi.fn(async (boardId: number) => phasesMatchingTemplate(boardId));
    const { client } = fakeClient({ listPhases, setTaskPhaseOrGroup });
    const res = await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });
    expect(res.created).toBe(true);
    expect(res.taskCount).toBe(templateTaskCount()); // all tasks created
    expect(res.phasedTaskCount).toBe(0); // none successfully stamped
  });
});

describe("createProjectsClient — setTaskPhaseOrGroup wire shape (PSG-715)", () => {
  const TOKEN = "tok_secret_value";
  function recordingFetch(data: unknown = { success: true }) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
        body: init?.body as string | undefined,
      });
      return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }
  const client = (fetchImpl: typeof fetch) =>
    createProjectsClient({ apiKey: TOKEN, companyDomain: "psg", fetchImpl });

  it("PUTs /api/v1/projects/{id}/plan/tasks/{taskId} with phase_id, token in query", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await client(fetchImpl).setTaskPhaseOrGroup!(900, 1001, { phaseId: 500 });
    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("PUT");
    expect(`${u.origin}${u.pathname}`).toBe(
      "https://psg.pipedrive.com/api/v1/projects/900/plan/tasks/1001",
    );
    expect(u.pathname.startsWith("/api/")).toBe(true); // PSG-588 base discipline
    expect(u.searchParams.get("api_token")).toBe(TOKEN); // token in query, not path
    expect(JSON.parse(String(calls[0].body))).toEqual({ phase_id: 500 });
  });

  it("sends only the placement keys provided (group_id, or both)", async () => {
    const g = recordingFetch();
    await client(g.fetchImpl).setTaskPhaseOrGroup!(900, 1, { groupId: 7 });
    expect(JSON.parse(String(g.calls[0].body))).toEqual({ group_id: 7 });

    const both = recordingFetch();
    await client(both.fetchImpl).setTaskPhaseOrGroup!(900, 1, { phaseId: 5, groupId: 7 });
    expect(JSON.parse(String(both.calls[0].body))).toEqual({ phase_id: 5, group_id: 7 });
  });

  it("is a no-op (no HTTP call) when neither phase nor group is given", async () => {
    const { fetchImpl, calls } = recordingFetch();
    await client(fetchImpl).setTaskPhaseOrGroup!(900, 1, {});
    expect(calls.length).toBe(0);
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
