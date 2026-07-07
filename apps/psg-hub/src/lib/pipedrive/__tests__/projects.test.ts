import { describe, it, expect, vi } from "vitest";
import {
  provisionOnboardingBoard,
  ensureBoardPhases,
  onboardingProjectTitle,
  isDealWonTransition,
  dealPipelineId,
  isDealPipelineInScope,
  resolvePipedriveToken,
  createProjectsClient,
  PipedriveProjectsError,
  type PipedriveProjectsClient,
  type ProjectPhase,
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
  let nextPhaseId = 500;
  // A stateful phase store so createPhase + listPhases stay consistent (idempotency).
  const phases: ProjectPhase[] = [];
  const createProject = vi.fn(async (_input: CreateProjectInput) => ({ id: 900 }));
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const findProjectByTitle = vi.fn(async (_title: string) => null as { id: number } | null);
  const listPhases = vi.fn(async (boardId: number) =>
    phases.filter((p) => p.board_id === boardId),
  );
  const createPhase = vi.fn(async (boardId: number, name: string, _order?: number) => {
    const created = { id: nextPhaseId++, name, board_id: boardId };
    phases.push(created);
    return { id: created.id };
  });
  const setTaskPhase = vi.fn(async (_p: number, _t: number, _phase: number) => {});
  const client: PipedriveProjectsClient = {
    listBoards: vi.fn(async () => []),
    listPhases,
    listUsers: vi.fn(async () => []),
    createProject,
    createTask,
    findProjectByTitle,
    createPhase,
    setTaskPhase,
    ...overrides,
  };
  return { client, createProject, createTask, findProjectByTitle, createPhase, setTaskPhase, listPhases };
}

