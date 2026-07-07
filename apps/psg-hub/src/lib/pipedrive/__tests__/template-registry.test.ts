import { describe, it, expect, vi } from "vitest";
import {
  selectTemplate,
  selectTemplates,
  provisionForDeal,
  WEB_BUILD_TEMPLATE_DEF,
  ONBOARDING_TEMPLATE_DEF,
  ONE_TIME_TEMPLATE_REGISTRY,
  type OneTimeTemplateDef,
} from "../template-registry";
import {
  type PipedriveProjectsClient,
  type CreateProjectInput,
  type CreateTaskInput,
  type DealProduct,
  type WonDeal,
} from "../projects";
import { WHM_ONBOARDING_TEMPLATE, templateTaskCount } from "../onboarding-template";
import { NEW_WEBSITE_BUILD_TEMPLATE } from "../web-build-template";

const DEAL: WonDeal = {
  id: 5150,
  title: "Riverside Auto Body",
  orgName: "Riverside Auto Body LLC",
  orgId: 88,
  personId: 21,
  wonDate: "2026-07-06",
};

function fakeClient(
  products: DealProduct[] | Error = [],
  overrides: Partial<PipedriveProjectsClient> = {},
) {
  let nextId = 2000;
  let nextProjectId = 700;
  let nextPhaseId = 400;
  const createProject = vi.fn(async (_input: CreateProjectInput) => ({ id: nextProjectId++ }));
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const findProjectByTitle = vi.fn(async (_title: string) => null as { id: number } | null);
  const createPhase = vi.fn(async (_b: number, _name: string, _order?: number) => ({
    id: nextPhaseId++,
  }));
  const setTaskPhase = vi.fn(async (_p: number, _t: number, _phase: number) => {});
  const listDealProducts = vi.fn(async (_dealId: number) => {
    if (products instanceof Error) throw products;
    return products;
  });
  const client: PipedriveProjectsClient = {
    listBoards: vi.fn(async () => []),
    listPhases: vi.fn(async () => []),
    listUsers: vi.fn(async () => []),
    createProject,
    createTask,
    findProjectByTitle,
    createPhase,
    setTaskPhase,
    listDealProducts,
    ...overrides,
  };
  return { client, createProject, createTask, findProjectByTitle, createPhase, setTaskPhase, listDealProducts };
}

const webBuildProduct: DealProduct = {
  name: "Website Design & Build",
  sku: "PSG_P_026",
  productId: 26,
};

// A SECOND distinct delivery template, used to exercise multi-template routing without
// shipping an un-signed-off template into the live registry (PSG-678). Reuses the WHM
// onboarding phase graph so its task counts differ from Web Build for clearer assertions.
const SECOND_TEMPLATE_DEF: OneTimeTemplateDef = {
  id: "second-delivery",
  family: "Test — Second Delivery",
  titlePrefix: "Second Delivery",
  matchSkus: ["PSG_P_777"],
  matchNames: [/\bsecond delivery\b/i],
  phases: WHM_ONBOARDING_TEMPLATE,
  boardIdEnv: "PIPEDRIVE_SECOND_BOARD_ID",
  phaseIdEnv: "PIPEDRIVE_SECOND_PHASE_ID",
};
const secondProduct: DealProduct = {
  name: "Second Delivery Package",
  sku: "PSG_P_777",
  productId: 777,
};
const addOnProduct: DealProduct = {
  name: "Ad Management Retainer",
  sku: "PSG_P_050",
  productId: 50,
};
const consultingProduct: DealProduct = {
  name: "Strategy Consulting (hourly)",
  sku: "PSG_P_HRLY",
  productId: 900,
};
const TWO_TEMPLATE_REGISTRY = [WEB_BUILD_TEMPLATE_DEF, SECOND_TEMPLATE_DEF] as const;

