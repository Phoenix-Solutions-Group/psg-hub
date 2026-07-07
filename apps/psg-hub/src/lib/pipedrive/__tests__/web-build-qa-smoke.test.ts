import { describe, it, expect } from "vitest";
import { runWebBuildQaSmoke } from "../web-build-qa-smoke";
import { NEW_WEBSITE_BUILD_TEMPLATE } from "../web-build-template";
import { WEB_BUILD_TEMPLATE_DEF } from "../template-registry";

// A stateful in-memory Pipedrive so the smoke runs the REAL selector + write path
// (template-registry.provisionForDeal → projects.ts v2 createProject/createTask/
// findProjectByTitle + qa-smoke's own deal/read/delete calls) against one coherent fake.
// No live API is ever hit. This fake — unlike qa-smoke's — STORES assignee_id + description
// on tasks and returns them, so the UX/QA owner→assignee spot-checks are exercised.
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
    const parts = u.pathname.split("/").filter(Boolean); // ['api','v1','deals', ...]
    const version = parts[1];
    const resource = parts[2];
    const id = parts[3] ? Number(parts[3]) : null;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    log.push({ method, path: `/${version}/${parts.slice(2).join("/")}` });

    if (version === "v1" && (resource === "organizations" || resource === "persons")) {
      if (method === "POST") return ok({ id: seq++, name: body.name });
      if (id != null && method === "DELETE") return ok({ id });
    }

    if (version === "v1" && resource === "deals") {
      if (method === "POST") {
        const dealId = seq++;
        deals.set(dealId, {
          id: dealId,
          title: body.title,
          pipeline_id: body.pipeline_id,
          org_id: body.org_id ?? null,
          person_id: body.person_id ?? null,
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

    if (version === "v2" && resource === "projects") {
      if (method === "POST") {
        const pid = seq++;
        projects.set(pid, {
          id: pid,
          title: body.title,
          board_id: body.board_id,
          phase_id: body.phase_id,
          start_date: body.start_date,
          org_ids: body.org_ids ?? [],
          person_ids: body.person_ids ?? [],
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

    if (version === "v2" && resource === "tasks") {
      if (method === "POST") {
        const tid = seq++;
        tasks.set(tid, {
          id: tid,
          title: body.title,
          project_id: body.project_id,
          parent_task_id: body.parent_task_id ?? null,
          due_date: body.due_date ?? null,
          // The two fields this fake adds over qa-smoke's: preserved + returned so the
          // owner→assignee + role-from-description spot-checks are real.
          assignee_id: body.assignee_id ?? null,
          description: body.description ?? null,
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
const TEMPLATE_LEAVES = NEW_WEBSITE_BUILD_TEMPLATE.reduce((s, p) => s + p.tasks.length, 0);

// Prod-faithful role map: every role → a distinct user id (UX/QA are the PSG-668 roles).
const FULL_MAP = { AS: 11, UX: 22, Web: 33, QA: 44 } as const;

describe("runWebBuildQaSmoke — selector → New Website Build board, full E2E on a fake", () => {
  it("routes a web-build line item to the web-build template and builds the RIGHT board", async () => {
    const pd = fakePipedrive();
    const ev = await runWebBuildQaSmoke({
      defaultBoardId: 1,
      defaultPhaseId: 1,
      salesPipelineId: 8,
      companyDomain: null,
      apiKey: "test-token",
      fetchImpl: pd.fetchImpl,
      sleep: noSleep,
      runTag: "wb-1",
      roleUserMap: FULL_MAP,
      env: {},
    });

    // Selector picked the web-build template (the crux of this smoke).
    expect(ev.selection.templateId).toBe(WEB_BUILD_TEMPLATE_DEF.id);
    expect(ev.selection.matchedTemplate).toBe(true);
    expect(ev.selection.templateFamily).toBe(WEB_BUILD_TEMPLATE_DEF.family);

    // Structure: 4 phases / 22 leaves (6+5+6+5) / 4 gates / 26 total.
    expect(ev.tree.parentTasks).toBe(4);
    expect(ev.tree.leafTasks).toBe(TEMPLATE_LEAVES);
    expect(ev.tree.leafTasks).toBe(22);
    expect(ev.tree.leavesPerPhase).toEqual([6, 5, 6, 5]);
    expect(ev.tree.gateTasks).toBe(4);
    expect(ev.tree.totalTasks).toBe(26);

    // Board/phase resolve to the onboarding fallback (no WEBBUILD override in env:{}).
    expect(ev.expectedBoardId).toBe(1);
    expect(ev.project.board_id).toBe(1);
    expect(ev.project.phase_id).toBe(1);
    expect(ev.project.title.startsWith("New Website Build")).toBe(true);

    // UX + QA (+ Web control) owners resolve to their mapped Pipedrive users.
    const byRole = Object.fromEntries(ev.assigneeChecks.map((a) => [a.role, a]));
    expect(byRole.UX.actualAssigneeId).toBe(22);
    expect(byRole.UX.ok).toBe(true);
    expect(byRole.QA.actualAssigneeId).toBe(44);
    expect(byRole.QA.ok).toBe(true);
    expect(byRole.Web.actualAssigneeId).toBe(33);

    // Day-offsets landed (kick-off = +2, final gate = +63 from won date 2026-07-06).
    expect(ev.dueDateSpotChecks.kickoffD2.ok).toBe(true);
    expect(ev.dueDateSpotChecks.kickoffD2.due).toBe("2026-07-08");
    expect(ev.dueDateSpotChecks.finalGateD63.ok).toBe(true);
    expect(ev.dueDateSpotChecks.finalGateD63.due).toBe("2026-09-07");

    // Idempotency + project→deal link + cleanup.
    expect(ev.idempotency.skippedExisting).toBe(true);
    expect(ev.idempotency.projectIdMatches).toBe(true);
    expect(ev.project.org_ids.length).toBe(1);
    expect(ev.project.person_ids.length).toBe(1);
    expect(ev.cleanup.projectDeleted).toBe(true);
    expect(ev.cleanup.dealDeleted).toBe(true);
    expect(ev.cleanup.residualTestProjectRemains).toBe(false);

    // Every soft check passed.
    expect(ev.allChecksPass).toBe(true);
    expect(ev.checks.selectedWebBuildTemplate).toBe(true);

    // No residual test data left in the fake.
    expect(pd.projects.size).toBe(0);
    expect(pd.deals.size).toBe(0);
  });

  it("leaves an UNMAPPED role unassigned (role stays in the description), no failure", async () => {
    const pd = fakePipedrive();
    // UX intentionally omitted → UX tasks must stay unassigned; the check treats
    // unassigned-when-unmapped as OK (matches provisioning contract).
    const ev = await runWebBuildQaSmoke({
      defaultBoardId: 1,
      defaultPhaseId: 1,
      salesPipelineId: 8,
      companyDomain: null,
      apiKey: "test-token",
      fetchImpl: pd.fetchImpl,
      sleep: noSleep,
      runTag: "wb-unmapped",
      roleUserMap: { QA: 44 },
      env: {},
    });
    const ux = ev.assigneeChecks.find((a) => a.role === "UX")!;
    expect(ux.expectedUserId).toBe(null);
    expect(ux.actualAssigneeId).toBe(null);
    expect(ux.ok).toBe(true);
    // QA still resolves.
    expect(ev.assigneeChecks.find((a) => a.role === "QA")!.actualAssigneeId).toBe(44);
    // Still a clean, matched web-build build.
    expect(ev.selection.matchedTemplate).toBe(true);
    expect(ev.checks.qaAssigneeResolves).toBe(true);
    expect(ev.checks.uxAssigneeResolves).toBe(true);
  });

  it("honors the WEBBUILD board/phase env override when set", async () => {
    const pd = fakePipedrive();
    const ev = await runWebBuildQaSmoke({
      defaultBoardId: 1,
      defaultPhaseId: 1,
      salesPipelineId: 8,
      companyDomain: null,
      apiKey: "test-token",
      fetchImpl: pd.fetchImpl,
      sleep: noSleep,
      runTag: "wb-override",
      roleUserMap: FULL_MAP,
      env: {
        [WEB_BUILD_TEMPLATE_DEF.boardIdEnv]: "77",
        [WEB_BUILD_TEMPLATE_DEF.phaseIdEnv]: "88",
      },
    });
    expect(ev.expectedBoardId).toBe(77);
    expect(ev.expectedPhaseId).toBe(88);
    expect(ev.project.board_id).toBe(77);
    expect(ev.project.phase_id).toBe(88);
    expect(ev.checks.boardResolvesToExpected).toBe(true);
    expect(ev.checks.phaseResolvesToExpected).toBe(true);
    expect(ev.allChecksPass).toBe(true);
  });
});
