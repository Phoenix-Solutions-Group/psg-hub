import { beforeEach, describe, expect, it, vi } from "vitest";

const createProjectsClient = vi.fn();
const createPipedriveClient = vi.fn();
const resolvePipedriveToken = vi.fn();
const isDealWonTransition = vi.fn();
const isDealPipelineInScope = vi.fn();
const dealPipelineId = vi.fn();
const provisionForDeal = vi.fn();
const enrollNurturePath = vi.fn();
const createServiceClient = vi.fn();
const updateDeal = vi.fn();
const listDealProducts = vi.fn();
const listUserConnections = vi.fn();
const listMailboxThreads = vi.fn();
const listDealActivities = vi.fn();
const createActivity = vi.fn();
const deleteActivity = vi.fn();
const fetchPersonContact = vi.fn();
const fetchOrganizationBillingDetails = vi.fn();

vi.mock("@/lib/pipedrive/projects", () => ({
  createProjectsClient: (...args: unknown[]) => createProjectsClient(...args),
  resolvePipedriveToken: (...args: unknown[]) => resolvePipedriveToken(...args),
  isDealWonTransition: (...args: unknown[]) => isDealWonTransition(...args),
  isDealPipelineInScope: (...args: unknown[]) => isDealPipelineInScope(...args),
  dealPipelineId: (...args: unknown[]) => dealPipelineId(...args),
}));
vi.mock("@/lib/pipedrive/client", () => ({
  createPipedriveClient: (...args: unknown[]) => createPipedriveClient(...args),
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
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.stubEnv("PIPEDRIVE_WEBHOOK_USER", "webhook-user");
  vi.stubEnv("PIPEDRIVE_WEBHOOK_PASS", "webhook-pass");
  vi.stubEnv("PIPEDRIVE_API_TOKEN", "token");
  vi.stubEnv("PIPEDRIVE_ONBOARDING_BOARD_ID", "123");
  vi.stubEnv("PIPEDRIVE_ONBOARDING_PHASE_ID", "456");
  vi.stubEnv("PIPEDRIVE_SALES_PIPELINE_ID", "8");
  vi.stubEnv("PIPEDRIVE_COMPANY_DOMAIN", "psg");
  vi.stubEnv("PIPEDRIVE_PANDADOC_SIGNED_URL_FIELD_KEY", "");
  vi.stubEnv("PIPEDRIVE_PROPOSAL_PREP_BUSINESS_DAY_OFFSET", "1");

  createProjectsClient.mockReturnValue({
    projectsClient: true,
    updateDeal,
    listDealProducts,
    listUserConnections,
    listMailboxThreads,
    listDealActivities,
    createActivity,
    deleteActivity,
  });
  createPipedriveClient.mockReturnValue({
    contactClient: true,
    fetchPersonContact,
    fetchOrganizationBillingDetails,
  });
  createServiceClient.mockReturnValue({ serviceClient: true });
  resolvePipedriveToken.mockReturnValue("token");
  isDealWonTransition.mockReturnValue(true);
  isDealPipelineInScope.mockReturnValue(true);
  dealPipelineId.mockReturnValue(8);
  provisionForDeal.mockResolvedValue({ provisionedProjects: 1, reusedProjects: 0 });
  enrollNurturePath.mockResolvedValue({ path: "onboarding_retention" });
  listUserConnections.mockResolvedValue({ google: "nick@phoenixsolutionsgroup.net" });
  listMailboxThreads.mockResolvedValue([{ id: 1 }]);
  listDealActivities.mockResolvedValue([]);
  createActivity.mockResolvedValue({ id: 9001 });
  deleteActivity.mockResolvedValue(undefined);
  fetchPersonContact.mockResolvedValue({ firstName: "Pat", email: "pat@example.com", phone: null });
  fetchOrganizationBillingDetails.mockResolvedValue({
    id: 9,
    name: "Wallace Collision",
    displayName: "Wallace Collision LLC",
    address: "123 Main St, Phoenix, AZ 85001",
    generalEmail: "billing@wallace.example",
    paymentTerms: "Net 15",
  });
  listDealProducts.mockResolvedValue([
    {
      name: "Website Design & Build",
      sku: "PSG_P_026",
      productId: 26,
      quantity: 1,
      sum: 6500,
      billingFrequency: "one-time",
    },
  ]);
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
      contactValidation: "skipped",
      firstContactStamp: "skipped",
      billingAutofill: "filled",
      wonGateAutofill: "filled",
    });
    expect(fetchOrganizationBillingDetails).toHaveBeenCalledWith(9);
    expect(updateDeal).toHaveBeenCalledWith(42, {
      eaecf6080f4dc77a8533315844a8cc8663312aa2: "Wallace Collision LLC",
      "5d5c27acc52d0ed92af361bc4dc0a87801477f4b": "123 Main St, Phoenix, AZ 85001",
      c0a76c955f288460d1d472141df2574ac24a1d8d: "billing@wallace.example",
      "5461d82fd372f1e65195ac3689e3ac9bfdb7e1e9": "NET 15 (standard)",
      d318a4cf86fc9a9fae395cd7a4e8785862ded54c: "Pat Owner",
    });
    expect(listDealProducts).toHaveBeenCalledWith(42);
    expect(updateDeal).toHaveBeenCalledWith(42, {
      c454180428b8e3ee69d817c44f825eacd489eeb3:
        "Website Design & Build (SKU PSG_P_026)",
      "4047a088118caa2c0b353c000d33c5ac35ea2ed9": 6500,
    });
    expect(provisionForDeal).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.objectContaining({ projectsClient: true }),
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
        pipedriveClient: expect.objectContaining({ contactClient: true }),
      })
    );
  });

  it("stamps First Contact Date when a sales deal first reaches Discovery", async () => {
    vi.stubEnv("PIPEDRIVE_ONBOARDING_BOARD_ID", "");
    vi.stubEnv("PIPEDRIVE_ONBOARDING_PHASE_ID", "");
    isDealWonTransition.mockReturnValue(false);
    updateDeal.mockResolvedValue({ id: 42 });

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { status: "open", stage_id: 56 },
          current: {
            id: 42,
            title: "Wallace discovery",
            status: "open",
            pipeline_id: 8,
            stage_id: 57,
            update_time: "2026-07-15 14:22:00",
            first_contact_date: "",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      skipped: "not_won_transition",
      contactValidation: "skipped",
      firstContactStamp: "stamped",
      billingAutofill: "skipped",
      wonGateAutofill: "skipped",
    });
    expect(updateDeal).toHaveBeenCalledWith(42, {
      first_contact_date: "2026-07-15",
    });
    expect(provisionForDeal).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing First Contact Date", async () => {
    isDealWonTransition.mockReturnValue(false);

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { status: "open", stage_id: 56 },
          current: {
            id: 42,
            status: "open",
            pipeline_id: 8,
            stage_id: 57,
            update_time: "2026-07-15 14:22:00",
            first_contact_date: "2026-07-14",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      skipped: "not_won_transition",
      contactValidation: "skipped",
      firstContactStamp: "skipped",
      billingAutofill: "skipped",
      wonGateAutofill: "skipped",
    });
    expect(updateDeal).not.toHaveBeenCalled();
  });

  it("flags a PSG Sales New Lead deal when the linked contact has no phone or email", async () => {
    vi.stubEnv("PIPEDRIVE_NEW_LEAD_STAGE_ID", "56");
    vi.stubEnv("PIPEDRIVE_QUALIFIED_STAGE_ID", "58");
    isDealWonTransition.mockReturnValue(false);
    fetchPersonContact.mockResolvedValue({ firstName: "Pat", email: null, phone: null });

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: null,
          current: {
            id: 42,
            title: "Pat's Collision",
            status: "open",
            pipeline_id: 8,
            stage_id: 56,
            person_id: { value: 7, name: "Pat Owner" },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      skipped: "not_won_transition",
      contactValidation: "flagged_missing_contact",
      firstContactStamp: "skipped",
      billingAutofill: "skipped",
      wonGateAutofill: "skipped",
    });
    expect(fetchPersonContact).toHaveBeenCalledWith(7);
    expect(updateDeal).toHaveBeenCalledWith(42, {
      title: "[NEEDS CONTACT] Pat's Collision",
    });
    expect(provisionForDeal).not.toHaveBeenCalled();
  });

  it("clears the New Lead contact flag after the linked contact gains phone or email", async () => {
    isDealWonTransition.mockReturnValue(false);
    fetchPersonContact.mockResolvedValue({ firstName: "Pat", email: null, phone: "(555) 010-9900" });

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { stage_id: 56 },
          current: {
            id: 42,
            title: "[NEEDS CONTACT] Pat's Collision",
            status: "open",
            pipeline_id: 8,
            stage_id: 56,
            person_id: { value: 7, name: "Pat Owner" },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      skipped: "not_won_transition",
      contactValidation: "valid_cleared_flag",
      firstContactStamp: "skipped",
      billingAutofill: "skipped",
      wonGateAutofill: "skipped",
    });
    expect(fetchPersonContact).toHaveBeenCalledWith(7);
    expect(updateDeal).toHaveBeenCalledWith(42, {
      title: "Pat's Collision",
    });
  });

  it("creates one busy 45-minute proposal prep block when a sales deal reaches Qualified", async () => {
    vi.stubEnv("PIPEDRIVE_NEW_LEAD_STAGE_ID", "55");
    vi.stubEnv("PIPEDRIVE_QUALIFIED_STAGE_ID", "56");
    isDealWonTransition.mockReturnValue(false);
    createActivity.mockResolvedValueOnce({ id: 901 });

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { stage_id: 57 },
          current: {
            id: 42,
            title: "Wallace website proposal",
            status: "open",
            pipeline_id: 8,
            stage_id: 56,
            org_id: { value: 9, name: "Wallace Collision" },
            person_id: { value: 7, name: "Pat Owner" },
            value: 6500,
            currency: "USD",
            update_time: "2026-07-17 14:22:00",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        ok: true,
        skipped: "not_won_transition",
        proposalPrepBlock: { status: "created", activityIds: [901] },
      }),
    );
    expect(listUserConnections).toHaveBeenCalled();
    expect(listMailboxThreads).toHaveBeenCalledWith("drafts", 1);
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Proposal prep: Wallace website proposal",
        type: "meeting",
        deal_id: 42,
        person_id: 7,
        org_id: 9,
        due_date: "2026-07-20",
        due_time: "09:00",
        duration: "00:45",
        busy: true,
        done: false,
      }),
    );
  });

  it("reuses an existing proposal prep block on webhook replay", async () => {
    vi.stubEnv("PIPEDRIVE_NEW_LEAD_STAGE_ID", "55");
    vi.stubEnv("PIPEDRIVE_QUALIFIED_STAGE_ID", "56");
    isDealWonTransition.mockReturnValue(false);
    listDealActivities.mockResolvedValueOnce([
      {
        id: 777,
        subject: "Proposal prep: Wallace website proposal",
        type: "meeting",
        dueDate: "2026-07-20",
        done: false,
      },
    ]);

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { stage_id: 57 },
          current: {
            id: 42,
            title: "Wallace website proposal",
            status: "open",
            pipeline_id: 8,
            stage_id: 56,
            update_time: "2026-07-17 14:22:00",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        proposalPrepBlock: { status: "reused", activityIds: [777] },
      }),
    );
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("creates five non-sending follow-up draft tasks when a sales deal reaches Proposal Sent", async () => {
    isDealWonTransition.mockReturnValue(false);
    createActivity.mockImplementation(async () => ({ id: 9000 + createActivity.mock.calls.length }));

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { stage_id: 56 },
          current: {
            id: 42,
            title: "Wallace website proposal",
            status: "open",
            pipeline_id: 8,
            stage_id: 59,
            org_id: { value: 9, name: "Wallace Collision" },
            person_id: { value: 7, name: "Pat Owner" },
            update_time: "2026-07-17 14:22:00",
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        proposalDraftSeries: {
          status: "created",
          activityIds: [9001, 9002, 9003, 9004, 9005],
        },
      }),
    );
    expect(createActivity).toHaveBeenCalledTimes(5);
    expect(createActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        subject: "Proposal follow-up draft Touch 1: Wallace website proposal",
        type: "email",
        due_date: "2026-07-21",
        done: false,
        note: expect.stringContaining("Draft only. Do not auto-send."),
      }),
    );
  });

  it("deletes open proposal follow-up draft tasks when the deal is lost", async () => {
    isDealWonTransition.mockReturnValue(false);
    listDealActivities.mockResolvedValueOnce([
      {
        id: 801,
        subject: "Proposal follow-up draft Touch 1: Wallace website proposal",
        type: "email",
        dueDate: "2026-07-21",
        done: false,
      },
      {
        id: 802,
        subject: "Proposal follow-up draft Touch 2: Wallace website proposal",
        type: "email",
        dueDate: "2026-07-24",
        done: false,
      },
    ]);

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { status: "open", stage_id: 59 },
          current: {
            id: 42,
            title: "Wallace website proposal",
            status: "lost",
            pipeline_id: 8,
            stage_id: 59,
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        proposalDraftSeries: { status: "stopped", stoppedActivityIds: [801, 802] },
      }),
    );
    expect(deleteActivity).toHaveBeenCalledWith(801);
    expect(deleteActivity).toHaveBeenCalledWith(802);
  });

  it("deletes open proposal follow-up draft tasks when the deal leaves Proposal Sent", async () => {
    isDealWonTransition.mockReturnValue(false);
    listDealActivities.mockResolvedValueOnce([
      {
        id: 803,
        subject: "Proposal follow-up draft Touch 3: Wallace website proposal",
        type: "email",
        dueDate: "2026-07-30",
        done: false,
      },
    ]);

    const res = await POST(
      new Request("https://hub.psgweb.me/api/webhooks/pipedrive", {
        method: "POST",
        headers: {
          authorization: authHeader(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          previous: { status: "open", stage_id: 59 },
          current: {
            id: 42,
            title: "Wallace website proposal",
            status: "open",
            pipeline_id: 8,
            stage_id: 58,
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        proposalDraftSeries: { status: "stopped", stoppedActivityIds: [803] },
      }),
    );
    expect(deleteActivity).toHaveBeenCalledWith(803);
  });
});
