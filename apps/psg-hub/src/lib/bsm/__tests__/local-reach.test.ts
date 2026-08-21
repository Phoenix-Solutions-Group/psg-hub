import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLocalReachStats,
  buildSetupSteps,
  getLocalReachWorkspace,
  statusLabel,
  statusTone,
  type LocalReachRecommendation,
} from "@/lib/bsm/local-reach";

const BASE_RECOMMENDATION: LocalReachRecommendation = {
  id: "rec-1",
  createdAt: "2026-07-17T12:00:00.000Z",
  title: "Add hail repair FAQ",
  type: "FAQ",
  status: "ready_for_review",
  risk: "low",
  market: "Ontario, Canada",
  sourceDate: "2026-07-17",
  valueLine: "Makes hail repair questions easier to answer.",
  summary: "Add a short FAQ.",
  whyItMatters: "Drivers look for hail repair answers after a storm.",
  businessValue: "Creates a useful page section without promising ranking movement.",
  targetPage: "/hail-repair",
  draftPreview: "Can Supreme Collision repair hail damage?",
  locationSafetyNote: "Uses approved Ontario service area.",
  approvalItemId: "approval-1",
  publishedUrl: null,
  publishedAt: null,
  verificationNote: null,
  evidence: [],
};

describe("Local Reach helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses customer-safe status labels", () => {
    expect(statusLabel("approved")).toBe("Approved, not live");
    expect(statusTone("published")).toBe("success");
    expect(statusTone("rejected")).toBe("destructive");
  });

  it("counts approval, publishing, and 30-day value states", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const publishedAt = "2026-07-17T12:00:00.000Z";
    const stats = buildLocalReachStats([
      BASE_RECOMMENDATION,
      { ...BASE_RECOMMENDATION, id: "rec-2", status: "approved" },
      { ...BASE_RECOMMENDATION, id: "rec-3", status: "changes_requested" },
      { ...BASE_RECOMMENDATION, id: "rec-4", status: "published", publishedAt },
      {
        ...BASE_RECOMMENDATION,
        id: "rec-5",
        status: "draft",
        createdAt: "2026-06-16T11:59:59.000Z",
      },
    ]);

    expect(stats).toEqual({
      waitingForReview: 1,
      approvedWaitingForPublishing: 1,
      publishedLast30Days: 1,
      needsClarification: 1,
      createdLast30Days: 4,
    });
  });

  it("marks setup steps complete only when required customer facts exist", () => {
    const steps = buildSetupSteps(
      {
        shopName: "Supreme Collision",
        market: "Ontario, Canada",
        pilotStatus: "Active pilot",
        lastAuditAt: null,
        sourcesCheckedThrough: "2026-07-17",
        serviceArea: ["Thornhill"],
        services: [],
        certifications: [],
        claimsToAvoid: [],
        approvalContacts: [],
        publishingNotes: null,
      },
      [],
    );

    expect(steps).toContainEqual({ label: "Business facts", status: "complete" });
    expect(steps).toContainEqual({ label: "Approved service area", status: "complete" });
    expect(steps).toContainEqual({ label: "Approved services", status: "pending" });
    expect(steps).toContainEqual({ label: "First recommendation draft", status: "pending" });
  });

  it("loads shop-scoped settings, recommendations, and evidence", async () => {
    const maybeSingle = vi.fn(async () => ({
      data: {
        shop_name: "Supreme Collision Centre",
        market: "Thornhill, Ontario",
        pilot_status: "Active pilot",
        sources_checked_through: "2026-07-17",
        service_area_jsonb: ["Thornhill", "Vaughan"],
        services_jsonb: ["Collision repair"],
        certifications_jsonb: ["I-CAR Gold Class"],
        claims_to_avoid_jsonb: ["Insurance partner claims without proof"],
        approval_contacts_jsonb: ["Owner"],
        publishing_notes: "Manual publish only.",
      },
      error: null,
    }));
    const recommendationOrder = vi.fn(() => ({
      order: vi.fn(async () => ({
        data: [
          {
            id: "rec-1",
            created_at: "2026-07-17T12:00:00.000Z",
            title: "Add Thornhill hail repair FAQ",
            recommendation_type: "FAQ",
            status: "ready_for_review",
            risk_level: "medium",
            market: "Thornhill, Ontario",
            source_date: "2026-07-17",
            value_line: "Helps drivers find a clear answer.",
            summary: "Add FAQ copy.",
            why_it_matters: "Recent storms increase repair questions.",
            business_value: "Clarifies service availability.",
            target_page: "/hail-repair",
            draft_preview: "Short FAQ draft",
            location_safety_note: "Service area matches Thornhill.",
            approval_item_id: "approval-1",
          },
        ],
        error: null,
      })),
    }));
    const evidenceOrder = vi.fn(async () => ({
      data: [
        {
          id: "evidence-1",
          recommendation_id: "rec-1",
          source_name: "Supreme Collision website",
          url: "https://example.com",
          source_date: "2026-07-17",
          summary: "Public service page lists collision repair.",
        },
      ],
      error: null,
    }));
    const evidenceIn = vi.fn(() => ({ order: evidenceOrder }));
    const evidenceShopEq = vi.fn(() => ({ in: evidenceIn }));
    const client = {
      from(table: string) {
        if (table === "local_reach_customer_settings") {
          return { select: () => ({ eq: () => ({ maybeSingle }) }) };
        }
        if (table === "local_reach_recommendations") {
          return { select: () => ({ eq: () => ({ order: recommendationOrder }) }) };
        }
        if (table === "local_reach_evidence_links") {
          return { select: () => ({ eq: evidenceShopEq }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const workspace = await getLocalReachWorkspace(client as never, "shop-1", "Riverside Collision");

    expect(workspace.settings.shopName).toBe("Riverside Collision");
    expect(workspace.recommendations[0]).toMatchObject({
      id: "rec-1",
      title: "Add Thornhill hail repair FAQ",
      status: "ready_for_review",
      risk: "medium",
      approvalItemId: "approval-1",
    });
    expect(workspace.recommendations[0].evidence).toHaveLength(1);
    expect(workspace.stats.waitingForReview).toBe(1);
    expect(evidenceShopEq).toHaveBeenCalledWith("shop_id", "shop-1");
    expect(evidenceIn).toHaveBeenCalledWith("recommendation_id", ["rec-1"]);
  });

  it("uses the authenticated active-shop identity when no settings row exists", async () => {
    const settingsMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const recommendationsOrder = vi.fn(async () => ({ data: [], error: null }));
    const client = {
      from(table: string) {
        if (table === "local_reach_customer_settings") {
          return { select: () => ({ eq: () => ({ maybeSingle: settingsMaybeSingle }) }) };
        }
        if (table === "local_reach_recommendations") {
          return { select: () => ({ eq: () => ({ order: () => ({ order: recommendationsOrder }) }) }) };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };

    const workspace = await getLocalReachWorkspace(
      client as never,
      "riverside-shop-id",
      "Riverside Collision",
    );

    expect(workspace.settings.shopName).toBe("Riverside Collision");
  });
});