describe("selectTemplates", () => {
  it("returns the single matched template for a one-delivery-template deal", () => {
    expect(selectTemplates(DEAL, [webBuildProduct])).toEqual([WEB_BUILD_TEMPLATE_DEF]);
  });

  it("returns BOTH distinct templates for a multi-delivery-template deal (dedupe by template)", () => {
    const got = selectTemplates(
      DEAL,
      [webBuildProduct, secondProduct],
      TWO_TEMPLATE_REGISTRY,
    );
    expect(got).toEqual([WEB_BUILD_TEMPLATE_DEF, SECOND_TEMPLATE_DEF]);
  });

  it("dedupes: two line items matching the SAME template yield ONE entry", () => {
    const got = selectTemplates(
      DEAL,
      // both map to Web Build (SKU + name variant)
      [webBuildProduct, { name: "Custom Website Build add-on", sku: null, productId: null }],
      TWO_TEMPLATE_REGISTRY,
    );
    expect(got).toEqual([WEB_BUILD_TEMPLATE_DEF]);
  });

  it("ignores add-on / consulting line items (they match no template ⇒ spawn no project)", () => {
    expect(
      selectTemplates(
        DEAL,
        [webBuildProduct, addOnProduct, consultingProduct],
        TWO_TEMPLATE_REGISTRY,
      ),
    ).toEqual([WEB_BUILD_TEMPLATE_DEF]);
  });

  it("returns [] (⇒ onboarding fallback) for add-ons / consulting only", () => {
    expect(selectTemplates(DEAL, [addOnProduct, consultingProduct])).toEqual([]);
  });

  it("returns [] for a zero-product deal", () => {
    expect(selectTemplates(DEAL, [])).toEqual([]);
  });
});

describe("selectTemplate (back-compat shim)", () => {
  it("maps a deal with the anchor SKU to New Website Build", () => {
    expect(selectTemplate(DEAL, [webBuildProduct])).toBe(WEB_BUILD_TEMPLATE_DEF);
  });

  it("matches the SKU case-insensitively (and trims)", () => {
    expect(selectTemplate(DEAL, [{ name: "x", sku: " psg_p_026 ", productId: 26 }])).toBe(
      WEB_BUILD_TEMPLATE_DEF,
    );
  });

  it("maps by product NAME when the SKU is absent", () => {
    expect(
      selectTemplate(DEAL, [{ name: "Website Design & Build", sku: null, productId: null }]),
    ).toBe(WEB_BUILD_TEMPLATE_DEF);
  });

  it("returns null (→ onboarding) for an unmapped product", () => {
    expect(selectTemplate(DEAL, [addOnProduct])).toBeNull();
  });

  it("returns null (→ onboarding) for a zero-product deal", () => {
    expect(selectTemplate(DEAL, [])).toBeNull();
  });

  it("returns the FIRST distinct match when several templates match (no longer ambiguous→null)", () => {
    const registry = TWO_TEMPLATE_REGISTRY;
    // shim reads the module registry, so build via selectTemplates to prove ordering
    expect(selectTemplates(DEAL, [secondProduct, webBuildProduct], registry)[0]).toBe(
      WEB_BUILD_TEMPLATE_DEF,
    );
  });

  it("onboarding is NOT product-matchable (it is the implicit default, not in the registry)", () => {
    expect(ONE_TIME_TEMPLATE_REGISTRY).not.toContain(ONBOARDING_TEMPLATE_DEF);
    expect(ONBOARDING_TEMPLATE_DEF.matchSkus).toEqual([]);
  });
});

describe("provisionForDeal — single template + fallback (no regression)", () => {
  it("AC-2: 1 delivery template + add-ons → exactly 1 project (web build board)", async () => {
    const { client, createProject } = fakeClient([webBuildProduct, addOnProduct]);
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      env: {}, // no per-template board override → reuse onboarding board/phase
    });

    expect(summary.projects).toHaveLength(1);
    expect(summary.templateIds).toEqual(["new-website-build"]);
    expect(summary.matchedTemplates).toBe(true);

    const prov = summary.projects[0]!;
    expect(prov.templateId).toBe("new-website-build");
    expect(prov.matchedTemplate).toBe(true);
    expect(prov.created).toBe(true);
    expect(prov.phaseCount).toBe(NEW_WEBSITE_BUILD_TEMPLATE.length); // 4
    expect(prov.taskCount).toBe(templateTaskCount(NEW_WEBSITE_BUILD_TEMPLATE)); // 23

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Website Build — Riverside Auto Body LLC (deal 5150)",
        board_id: 3,
        phase_id: 9,
      }),
    );
  });

  it("AC-3: 0 delivery-template matches → single onboarding fallback (no regression)", async () => {
    const { client, createProject } = fakeClient([addOnProduct, consultingProduct]);
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
    });

    expect(summary.projects).toHaveLength(1);
    expect(summary.templateIds).toEqual(["onboarding"]);
    expect(summary.matchedTemplates).toBe(false);

    const prov = summary.projects[0]!;
    expect(prov.templateId).toBe("onboarding");
    expect(prov.matchedTemplate).toBe(false);
    expect(prov.phaseCount).toBe(WHM_ONBOARDING_TEMPLATE.length); // 5
    expect(prov.taskCount).toBe(templateTaskCount()); // 25
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Onboarding — Riverside Auto Body LLC (deal 5150)",
        board_id: 3,
        phase_id: 9,
      }),
    );
  });

  it("falls back to onboarding when the product read THROWS (conservative fallback)", async () => {
    const { client } = fakeClient(new Error("pipedrive 500"));
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
    });
    expect(summary.projects).toHaveLength(1);
    expect(summary.projects[0]!.templateId).toBe("onboarding");
    expect(summary.matchedTemplates).toBe(false);
    expect(summary.projects[0]!.created).toBe(true);
  });

  it("honors a per-template board/phase env override for the matched template", async () => {
    const { client, createProject } = fakeClient([webBuildProduct]);
    await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      env: {
        PIPEDRIVE_WEBBUILD_BOARD_ID: "77",
        PIPEDRIVE_WEBBUILD_PHASE_ID: "88",
      },
    });
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ board_id: 77, phase_id: 88 }),
    );
  });

  it("uses injected products and does NOT call listDealProducts", async () => {
    const { client, listDealProducts } = fakeClient([]); // client would return [] if called
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      products: [webBuildProduct],
      env: {},
    });
    expect(summary.templateIds).toEqual(["new-website-build"]);
    expect(listDealProducts).not.toHaveBeenCalled();
  });
});

