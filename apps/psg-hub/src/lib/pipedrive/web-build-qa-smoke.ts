import "server-only";

// PSG-673 / PSG-668 — live write-path QA smoke for the SHARED PROVISIONING ENGINE on the
// New Website Build path (create → win → provision-VIA-SELECTOR → verify → idempotency →
// cleanup), run entirely server-side.
//
// Why this exists (separate from `qa-smoke.ts`): the Move-1 onboarding smoke proves the
// live write path builds the ONBOARDING board (`provisionOnboardingBoard` direct). It does
// NOT exercise the PSG-668 template SELECTOR — the new code a won website-build deal now
// runs through in production (`provisionForDeal` → `selectTemplate` → New Website Build
// graph, wired into `/api/webhooks/pipedrive`). This module fires exactly that path against
// LIVE Pipedrive and returns structured evidence proving the RIGHT board (4 phases / 22
// tasks, UX+QA owners resolved to real users, day-offsets, project→deal link) is built —
// the same evidence bar as PSG-585, for the selector this time.
//
// It reuses the onboarding smoke's low-level REST client (`createQaRestClient`) verbatim
// (deal create/win/delete, project/task read, project delete) and the same load-bearing
// safety guard: every artifact carries `QA_TEST_MARKER` in its title and NOTHING without
// that marker is ever deleted. Cleanup runs in `finally` with the same bounded re-scan.
//
// Product source: the selector maps a deal by its line items. The QA REST client cannot
// attach a catalog product to a deal (that path is not needed by the webhook), so the
// smoke INJECTS the web-build line item (anchor SKU `PSG_P_026`, PSG-521) via
// `provisionForDeal({ products })`. The live `listDealProducts` READ is a single v1 GET
// covered by unit tests + guarded by the conservative onboarding fallback; injecting the
// product here isolates the thing under test — that a web-build line item routes to the
// web-build board on the live write path.
//
// Secret hygiene: mirrors qa-smoke.ts — the token rides only in the query string; thrown
// errors carry PATH + status only. runtime constraints are the route's (nodejs, 60s).

import {
  createProjectsClient,
  deliveryProjectTitle,
  type PipedriveProjectsClient,
  type WonDeal,
  type DealProduct,
} from "./projects";
import type { OnboardingRole } from "./onboarding-template";
import { dueDateFor } from "./onboarding-template";
import { NEW_WEBSITE_BUILD_TEMPLATE } from "./web-build-template";
import {
  provisionForDeal,
  WEB_BUILD_TEMPLATE_DEF,
} from "./template-registry";
import {
  QA_TEST_MARKER,
  createQaRestClient,
  isQaTestTitle,
  type QaFetch,
  type QaProject,
  type QaRestClient,
} from "./qa-smoke";

/** The web-build line item we inject so the selector maps the deal to New Website Build. */
export const WEB_BUILD_TEST_PRODUCT: DealProduct = {
  sku: "PSG_P_026",
  name: "Website Design & Build",
  productId: null,
};

