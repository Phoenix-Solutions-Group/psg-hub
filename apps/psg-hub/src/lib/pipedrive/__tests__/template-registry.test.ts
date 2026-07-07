import { describe, it, expect, vi } from "vitest";
import {
  selectTemplate,
  provisionForDeal,
  WEB_BUILD_TEMPLATE_DEF,
  ONBOARDING_TEMPLATE_DEF,
  ONE_TIME_TEMPLATE_REGISTRY,
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
  const createProject = vi.fn(async (_input: CreateProjectInput) => ({ id: 700 }));
  const createTask = vi.fn(async (_input: CreateTaskInput) => ({ id: nextId++ }));
  const findProjectByTitle = vi.fn(async (_title: string) => null as { id: number } | null);
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
    listDealProducts,
    ...overrides,
  };
  return { client, createProject, createTask, findProjectByTitle, listDealProducts };
}

const webBuildProduct: DealProduct = {
  name: "Website Design & Build",
  sku: "PSG_P_026",
  productId: 26,
};

describe("selectTemplate", () => {
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
    expect(
      selectTemplate(DEAL, [{ name: "Monthly SEO Retainer", sku: "PSG_P_099", productId: 99 }]),
    ).toBeNull();
  });

  it("returns null (→ onboarding) for a zero-product deal", () => {
    expect(selectTemplate(DEAL, [])).toBeNull();
  });

  it("onboarding is NOT product-matchable (it is the implicit default, not in the registry)", () => {
    expect(ONE_TIME_TEMPLATE_REGISTRY).not.toContain(ONBOARDING_TEMPLATE_DEF);
    expect(ONBOARDING_TEMPLATE_DEF.matchSkus).toEqual([]);
  });
});

describe("provisionForDeal — dispatch", () => {
  it("builds the New Website Build board when the deal sold that SKU", async () => {
    const { client, createProject, createTask } = fakeClient([webBuildProduct]);
    const res = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      env: {}, // no per-template board override → reuse onboarding board/phase
    });

    expect(res.templateId).toBe("new-website-build");
    expect(res.matchedTemplate).toBe(true);
    expect(res.created).toBe(true);
    expect(res.phaseCount).toBe(NEW_WEBSITE_BUILD_TEMPLATE.length); // 4
    expect(res.taskCount).toBe(templateTaskCount(NEW_WEBSITE_BUILD_TEMPLATE)); // 23

    // 4 phase parents + 23 leaves.
    expect(createTask).toHaveBeenCalledTimes(
      NEW_WEBSITE_BUILD_TEMPLATE.length + templateTaskCount(NEW_WEBSITE_BUILD_TEMPLATE),
    );
    // Title carries the template prefix (not "Onboarding"); board/phase fell back to default.
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Website Build — Riverside Auto Body LLC (deal 5150)",
        board_id: 3,
        phase_id: 9,
      }),
    );
  });

  it("falls back to the onboarding board for an unmapped product (no regression)", async () => {
    const { client, createProject } = fakeClient([
      { name: "Ad Management Retainer", sku: "PSG_P_050", productId: 50 },
    ]);
    const res = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
    });

    expect(res.templateId).toBe("onboarding");
    expect(res.matchedTemplate).toBe(false);
    expect(res.phaseCount).toBe(WHM_ONBOARDING_TEMPLATE.length); // 5
    expect(res.taskCount).toBe(templateTaskCount()); // 25
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
    const res = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
    });
    expect(res.templateId).toBe("onboarding");
    expect(res.matchedTemplate).toBe(false);
    expect(res.created).toBe(true);
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
    const res = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      products: [webBuildProduct],
      env: {},
    });
    expect(res.templateId).toBe("new-website-build");
    expect(listDealProducts).not.toHaveBeenCalled();
  });

  it("is idempotent: an existing project short-circuits to a no-op", async () => {
    const { client } = fakeClient([webBuildProduct], {
      findProjectByTitle: vi.fn(async () => ({ id: 999 })),
    });
    const res = await provisionForDeal({
      client,
      deal: DEAL,
      defaultBoardId: 3,
      defaultPhaseId: 9,
      env: {},
    });
    expect(res.skippedExisting).toBe(true);
    expect(res.projectId).toBe(999);
    expect(res.templateId).toBe("new-website-build");
  });
});