describe("provisionForDeal — multi-template (PSG-678)", () => {
  it("AC-1: 2 distinct delivery templates → 2 projects; add-ons spawn no extra project", async () => {
    const { client, createProject } = fakeClient();
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      // web build + second template + an add-on that maps to nothing
      products: [webBuildProduct, secondProduct, addOnProduct],
      registry: TWO_TEMPLATE_REGISTRY,
      env: {
        PIPEDRIVE_WEBBUILD_BOARD_ID: "41",
        PIPEDRIVE_WEBBUILD_PHASE_ID: "42",
        PIPEDRIVE_SECOND_BOARD_ID: "51",
        PIPEDRIVE_SECOND_PHASE_ID: "52",
      },
    });

    // Exactly two projects — one per distinct delivery template, add-on excluded.
    expect(summary.projects).toHaveLength(2);
    expect(summary.templateIds).toEqual(["new-website-build", "second-delivery"]);
    expect(summary.matchedTemplates).toBe(true);
    expect(createProject).toHaveBeenCalledTimes(2);

    // Web Build project → its own title + board/phase.
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Website Build — Riverside Auto Body LLC (deal 5150)",
        board_id: 41,
        phase_id: 42,
      }),
    );
    // Second Delivery project → its own DISTINCT title + board/phase.
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Second Delivery — Riverside Auto Body LLC (deal 5150)",
        board_id: 51,
        phase_id: 52,
      }),
    );

    // Distinct projects get distinct ids.
    expect(new Set(summary.projects.map((p) => p.projectId)).size).toBe(2);
  });

  it("AC-4: re-fired won-webhook on a multi-template deal → no duplicate projects (idempotent per project)", async () => {
    // findProjectByTitle returns an existing project for BOTH titles ⇒ both are no-ops.
    const byTitle: Record<string, { id: number }> = {
      "New Website Build — Riverside Auto Body LLC (deal 5150)": { id: 901 },
      "Second Delivery — Riverside Auto Body LLC (deal 5150)": { id: 902 },
    };
    const { client, createProject } = fakeClient(undefined, {
      findProjectByTitle: vi.fn(async (title: string) => byTitle[title] ?? null),
    });
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      products: [webBuildProduct, secondProduct],
      registry: TWO_TEMPLATE_REGISTRY,
      env: {},
    });

    expect(summary.projects).toHaveLength(2);
    expect(summary.projects.every((p) => p.skippedExisting)).toBe(true);
    expect(summary.projects.map((p) => p.projectId)).toEqual([901, 902]);
    // No new projects created on the re-fire.
    expect(createProject).not.toHaveBeenCalled();
  });

  it("is idempotent for the single-template case too (existing project short-circuits)", async () => {
    const { client } = fakeClient([webBuildProduct], {
      findProjectByTitle: vi.fn(async () => ({ id: 999 })),
    });
    const summary = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      env: {},
    });
    const prov = summary.projects[0]!;
    expect(prov.skippedExisting).toBe(true);
    expect(prov.projectId).toBe(999);
    expect(prov.templateId).toBe("new-website-build");
  });
});