describe("provisionOnboardingBoard", () => {
  it("creates one project, one board phase per template phase, and every task FLAT + phase-stamped", async () => {
    const { client, createProject, createTask, createPhase, setTaskPhase } = fakeClient();
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
    // PSG-722: NO phase-parent tasks — exactly one createTask per template task.
    expect(createTask).toHaveBeenCalledTimes(templateTaskCount());
    // One board phase ensured per template phase (created because listPhases starts empty).
    expect(createPhase).toHaveBeenCalledTimes(WHM_ONBOARDING_TEMPLATE.length);
    expect(createPhase).toHaveBeenCalledWith(3, WHM_ONBOARDING_TEMPLATE[0]!.name, 1);
    // Every task is stamped into a phase (0 land in "Phase unassigned").
    expect(setTaskPhase).toHaveBeenCalledTimes(templateTaskCount());

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

  it("dates the first D1 task at Day 0 + offset and the final task at Day 55, and creates tasks FLAT", async () => {
    const { client, createTask } = fakeClient();
    await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });

    const taskCalls = createTask.mock.calls.map((c) => c[0]);
    const welcome = taskCalls.find((t) =>
      t.title.startsWith("Send welcome email"),
    );
    const signoff = taskCalls.find((t) =>
      t.title.startsWith("Client sign-off"),
    );
    expect(welcome?.due_date).toBe("2026-07-07"); // Day 1
    expect(signoff?.due_date).toBe("2026-08-30"); // Day 55
    // PSG-722: tasks are FLAT — no parent_task_id (phases replace the parent grouping).
    expect(welcome?.parent_task_id).toBeUndefined();
    expect(taskCalls.every((t) => t.parent_task_id === undefined)).toBe(true);
  });

  it("stamps each task into the phase matching its template phase name", async () => {
    const { client, createTask, createPhase, setTaskPhase } = fakeClient();
    await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });

    // name→phaseId as the fake assigned it (phase ids start at 500, in creation order).
    const phaseIdByName = new Map(
      createPhase.mock.calls.map((c, i) => [c[1] as string, 500 + i]),
    );
    // createTask then setTaskPhase are 1:1 in order, so pair them by index: the Nth stamp
    // is for the Nth created task. Assert each landed in ITS template phase.
    expect(setTaskPhase.mock.calls.length).toBe(createTask.mock.calls.length);
    setTaskPhase.mock.calls.forEach(([, , phaseId], i) => {
      const title = createTask.mock.calls[i]![0].title;
      const phase = WHM_ONBOARDING_TEMPLATE.find((p) =>
        p.tasks.some((t) => t.title === title),
      );
      expect(phase).toBeDefined();
      expect(phaseId).toBe(phaseIdByName.get(phase!.name));
    });
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

  it("is idempotent: an existing project short-circuits (no create, no phases, no stamps)", async () => {
    const { client, createProject, createTask, createPhase, setTaskPhase } = fakeClient({
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
    expect(createPhase).not.toHaveBeenCalled();
    expect(setTaskPhase).not.toHaveBeenCalled();
    // PSG-770: no stamps attempted on the no-op path.
    expect(res.phaseStampAttempts).toBe(0);
    expect(res.phaseStampConfirmed).toBe(0);
    expect(res.phaseStampDiagnostic).toBeNull();
  });

  it("PSG-770: reports every phase-stamp confirmed when the API accepts them all", async () => {
    const { client } = fakeClient();
    const res = await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });
    expect(res.phaseStampAttempts).toBe(templateTaskCount());
    expect(res.phaseStampConfirmed).toBe(templateTaskCount());
    expect(res.phaseStampDiagnostic).toBeNull();
  });

  it("PSG-770: a non-persisting stamp is non-fatal — the board still builds and the first reason is captured", async () => {
    // setTaskPhase throws (verify-after-retry failed live): the board must NOT abort — every
    // task is still created, and the failure is surfaced via the phaseStamp accounting so a
    // silent broken board can never ship.
    const setTaskPhase = vi.fn(async () => {
      throw new PipedriveProjectsError(
        "Pipedrive PUT /api/v1/projects/{id}/plan/tasks/{id} did not persist phase: sent phase_id=500, response phase_id=null",
      );
    });
    const { client, createTask } = fakeClient({ setTaskPhase });
    const res = await provisionOnboardingBoard({ client, deal: DEAL, boardId: 3, phaseId: 9 });
    // Board fully built despite the stamp failures.
    expect(res.created).toBe(true);
    expect(res.taskCount).toBe(templateTaskCount());
    expect(createTask).toHaveBeenCalledTimes(templateTaskCount());
    // Every stamp attempted, none confirmed, first reason captured (token-free).
    expect(res.phaseStampAttempts).toBe(templateTaskCount());
    expect(res.phaseStampConfirmed).toBe(0);
    expect(res.phaseStampDiagnostic).toMatch(/did not persist phase/);
  });
});

