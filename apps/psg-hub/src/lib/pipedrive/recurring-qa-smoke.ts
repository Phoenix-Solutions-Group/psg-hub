import "server-only";

// PSG-607 Move 1 follow-on — live write-path QA smoke for the WHM monthly recurring board
// (build → verify → prove idempotent no-op → cleanup), run entirely server-side.
//
// Why this exists: same reason as qa-smoke.ts (Move 1 onboarding). The recurring builder's
// WRITE path against LIVE Pipedrive (create project + 3 group parents + 8 subtasks via
// Projects API v2) cannot be driven by QA (Tess): the write token is a SENSITIVE Vercel var
// no agent can read and there is no Pipedrive MCP. Rather than hand a human a curl runbook
// (rule #1), this runs the whole golden path in-process using the in-env token and returns
// structured JSON evidence for sign-off. Invoked via the secret-gated ops route
// (`/api/ops/pipedrive/onboarding-setup`, action `recurring-qa-smoke`).
//
// SAFETY: it reuses qa-smoke.ts's low-level REST client and the SAME "ZZ QA TEST" marker +
// marker-guarded deletes, so a bug in the id plumbing can only ever hit test data. The
// account's org name carries the marker, so the deterministic project title does too, and
// the delete guard keys off exactly that. Cleanup runs in `finally` with a bounded re-scan.
//
// Secret hygiene: inherited from qa-smoke.ts / projects.ts — the token rides ONLY in the
// query string and thrown errors carry PATH + status only, never the URL.

import {
  createProjectsClient,
  PipedriveProjectsError,
  type PipedriveProjectsClient,
} from "./projects";
import {
  provisionRecurringServiceBoard,
  recurringCycleTitle,
  type RecurringClient,
} from "./recurring";
import {
  recurringTaskCount,
  WHM_RECURRING_SERVICE_TEMPLATE,
} from "./recurring-service-template";
import {
  createQaRestClient,
  isQaTestTitle,
  QA_TEST_MARKER,
  type QaFetch,
  type QaProject,
} from "./qa-smoke";
import { firstOfCurrentMonthUTC } from "./recurring-accounts";

export interface RecurringQaSmokeOptions {
  boardId: number;
  phaseId: number;
  companyDomain?: string | null;
  fetchImpl?: QaFetch;
  /** Test seam: override the token so tests need no env. Route omits it (uses env token). */
  apiKey?: string;
  /** Test seam: sleep implementation (default real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Cycle anchor (Day 0). Defaults to the first of the current UTC month. */
  cycleStart?: string;
  /** Unique tag so concurrent/repeat runs never collide on a title. */
  runTag: string;
}