/** Parse an env var to a finite int id (mirror template-registry's envInt). */
function envInt(env: Record<string, string | undefined>, name: string): number | null {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

export interface WebBuildQaSmokeOptions {
  /** Onboarding board/phase — the fallback board the web-build template reuses when its
   *  own `PIPEDRIVE_WEBBUILD_BOARD_ID`/`_PHASE_ID` env vars are unset (PSG-668 design). */
  defaultBoardId: number;
  defaultPhaseId: number;
  salesPipelineId: number;
  companyDomain?: string | null;
  fetchImpl?: QaFetch;
  /** Test seam: override the token so tests need no env. Route omits it (uses env token). */
  apiKey?: string;
  /** Test seam: sleep implementation (default real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** Unique tag so concurrent/repeat runs never collide on a title. */
  runTag: string;
  /** Role→user map (defaults to the route's env-loaded map, i.e. prod config). */
  roleUserMap?: Partial<Record<OnboardingRole, number>>;
  /** Env source (injectable for tests). Defaults to process.env — resolves the WEBBUILD
   *  board/phase override, exactly as the live webhook does. */
  env?: Record<string, string | undefined>;
}

export interface WebBuildAssigneeCheck {
  role: OnboardingRole;
  sampleTaskTitle: string | null;
  expectedUserId: number | null;
  actualAssigneeId: number | null;
  // PSG-680: raw v2 `assignee_ids` array read back off the live task (Pipedrive reflects
  // the assignee here after a create with `assignee_id`). Surfaced as proof.
  actualAssigneeIds: number[];
  ok: boolean;
}

export interface WebBuildQaSmokeEvidence {
  ok: boolean;
  dealId: number;
  wonDate: string | null;
  /** What the selector chose — the crux of this smoke. */
  selection: {
    templateId: string;
    templateFamily: string;
    matchedTemplate: boolean;
  };
  project: {
    id: number;
    title: string;
    board_id: number | null;
    phase_id: number | null;
    start_date: string | null;
    org_ids: number[];
    person_ids: number[];
  };
  /** Board/phase we expected the template to resolve to (env override or onboarding fallback). */
  expectedBoardId: number;
  expectedPhaseId: number;
  linkedOrgId: number | null;
  linkedPersonId: number | null;
  tree: {
    totalTasks: number;
    parentTasks: number;
    leafTasks: number;
    gateTasks: number;
    /** Leaf count per phase parent, in P1..P4 order. */
    leavesPerPhase: number[];
    parentTitles: string[];
    gateTitles: string[];
  };
  /** UX + QA (PSG-668 roles) owner→assignee resolution, read off the live board. */
  assigneeChecks: WebBuildAssigneeCheck[];
  dueDateSpotChecks: {
    kickoffD2: { title: string | null; due: string | null; expected: string; ok: boolean };
    finalGateD63: { title: string | null; due: string | null; expected: string; ok: boolean };
  };
  idempotency: {
    skippedExisting: boolean;
    projectIdMatches: boolean;
    projectsListHasMore: boolean;
  };
  cleanup: {
    projectDeleted: boolean;
    dealDeleted: boolean;
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
    throw new Error(
      `Refusing to delete ${kind} ${id}: title does not carry the QA test marker`,
    );
  }
}

/** The role a leaf task is owned by, read out of its "Owner: <label> (<ROLE>)" description. */
function roleFromDescription(description: string | null): OnboardingRole | null {
  if (!description) return null;
  const m = description.match(/\(([A-Za-z]+)\)/);
  const code = m?.[1];
  const known: readonly OnboardingRole[] = [
    "AS",
    "Ads",
    "Analytics",
    "Web",
    "CRO",
    "UX",
    "QA",
  ];
  return (known.find((r) => r === code) as OnboardingRole | undefined) ?? null;
}

/**
 * Run the full New Website Build write-path smoke (via the real selector) and return
 * evidence. `provisionClient` defaults to the REAL `createProjectsClient` so the live v2
 * write path is genuinely exercised; tests inject a fake. Cleanup always runs.
 */
export async function runWebBuildQaSmoke(
  opts: WebBuildQaSmokeOptions,
  provisionClient?: PipedriveProjectsClient,
): Promise<WebBuildQaSmokeEvidence> {
  const sleep = opts.sleep ?? realSleep;
  const env = opts.env ?? process.env;
  const roleUserMap = opts.roleUserMap ?? {};
  const rest: QaRestClient = createQaRestClient({
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

  const dealTitle = `${QA_TEST_MARKER} — WebBuild E2E ${opts.runTag}`;
  let dealId = 0;
  let orgId = 0;
  let personId = 0;
  let projectTitle = "";
  const cleanup: WebBuildQaSmokeEvidence["cleanup"] = {
    projectDeleted: false,
    dealDeleted: false,
    residualTestProjectRemains: false,
    lateReprovisionsDeleted: 0,
  };
  let evidence: WebBuildQaSmokeEvidence | null = null;

  // Board/phase the web-build template SHOULD resolve to: its own env override, else the
  // onboarding fallback (identical resolution to provisionForDeal).
  const expectedBoardId =
    envInt(env, WEB_BUILD_TEMPLATE_DEF.boardIdEnv) ?? opts.defaultBoardId;
  const expectedPhaseId =
    envInt(env, WEB_BUILD_TEMPLATE_DEF.phaseIdEnv) ?? opts.defaultPhaseId;

  try {
    // 0) throwaway org + person → the won deal carries them (exercises org_ids/person_ids).
    const org = await rest.createOrganization(`${QA_TEST_MARKER} Org — ${opts.runTag}`);
    orgId = org.id;
    const person = await rest.createPerson(`${QA_TEST_MARKER} Person — ${opts.runTag}`, orgId);
    personId = person.id;

    // 1) create + 2) win a real deal in the sales pipeline, linked to org + person.
    const created = await rest.createDeal(dealTitle, opts.salesPipelineId, {
      orgId,
      personId,
    });
    dealId = created.id;
    await rest.winDeal(dealId);
    const won = await rest.getDeal(dealId);
    const wonDate = won.wonDate ?? new Date().toISOString().slice(0, 10);

    const deal: WonDeal = {
      id: dealId,
      title: won.title || dealTitle,
      // orgName null ⇒ project title keeps the QA marker (delete guard keys off it).
      orgName: null,
      orgId: won.orgId,
      personId: won.personId,
      pipelineId: won.pipelineId,
      wonDate,
    };
    // The title the selector's `provisionForDeal` will build (New Website Build prefix).
    projectTitle = deliveryProjectTitle(WEB_BUILD_TEMPLATE_DEF.titlePrefix, deal);

    // 3) Provision THROUGH THE REAL SELECTOR with an injected web-build line item.
    // The smoke sells exactly ONE delivery template, so the multi-project summary
    // (PSG-678) carries exactly one project — unwrap it for the read-back checks below.
    const provSummary = await provisionForDeal({
      client,
      deal,
      defaultBoardId: opts.defaultBoardId,
      defaultPhaseId: opts.defaultPhaseId,
      roleUserMap,
      products: [WEB_BUILD_TEST_PRODUCT],
      env,
    });
    const prov = provSummary.projects[0]!;

    // 4) Read back the project + task tree.
    const project = await rest.getProject(prov.projectId);
    const tasks = await rest.listProjectTasks(prov.projectId);
    const parents = tasks.filter((t) => t.parent_task_id == null);
    const leaves = tasks.filter((t) => t.parent_task_id != null);
    const gates = tasks.filter((t) => t.title.toUpperCase().includes("GATE"));

    // Leaf count per phase parent, in P1..P4 order (parent titles start "P1 —" … "P4 —").
    const orderedParents = [...parents].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
    const leavesPerPhase = orderedParents.map(
      (p) => leaves.filter((l) => l.parent_task_id === p.id).length,
    );

    // Owner→assignee spot-checks for the PSG-668 roles UX + QA (and Web as a control).
    const rolesToCheck: OnboardingRole[] = ["UX", "QA", "Web"];
    const assigneeChecks: WebBuildAssigneeCheck[] = rolesToCheck.map((role) => {
      const leaf = leaves.find((l) => roleFromDescription(l.description) === role);
      const expectedUserId = roleUserMap[role] ?? null;
      const actualIds = leaf?.assignee_ids ?? [];
      // Pipedrive v2 reflects the assignee under `assignee_ids` (array); `assignee_id`
      // (singular) may be absent on the GET even though the create set it. Treat the user
      // as assigned if present in EITHER field.
      const actual = leaf?.assignee_id ?? (actualIds.length > 0 ? actualIds[0] : null);
      const isAssignedToExpected =
        expectedUserId != null &&
        (actual === expectedUserId || actualIds.includes(expectedUserId));
      // ok = resolves to the mapped user when mapped; stays unassigned when unmapped.
      const ok =
        expectedUserId != null
          ? isAssignedToExpected
          : actual == null && actualIds.length === 0;
      return {
        role,
        sampleTaskTitle: leaf?.title ?? null,
        expectedUserId,
        actualAssigneeId: actual,
        actualAssigneeIds: actualIds,
        ok,
      };
    });

    // Day-offset spot checks against the transcribed template (offsets 2 … 63).
    const kickoff = leaves.find((t) =>
      t.title.toLowerCase().includes("kick-off call"),
    );
    const finalGate = leaves.find((t) =>
      t.title.toLowerCase().includes("post-launch qa"),
    );
    const kickoffExpected = dueDateFor(wonDate, 2);
    const finalGateExpected = dueDateFor(wonDate, 63);

    // 5) Idempotency: re-provision through the selector → must be a no-op on the same id.
    const againSummary = await provisionForDeal({
      client,
      deal,
      defaultBoardId: opts.defaultBoardId,
      defaultPhaseId: opts.defaultPhaseId,
      roleUserMap,
      products: [WEB_BUILD_TEST_PRODUCT],
      env,
    });
    const again = againSummary.projects[0]!;
    const page = await rest.listProjectsPage(500);

    evidence = {
      ok: true,
      dealId,
      wonDate,
      selection: {
        templateId: prov.templateId,
        templateFamily: prov.templateFamily,
        matchedTemplate: prov.matchedTemplate,
      },
      project: {
        id: project.id,
        title: project.title,
        board_id: project.board_id,
        phase_id: project.phase_id,
        start_date: project.start_date,
        org_ids: project.org_ids,
        person_ids: project.person_ids,
      },
      expectedBoardId,
      expectedPhaseId,
      linkedOrgId: won.orgId,
      linkedPersonId: won.personId,
      tree: {
        totalTasks: tasks.length,
        parentTasks: parents.length,
        leafTasks: leaves.length,
        gateTasks: gates.length,
        leavesPerPhase,
        parentTitles: orderedParents.map((t) => t.title),
        gateTitles: gates.map((t) => t.title),
      },
      assigneeChecks,
      dueDateSpotChecks: {
        kickoffD2: {
          title: kickoff?.title ?? null,
          due: kickoff?.due_date ?? null,
          expected: kickoffExpected,
          ok: kickoff?.due_date === kickoffExpected,
        },
        finalGateD63: {
          title: finalGate?.title ?? null,
          due: finalGate?.due_date ?? null,
          expected: finalGateExpected,
          ok: finalGate?.due_date === finalGateExpected,
        },
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
    // Selector routed the web-build line item to the web-build template (the crux).
    c.selectedWebBuildTemplate =
      prov.templateId === WEB_BUILD_TEMPLATE_DEF.id && prov.matchedTemplate === true;
    c.projectTitleMatches = project.title === projectTitle;
    c.projectTitleHasWebBuildPrefix = project.title.startsWith(
      WEB_BUILD_TEMPLATE_DEF.titlePrefix,
    );
    c.boardResolvesToExpected = project.board_id === expectedBoardId;
    c.phaseResolvesToExpected = project.phase_id === expectedPhaseId;
    c.startDateIsWonDate = project.start_date === wonDate;
    // Structure: 4 phases → 4 parents, 22 leaves (6+5+6+5), 4 gates. Leaf count is derived
    // from the transcribed template, not a magic literal.
    const templateLeafCount = NEW_WEBSITE_BUILD_TEMPLATE.reduce(
      (s, p) => s + p.tasks.length,
      0,
    );
    c.fourPhaseParents = parents.length === 4;
    c.twentyTwoLeafTasks = leaves.length === templateLeafCount;
    c.leavesPerPhaseMatch =
      leavesPerPhase.length === 4 &&
      leavesPerPhase[0] === 6 &&
      leavesPerPhase[1] === 5 &&
      leavesPerPhase[2] === 6 &&
      leavesPerPhase[3] === 5;
    c.totalIsTwentySix = tasks.length === 4 + templateLeafCount;
    c.fourGates = gates.length === 4;
    c.templateHasFourPhases = NEW_WEBSITE_BUILD_TEMPLATE.length === 4;
    // Owner→assignee: every checked role resolves as expected (mapped→user, else unassigned).
    c.uxAssigneeResolves = assigneeChecks.find((a) => a.role === "UX")?.ok === true;
    c.qaAssigneeResolves = assigneeChecks.find((a) => a.role === "QA")?.ok === true;
    c.webAssigneeResolves = assigneeChecks.find((a) => a.role === "Web")?.ok === true;
    // Day-offsets landed.
    c.kickoffD2Due = evidence.dueDateSpotChecks.kickoffD2.ok;
    c.finalGateD63Due = evidence.dueDateSpotChecks.finalGateD63.ok;
    // Idempotency: re-fire is a no-op on the same project.
    c.idempotentNoSecondProject =
      again.skippedExisting && again.projectId === prov.projectId;
    // Project→deal + org/person link round-trip.
    c.projectOrgIdsPopulated = won.orgId != null && project.org_ids.includes(won.orgId);
    c.projectPersonIdsPopulated =
      won.personId != null && project.person_ids.includes(won.personId);
    evidence.allChecksPass = Object.values(c).every(Boolean);

    return evidence;
  } finally {
    // 6) Cleanup — always. Marker-guarded deletes + bounded re-scan for a late webhook
    //    re-provision. Identical discipline to qa-smoke.ts.
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
    if (dealId) {
      try {
        const d = await rest.getDeal(dealId);
        assertDeletable("deal", dealId, d.title || dealTitle);
        await rest.deleteDeal(dealId);
        cleanup.dealDeleted = true;
      } catch {
        cleanup.dealDeleted = false;
      }
    }
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