describe("ensureBoardPhases (PSG-722 name→id resolver + idempotent phase creation)", () => {
  it("creates a phase for each missing name (in order) and returns a name→id map", async () => {
    const { client, createPhase } = fakeClient();
    const map = await ensureBoardPhases(client, 3, ["Alpha", "Beta", "Gamma"]);
    expect(createPhase).toHaveBeenCalledTimes(3);
    // order_nr appends after existing (empty board ⇒ 1,2,3).
    expect(createPhase.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["Alpha", 1],
      ["Beta", 2],
      ["Gamma", 3],
    ]);
    expect([...map.keys()]).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(map.get("Alpha")).toBe(500);
  });

  it("is idempotent: existing phases are reused by name, nothing is re-created", async () => {
    const existing = [
      { id: 11, name: "Alpha", board_id: 3 },
      { id: 12, name: "Beta", board_id: 3 },
    ];
    const { client, createPhase } = fakeClient({
      listPhases: vi.fn(async () => existing),
    });
    const map = await ensureBoardPhases(client, 3, ["Alpha", "Beta"]);
    expect(createPhase).not.toHaveBeenCalled();
    expect(map.get("Alpha")).toBe(11);
    expect(map.get("Beta")).toBe(12);
  });

  it("creates only the missing phases when some already exist", async () => {
    const existing = [{ id: 11, name: "Alpha", board_id: 3 }];
    const { client, createPhase } = fakeClient({
      listPhases: vi.fn(async () => existing),
    });
    const map = await ensureBoardPhases(client, 3, ["Alpha", "Beta"]);
    expect(createPhase).toHaveBeenCalledTimes(1);
    // Appends after the one existing phase ⇒ order_nr 2.
    expect(createPhase).toHaveBeenCalledWith(3, "Beta", 2);
    expect(map.get("Alpha")).toBe(11);
    expect(map.get("Beta")).toBe(500);
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

  it("createPhase POSTs /api/v2/phases with { board_id, name, order_nr } (PSG-722)", async () => {
    const { fetchImpl, calls } = recordingFetch({ id: 71 });
    const res = await client(fetchImpl).createPhase!(7, "P1 — Discovery & Planning", 2);
    expect(res.id).toBe(71);
    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("POST");
    expect(`${u.origin}${u.pathname}`).toBe("https://psg.pipedrive.com/api/v2/phases");
    expect(u.searchParams.get("api_token")).toBe(TOKEN); // token in query, not path
    expect(JSON.parse(calls[0].body!)).toEqual({
      board_id: 7,
      name: "P1 — Discovery & Planning",
      order_nr: 2,
    });
  });

  it("setTaskPhase PUTs /api/v1/projects/{id}/plan/tasks/{taskId} with { phase_id } (PSG-722)", async () => {
    // PSG-770: the PUT response echoes the resulting task; setTaskPhase now verifies it, so
    // the stub must return the phase we sent (71) for the happy path.
    const { fetchImpl, calls } = recordingFetch({ id: 900, type: "task", phase_id: 71 });
    await client(fetchImpl).setTaskPhase!(42, 900, 71);
    const u = new URL(calls[0].url);
    expect(calls[0].method).toBe("PUT");
    expect(`${u.origin}${u.pathname}`).toBe(
      "https://psg.pipedrive.com/api/v1/projects/42/plan/tasks/900",
    );
    expect(u.pathname.startsWith("/api/")).toBe(true); // PSG-588 base-path discipline
    expect(u.searchParams.get("api_token")).toBe(TOKEN);
    expect(JSON.parse(calls[0].body!)).toEqual({ phase_id: 71 });
    // Verified stamp = exactly one PUT (no retry needed).
    expect(calls.length).toBe(1);
  });

  it("setTaskPhase verifies the PUT echoed our phase_id, retries once, then throws a token-free diagnostic (PSG-770)", async () => {
    // The exact live defect (PSG-764): the v1 plan PUT returns 200 but does NOT persist the
    // phase — its response echoes `phase_id: null`. The old code discarded the body and
    // returned silently, so every task stayed in "Phase unassigned". Now it retries once and
    // throws with the observed value (never the URL/token).
    const noPersist = () => {
      const calls: Array<{ url: string; body?: string }> = [];
      const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { id: 900, phase_id: null } }),
        } as Response;
      }) as unknown as typeof fetch;
      return { fetchImpl, calls };
    };
    const { fetchImpl, calls } = noPersist();
    await expect(client(fetchImpl).setTaskPhase!(42, 900, 71)).rejects.toThrowError(
      /did not persist phase: sent phase_id=71, response phase_id=null/,
    );
    // One retry ⇒ the PUT is attempted exactly twice before giving up.
    expect(calls.length).toBe(2);
    // The thrown message never leaks the token (it rides in the URL query string).
    await expect(client(noPersist().fetchImpl).setTaskPhase!(42, 900, 71)).rejects.toThrow(
      expect.not.stringContaining(TOKEN),
    );
  });

  it("setTaskPhase succeeds on the second attempt when the first PUT lags the plan (PSG-770 race)", async () => {
    // A task created via v2 `POST /tasks` can lag before it materialises in the v1 plan; the
    // first PUT echoes null, the retry echoes our phase → one retry recovers it, no throw.
    let n = 0;
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 900, phase_id: n++ === 0 ? null : 71 },
        }),
      }) as Response) as unknown as typeof fetch;
    await expect(client(fetchImpl).setTaskPhase!(42, 900, 71)).resolves.toBeUndefined();
    expect(n).toBe(2);
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
