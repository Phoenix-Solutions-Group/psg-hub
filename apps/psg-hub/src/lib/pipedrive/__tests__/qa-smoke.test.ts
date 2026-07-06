import { describe, it, expect } from "vitest";
import { runQaSmoke, isQaTestTitle, QA_TEST_MARKER } from "../qa-smoke";
import { templateTaskCount, WHM_ONBOARDING_TEMPLATE } from "../onboarding-template";

// A stateful in-memory Pipedrive so the smoke runs the REAL write path (projects.ts v2
// createProject/createTask/findProjectByTitle + qa-smoke's own deal/read/delete calls)
// against one coherent fake. No live API is ever hit.
function fakePipedrive(opts: { wonTime?: string } = {}) {
  const wonTime = opts.wonTime ?? "2026-07-06T12:00:00Z";
  let seq = 1;
  const deals = new Map<number, Record<string, unknown>>();
  const projects = new Map<number, Record<string, unknown>>();
  const tasks = new Map<number, Record<string, unknown>>();
  const log: Array<{ method: string; path: string }> = [];

  const ok = (data: unknown, additional: unknown = {}) =>
    new Response(JSON.stringify({ success: true, data, additional_data: additional }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const notFound = () => new Response(JSON.stringify({ success: false }), { status: 404 });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    // path after /api/, minus the leading version segment for matching
    const parts = u.pathname.split("/").filter(Boolean); // ['api','v1','deals', ...]
    const version = parts[1];
    const resource = parts[2];
    const id = parts[3] ? Number(parts[3]) : null;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    log.push({ method, path: `/${version}/${parts.slice(2).join("/")}` });

    // ── v1 deals ──
    if (version === "v1" && resource === "deals") {
      if (method === "POST") {
        const dealId = seq++;
        deals.set(dealId, {
          id: dealId,
          title: body.title,
          pipeline_id: body.pipeline_id,
          status: "open",
        });
        return ok({ id: dealId, title: body.title, pipeline_id: body.pipeline_id });
      }
      if (id != null && method === "PUT") {
        const d = deals.get(id);
        if (!d) return notFound();
        Object.assign(d, body, { won_time: wonTime });
        return ok({ ...d });
      }
      if (id != null && method === "GET") {
        const d = deals.get(id);
        return d ? ok({ ...d }) : notFound();
      }
      if (id != null && method === "DELETE") {
        deals.delete(id);
        return ok({ id });
      }
    }

    // ── v2 projects ──
    if (version === "v2" && resource === "projects") {
      if (method === "POST") {
        const pid = seq++;
        projects.set(pid, {
          id: pid,
          title: body.title,
          board_id: body.board_id,
          phase_id: body.phase_id,
          start_date: body.start_date,
        });
        return ok({ id: pid });
      }
      if (id != null && method === "GET") {
        const p = projects.get(id);
        return p ? ok({ ...p }) : notFound();
      }
      if (id != null && method === "DELETE") {
        projects.delete(id);
        for (const [tid, t] of tasks) if (t.project_id === id) tasks.delete(tid);
        return ok({ id });
      }
      if (id == null && method === "GET") {
        return ok([...projects.values()].map((p) => ({ ...p })));
      }
    }

    // ── v2 tasks ──
    if (version === "v2" && resource === "tasks") {
      if (method === "POST") {
        const tid = seq++;
        tasks.set(tid, {
          id: tid,
          title: body.title,
          project_id: body.project_id,
          parent_task_id: body.parent_task_id ?? null,
          due_date: body.due_date ?? null,
        });
        return ok({ id: tid });
      }
      if (id == null && method === "GET") {
        const pid = Number(u.searchParams.get("project_id"));
        return ok([...tasks.values()].filter((t) => t.project_id === pid).map((t) => ({ ...t })));
      }
    }

    return notFound();
  }) as unknown as typeof fetch;

  return { fetchImpl, deals, projects, tasks, log };
}

const noSleep = async () => {};