export interface RecurringQaSmokeEvidence {
  ok: boolean;
  cycleStart: string;
  account: { orgName: string; orgId: number | null; personId: number | null };
  project: {
    id: number;
    title: string;
    board_id: number | null;
    phase_id: number | null;
    start_date: string | null;
  };
  tree: {
    totalTasks: number;
    parentTasks: number;
    leafTasks: number;
    gateTasks: number;
    gateTitles: string[];
    parentTitles: string[];
  };
  idempotency: {
    skippedExisting: boolean;
    projectIdMatches: boolean;
    /** v2 projects list scale signal: true ⇒ dedupe list is paginated (latent risk). */
    projectsListHasMore: boolean;
  };
  cleanup: {
    projectDeleted: boolean;
    residualTestProjectRemains: boolean;
    lateReprovisionsDeleted: number;
  };
  checks: Record<string, boolean>;
  allChecksPass: boolean;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Throw unless `title` carries the QA marker — the load-bearing delete guard. */
function assertDeletable(kind: string, id: number, title: string): void {
  if (!isQaTestTitle(title)) {
    throw new PipedriveProjectsError(
      `Refusing to delete ${kind} ${id}: title does not carry the QA test marker`,
    );
  }
}

/**
 * Run the full recurring-board write-path smoke and return evidence. `provisionClient`
 * defaults to the REAL `createProjectsClient` (so the live v2 write path is genuinely
 * exercised); tests inject a fake. Cleanup always runs (in `finally`) and its results are
 * folded into the returned evidence via a shared-by-reference `cleanup` object.
 */
export async function runRecurringQaSmoke(
  opts: RecurringQaSmokeOptions,
  provisionClient?: PipedriveProjectsClient,
): Promise<RecurringQaSmokeEvidence> {
  const sleep = opts.sleep ?? realSleep;
  const rest = createQaRestClient({
    apiKey: opts.apiKey,
    companyDomain: opts.companyDomain ?? null,
    fetchImpl: opts.fetchImpl,
  });
  const client =
    provisionClient ??
    createProjectsClient({
      apiKey: opts.apiKey,
      companyDomain: opts.companyDomain ?? null,
      fetchImpl: opts.fetchImpl,
    });

  const cycleStart = opts.cycleStart ?? firstOfCurrentMonthUTC();
  // The account's org NAME carries the marker, so the deterministic project title carries
  // it too and the delete guard keys off it.
  const account: RecurringClient = {
    orgName: `${QA_TEST_MARKER} Recurring — ${opts.runTag}`,
    orgId: null,
    personId: null,
  };
  const projectTitle = recurringCycleTitle(account, cycleStart);
  let orgId = 0;
  let personId = 0;
  // Shared by reference: embedded in `evidence.cleanup` and mutated in `finally`.
  const cleanup: RecurringQaSmokeEvidence["cleanup"] = {
    projectDeleted: false,
    residualTestProjectRemains: false,
    lateReprovisionsDeleted: 0,
  };
  let evidence: RecurringQaSmokeEvidence | null = null;

  try {
    // 0) Create a throwaway org + person so the recurring project sends the v2
    //    `org_ids`/`person_ids` ARRAY body (the exact write path PSG-599 flagged).
    const org = await rest.createOrganization(`${QA_TEST_MARKER} Org — ${opts.runTag}`);
    orgId = org.id;
    const person = await rest.createPerson(
      `${QA_TEST_MARKER} Person — ${opts.runTag}`,
      orgId,
    );
    personId = person.id;
    account.orgId = orgId;
    account.personId = personId;

    // 1) Provision the monthly board through the REAL write path.
    const prov = await provisionRecurringServiceBoard({
      client,
      account,
      cycleStart,
      boardId: opts.boardId,
      phaseId: opts.phaseId,
    });

    // 2) Read back the project + task tree.
    const project = await rest.getProject(prov.projectId);
    const tasks = await rest.listProjectTasks(prov.projectId);
    const parents = tasks.filter((t) => t.parent_task_id == null);
    const leaves = tasks.filter((t) => t.parent_task_id != null);
    const gates = tasks.filter((t) => t.title.toUpperCase().includes("GATE"));

    // 3) Idempotency: re-provision → must be a no-op on the same project id.
    const again = await provisionRecurringServiceBoard({
      client,
      account,
      cycleStart,
      boardId: opts.boardId,
      phaseId: opts.phaseId,
    });
    const page = await rest.listProjectsPage(500);

    evidence = {
      ok: true,
      cycleStart,
      account: { orgName: account.orgName, orgId, personId },
      project: {
        id: project.id,
        title: project.title,
        board_id: project.board_id,
        phase_id: project.phase_id,
        start_date: project.start_date,
      },
      tree: {
        totalTasks: tasks.length,
        parentTasks: parents.length,
        leafTasks: leaves.length,
        gateTasks: gates.length,
        gateTitles: gates.map((t) => t.title),
        parentTitles: parents.map((t) => t.title),
      },
      idempotency: {
        skippedExisting: again.skippedExisting,
        projectIdMatches: again.projectId === prov.projectId,
        projectsListHasMore: page.hasMore,
      },
      cleanup,
      checks: {},
      allChecksPass: false,
    };

    // Assemble pass/fail checks (soft — reported, never throws).
    const c = evidence.checks;
    c.projectTitleMatches = project.title === projectTitle;
    c.boardMatches = project.board_id === opts.boardId;
    c.phaseMatches = project.phase_id === opts.phaseId;
    c.startDateIsCycleStart = project.start_date === cycleStart;
    c.threeGroupParents = parents.length === WHM_RECURRING_SERVICE_TEMPLATE.length;
    c.eightLeafTasks = leaves.length === recurringTaskCount(); // canonical 8 (PSG-610 §2a)
    c.totalIsEleven =
      tasks.length === WHM_RECURRING_SERVICE_TEMPLATE.length + recurringTaskCount();
    // PSG-642 realigned the template to the canonical 8-task shape → NO gate task.
    c.noGateTasks = gates.length === 0;
    c.idempotentNoSecondProject =
      again.skippedExisting && again.projectId === prov.projectId;
    evidence.allChecksPass = Object.values(c).every(Boolean);

    return evidence;
  } finally {
    // 4) Cleanup — always. Bounded re-scan absorbs anything that could re-create the board.
    //    Deletes are marker-guarded and matched on the deterministic title only.
    if (projectTitle) {
      for (let attempt = 0; attempt < 4; attempt++) {
        let found: QaProject | null = null;
        try {
          const page = await rest.listProjectsPage(500);
          found = page.items.find((p) => p.title === projectTitle) ?? null;
        } catch {
          found = null;
        }
        if (!found) break;
        try {
          assertDeletable("project", found.id, found.title);
          await rest.deleteProject(found.id);
          if (attempt === 0) cleanup.projectDeleted = true;
          else cleanup.lateReprovisionsDeleted += 1;
        } catch {
          // fall through; residual reported below
        }
        await sleep(1500);
      }
    }
    // Delete the throwaway person + org (best-effort; ids are ones we created this run).
    if (personId) {
      try {
        await rest.deletePerson(personId);
      } catch {
        /* best-effort */
      }
    }
    if (orgId) {
      try {
        await rest.deleteOrganization(orgId);
      } catch {
        /* best-effort */
      }
    }
    try {
      const page = await rest.listProjectsPage(500);
      cleanup.residualTestProjectRemains = projectTitle
        ? page.items.some((p) => p.title === projectTitle)
        : false;
    } catch {
      cleanup.residualTestProjectRemains = false;
    }
  }
}
