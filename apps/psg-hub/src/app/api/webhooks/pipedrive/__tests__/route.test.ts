import { beforeEach, describe, expect, it, vi } from "vitest";

const createProjectsClient = vi.fn();
const resolvePipedriveToken = vi.fn();
const isDealWonTransition = vi.fn();
const isDealPipelineInScope = vi.fn();
const dealPipelineId = vi.fn();
const provisionForDeal = vi.fn();
const enrollNurturePath = vi.fn();
const createServiceClient = vi.fn();

vi.mock("@/lib/pipedrive/projects", () => ({
  createProjectsClient: (...args: unknown[]) => createProjectsClient(...args),
  resolvePipedriveToken: (...args: unknown[]) => resolvePipedriveToken(...args),
  isDealWonTransition: (...args: unknown[]) => isDealWonTransition(...args),
  isDealPipelineInScope: (...args: unknown[]) => isDealPipelineInScope(...args),
  dealPipelineId: (...args: unknown[]) => dealPipelineId(...args),
}));
vi.mock("@/lib/pipedrive/template-registry", () => ({
  provisionForDeal: (...args: unknown[]) => provisionForDeal(...args),
}));
vi.mock("@/lib/pipedrive/role-user-map", () => ({
  loadRoleUserMap: () => ({ strategist: 101 }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: (...args: unknown[]) => createServiceClient(...args),
}));
vi.mock("@/lib/nurture/enrollment", () => ({
  enrollNurturePath: (...args: unknown[]) => enrollNurturePath(...args),
}));

import { POST } from "../route";

function authHeader(): string {
  return `Basic ${Buffer.from("webhook-user:webhook-pass").toString("base64")}`;
}

function wonDealRequest(): Request {
  return new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
    method: "POST",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      previous: { status: "open" },
      current: {
        id: 42,
        title: "Wallace onboarding",
        status: "won",
        org_id: { value: 9, name: "Wallace Collision" },
        person_id: { value: 7, name: "Pat Owner" },
        pipeline_id: 8,
        won_time: "2026-07-12 10:30:00",
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PIPEDRIVE_WEBHOOK_USER", "webhook-user");
  vi.stubEnv("PIPEDRIVE_WEBHOOK_PASS", "webhook-pass");
  vi.stubEnv("PIPEDRIVE_API_TOKEN", "token");
  vi.stubEnv("PIPEDRIVE_ONBOARDING_BOARD_ID", "123");
  vi.stubEnv("PIPEDRIVE_ONBOARDING_PHASE_ID", "456");
  vi.stubEnv("PIPEDRIVE_SALES_PIPELINE_ID", "8");
  vi.stubEnv("PIPEDRIVE_COMPANY_DOMAIN", "psg");

  createProjectsClient.mockReturnValue({ projectsClient: true });
  createServiceClient.mockReturnValue({ serviceClient: true });
  resolvePipedriveToken.mockReturnValue("token");
  isDealWonTransition.mockReturnValue(true);
  isDealPipelineInScope.mockReturnValue(true);
  dealPipelineId.mockReturnValue(8);
  provisionForDeal.mockResolvedValue({ provisionedProjects: 1, reusedProjects: 0 });
  enrollNurturePath.mockResolvedValue({ path: "onboarding_retention" });
});

describe("Pipedrive won-deal webhook nurture gate", () => {
  it("keeps the onboarding board flow and enrolls won deals into Path E", async () => {
    const res = await POST(wonDealRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      provisionedProjects: 1,
      reusedProjects: 0,
      nurtureEnrollment: "enrolled",
    });
    expect(provisionForDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        client: { projectsClient: true },
        defaultBoardId: 123,
        defaultPhaseId: 456,
        roleUserMap: { strategist: 101 },
        deal: expect.objectContaining({
          id: 42,
          title: "Wallace onboarding",
          orgId: 9,
          personId: 7,
          pipelineId: 8,
          wonDate: "2026-07-12",
        }),
      })
    );
    expect(enrollNurturePath).toHaveBeenCalledWith(
      { serviceClient: true },
      expect.objectContaining({
        trigger: "deal_won",
        triggerRef: "pipedrive:deal:42:won",
        contact: {},
        pipedriveDealId: 42,
        pipedrivePersonId: 7,
        pipedriveOrgId: 9,
      })
    );
  });
});