describe("runQaSmoke — full write-path E2E against an in-memory Pipedrive", () => {
  it("creates, wins, provisions, verifies, proves idempotency, and cleans up", async () => {
    const pd = fakePipedrive();
    const ev = await runQaSmoke({
      boardId: 1,
      phaseId: 1,
      salesPipelineId: 8,
      companyDomain: null,
      apiKey: "test-token",
      fetchImpl: pd.fetchImpl,
      sleep: noSleep,
      runTag: "unit-1",
    });

    // Deal + project identity
    expect(ev.ok).toBe(true);
    expect(ev.dealId).toBeGreaterThan(0);
    expect(ev.wonDate).toBe("2026-07-06");
    expect(ev.project.title).toBe(
      `Onboarding — ${QA_TEST_MARKER} — Move1 E2E unit-1 (deal ${ev.dealId})`,
    );
    expect(ev.project.board_id).toBe(1);
    expect(ev.project.phase_id).toBe(1);
    expect(ev.project.start_date).toBe("2026-07-06");

    // Task tree: 5 parents + 25 leaves = 30, exactly 3 GATE tasks
    expect(ev.tree.parentTasks).toBe(WHM_ONBOARDING_TEMPLATE.length);
    expect(ev.tree.leafTasks).toBe(templateTaskCount());
    expect(ev.tree.totalTasks).toBe(WHM_ONBOARDING_TEMPLATE.length + templateTaskCount());
    expect(ev.tree.gateTasks).toBe(3);
    expect(ev.tree.gateTitles.every((t) => t.toUpperCase().includes("GATE"))).toBe(true);

    // Due-date spot checks: D1 welcome = won+1, D5 client sign-off = won+55
    expect(ev.dueDateSpotChecks.d1Welcome.due).toBe("2026-07-07");
    expect(ev.dueDateSpotChecks.d1Welcome.ok).toBe(true);
    expect(ev.dueDateSpotChecks.d5SignOff.due).toBe("2026-08-30");
    expect(ev.dueDateSpotChecks.d5SignOff.ok).toBe(true);

    // Idempotency: second provision is a no-op on the same project id
    expect(ev.idempotency.skippedExisting).toBe(true);
    expect(ev.idempotency.projectIdMatches).toBe(true);
    expect(ev.idempotency.projectsListHasMore).toBe(false);

    // Cleanup: project + deal gone, nothing left behind
    expect(ev.cleanup.projectDeleted).toBe(true);
    expect(ev.cleanup.dealDeleted).toBe(true);
    expect(ev.cleanup.residualTestProjectRemains).toBe(false);
    expect(pd.projects.size).toBe(0);
    expect(pd.deals.size).toBe(0);

    // Every soft check passes
    expect(ev.allChecksPass).toBe(true);
  });

  it("re-deletes a project a late webhook re-creates after first cleanup", async () => {
    const pd = fakePipedrive();
    // Simulate a late deal-won webhook: re-create the onboarding project once, the
    // first time the cleanup loop scans and finds nothing (i.e. after first delete).
    let reprovisioned = false;
    const originalFetch = pd.fetchImpl;
    const wrapped = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(typeof input === "string" ? input : input.toString());
      const method = (init?.method ?? "GET").toUpperCase();
      const res = await originalFetch(input, init);
      // After the project is first deleted, inject exactly one re-provision so the
      // bounded cleanup re-scan has something to catch.
      if (
        !reprovisioned &&
        method === "DELETE" &&
        u.pathname.includes("/v2/projects/")
      ) {
        reprovisioned = true;
        const pid = 99999;
        pd.projects.set(pid, {
          id: pid,
          title: `Onboarding — ${QA_TEST_MARKER} — Move1 E2E unit-2 (deal 1)`,
          board_id: 1,
          phase_id: 1,
          start_date: "2026-07-06",
        });
      }
      return res;
    }) as unknown as typeof fetch;

    const ev = await runQaSmoke({
      boardId: 1,
      phaseId: 1,
      salesPipelineId: 8,
      companyDomain: null,
      apiKey: "test-token",
      fetchImpl: wrapped,
      sleep: noSleep,
      runTag: "unit-2",
    });

    expect(ev.cleanup.projectDeleted).toBe(true);
    expect(ev.cleanup.lateReprovisionsDeleted).toBe(1);
    expect(ev.cleanup.residualTestProjectRemains).toBe(false);
    expect(pd.projects.size).toBe(0);
  });

  it("delete guard predicate only accepts titles carrying the QA marker", () => {
    // The load-bearing safety guard: cleanup never deletes anything whose title lacks
    // the marker, so an id-plumbing bug can only ever hit test data.
    expect(isQaTestTitle(`Onboarding — ${QA_TEST_MARKER} — Move1 E2E run-1 (deal 42)`)).toBe(true);
    expect(isQaTestTitle(`${QA_TEST_MARKER} — Move1 E2E run-1`)).toBe(true);
    expect(isQaTestTitle("Onboarding — Sunrise Collision LLC (deal 4242)")).toBe(false);
    expect(isQaTestTitle("REAL CLIENT — do not delete")).toBe(false);
    expect(isQaTestTitle("")).toBe(false);
  });
});
