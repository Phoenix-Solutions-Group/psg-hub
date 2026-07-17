import { describe, expect, it } from "vitest";

import {
  ACTUAL_HOURS_FIELDS,
  ACTUAL_HOURS_REPORT_LIMIT,
  BRANDING_TIER_ESTIMATES,
  TIER_BASIS_FIELDS,
  buildActualHoursReport,
  buildPlan,
} from "../../../../../scripts/pipedrive-branding-tier-basis.mjs";

const field = (id: number, name: string, type = "varchar") => ({
  id,
  key: `field_${id}`,
  name,
  field_type: type,
  active_flag: true,
});

const fieldV2 = (id: number, name: string, type = "varchar") => ({
  field_code: `field_${id}`,
  field_name: name,
  field_type: type,
  required_fields: { enabled: false, stage_ids: [], statuses: {} },
  ui_visibility: {
    add_visible_flag: true,
    details_visible_flag: true,
    projects_detail_visible_flag: true,
    show_in_pipelines: { show_in_all: false, pipeline_ids: [8] },
  },
});

function configuredFields() {
  const fieldsV1 = [
    ...TIER_BASIS_FIELDS.map((spec, index) => field(1000 + index, spec.name, spec.type)),
    ...ACTUAL_HOURS_FIELDS.map((spec, index) => field(2000 + index, spec.name, spec.type)),
  ];
  const fieldsV2 = fieldsV1.map((item) => fieldV2(Number(item.id), String(item.name), String(item.field_type)));
  return { fieldsV1, fieldsV2 };
}

describe("pipedrive-branding-tier-basis plan", () => {
  it("creates the phase-level actual-hours fields with the Tier Basis setup", () => {
    const plan = buildPlan({ fieldsV1: [], fieldsV2: [], filters: [] });

    expect(plan.actions.filter((action) => action.type === "createDealField")).toHaveLength(
      TIER_BASIS_FIELDS.length + ACTUAL_HOURS_FIELDS.length,
    );
    expect(ACTUAL_HOURS_FIELDS.map((spec) => spec.name)).toEqual([
      "phase1_design_hours_actual",
      "phase1_pm_hours_actual",
      "phase2_design_hours_actual",
      "phase2_pm_hours_actual",
      "phase3_design_hours_actual",
      "phase3_pm_hours_actual",
      "phase4_design_hours_actual",
      "phase4_pm_hours_actual",
      "change_order_design_hours",
      "change_order_pm_hours",
    ]);
    for (const spec of ACTUAL_HOURS_FIELDS) {
      expect(plan.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldName: spec.name,
            body: expect.objectContaining({
              field_type: "double",
              required_fields: { enabled: false, stage_ids: [], statuses: {} },
            }),
          }),
        ]),
      );
    }
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "phase1_design_hours_actual",
          body: expect.objectContaining({
            description: expect.stringContaining("Attribute hours by the ROLE"),
          }),
        }),
      ]),
    );
  });

  it("reports the first three won branding jobs against the per-phase baseline", () => {
    const { fieldsV1 } = configuredFields();
    const report = buildActualHoursReport({
      fieldsV1,
      generatedAt: "2026-07-17T00:00:00.000Z",
      deals: [
        {
          id: 3,
          title: "Third",
          status: "won",
          won_time: "2026-07-13T00:00:00Z",
          field_1005: "T3 Identity + Rollout",
          field_2000: 12,
          field_2001: 3,
          field_2002: 23,
          field_2003: 3,
          field_2004: 30,
          field_2005: 3,
          field_2006: 17,
          field_2007: 5,
          field_2008: 99,
          field_2009: 99,
        },
        {
          id: 1,
          title: "First",
          status: "won",
          won_time: "2026-07-11T00:00:00Z",
          field_1005: "T1 Brand Mark",
          field_2000: 3,
          field_2001: 1.5,
          field_2002: 11,
          field_2003: 1,
          field_2004: 9,
          field_2005: 1.5,
          field_2006: 4,
          field_2007: 1,
          field_2008: 6,
          field_2009: 2,
        },
        {
          id: 2,
          title: "Second",
          status: "won",
          won_time: "2026-07-12T00:00:00Z",
          field_1005: "T2 Brand Identity System",
          field_2000: 8,
          field_2001: 2.5,
          field_2002: 14,
          field_2003: 1.5,
          field_2004: 15,
          field_2005: 2,
          field_2006: 23,
          field_2007: 2,
          field_2008: 10,
          field_2009: 3,
        },
        {
          id: 4,
          title: "Fourth is outside the trigger window",
          status: "won",
          won_time: "2026-07-14T00:00:00Z",
          field_1005: "T1 Brand Mark",
          field_2000: 30,
        },
      ],
    });

    expect(ACTUAL_HOURS_REPORT_LIMIT).toBe(3);
    expect(BRANDING_TIER_ESTIMATES["T1 Brand Mark"].designHours).toBe(27);
    expect(report.ready).toBe(true);
    expect(report.firstClosedBrandingJobs.map((deal) => deal.dealId)).toEqual([1, 2, 3]);
    expect(report.firstClosedBrandingJobs[1]).toEqual(
      expect.objectContaining({
        estimatedDesignHours: 50,
        actualDesignHours: 60,
        designVariancePct: 20,
        changeOrderDesignHours: 10,
        repricingTrigger: true,
      }),
    );
    expect(report.firstClosedBrandingJobs[1].phases[3]).toEqual(
      expect.objectContaining({
        phase: 4,
        estimatedDesignHours: 13,
        actualDesignHours: 23,
      }),
    );
    expect(report.byTier.find((bucket) => bucket.tier === "T2 Brand Identity System")).toEqual(
      expect.objectContaining({
        estimatedDesignHours: 50,
        actualDesignHours: 60,
        designVariancePct: 20,
      }),
    );
  });

  it("does not mark the report ready until the Pipedrive fields exist", () => {
    const report = buildActualHoursReport({
      fieldsV1: [field(1005, "Tier Basis - Tier selected", "enum")],
      deals: [],
      generatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(report.ready).toBe(false);
    expect(report.missingFields).toEqual(ACTUAL_HOURS_FIELDS.map((spec) => spec.name));
  });
});
