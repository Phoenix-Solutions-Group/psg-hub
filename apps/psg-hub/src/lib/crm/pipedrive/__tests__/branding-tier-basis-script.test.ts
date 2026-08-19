import { describe, expect, it } from "vitest";

import {
  ACTUAL_HOURS_FIELDS,
  ACTUAL_HOURS_REPORT_LIMIT,
  BRANDING_PIPELINE_NAME,
  BRANDING_STAGE_NAMES,
  BRANDING_TIER_ESTIMATES,
  COST_BASIS_AUDIT_FILTER_NAME,
  COST_BASIS_FIELDS,
  COST_BASIS_REJECTION_FIELD,
  TIER_BASIS_FIELDS,
  buildActualHoursReport,
  buildPlan,
} from "../../../../../scripts/pipedrive-branding-tier-basis.mjs";

const field = (id: number, name: string, type = "varchar", options: string[] = []) => ({
  id,
  key: `field_${id}`,
  name,
  field_type: type,
  active_flag: true,
  options: options.map((label, index) => ({ id: id * 10 + index, label })),
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

const specOptions = (spec: object) =>
  "options" in spec && Array.isArray(spec.options) ? spec.options.map(String) : [];

const auditFilter = (fieldIds: number[]) => ({
  id: 1237,
  name: "Branding audit - Proposal Sent missing Tier Basis",
  conditions: {
    glue: "and",
    conditions: [
      {
        glue: "and",
        conditions: [
          {
            object: "deal",
            field_id: "12462",
            operator: "=",
            value: "8",
            extra_value: null,
          },
          {
            object: "deal",
            field_id: "12464",
            operator: "=",
            value: "59",
            extra_value: null,
          },
        ],
      },
      {
        glue: "or",
        conditions: fieldIds.map((id) => ({
          object: "deal",
          field_id: String(id),
          operator: "IS NULL",
          value: null,
          extra_value: null,
        })),
      },
    ],
  },
});

const missingFieldsAuditFilter = (id: number, name: string, fieldIds: number[]) => ({
  id,
  name,
  conditions: {
    glue: "and",
    conditions: [
      {
        glue: "and",
        conditions: [
          {
            object: "deal",
            field_id: "12462",
            operator: "=",
            value: "8",
            extra_value: null,
          },
          {
            object: "deal",
            field_id: "12464",
            operator: "=",
            value: "59",
            extra_value: null,
          },
        ],
      },
      {
        glue: "or",
        conditions: fieldIds.map((fieldId) => ({
          object: "deal",
          field_id: String(fieldId),
          operator: "IS NULL",
          value: null,
          extra_value: null,
        })),
      },
    ],
  },
});

function configuredFields() {
  const fieldsV1 = [
    ...TIER_BASIS_FIELDS.map((spec, index) =>
      field(1000 + index, spec.name, spec.type, specOptions(spec)),
    ),
    ...COST_BASIS_FIELDS.map((spec, index) =>
      field(1500 + index, spec.name, spec.type, specOptions(spec)),
    ),
    field(1550, COST_BASIS_REJECTION_FIELD.name, COST_BASIS_REJECTION_FIELD.type),
    ...ACTUAL_HOURS_FIELDS.map((spec, index) =>
      field(2000 + index, spec.name, spec.type, specOptions(spec)),
    ),
  ];
  const fieldsV2 = fieldsV1.map((item) => fieldV2(Number(item.id), String(item.name), String(item.field_type)));
  return { fieldsV1, fieldsV2 };
}

describe("pipedrive-branding-tier-basis plan", () => {
  it("creates Cost Basis, rejected-line, and phase-level actual-hours fields with the Tier Basis setup", () => {
    const plan = buildPlan({ fieldsV1: [], fieldsV2: [], filters: [] });

    expect(plan.actions.filter((action) => action.type === "createDealField")).toHaveLength(
      TIER_BASIS_FIELDS.length + COST_BASIS_FIELDS.length + 1 + ACTUAL_HOURS_FIELDS.length,
    );
    expect(TIER_BASIS_FIELDS).toHaveLength(9);
    expect(COST_BASIS_FIELDS.map((spec) => spec.name)).toEqual([
      "Cost basis",
      "Cost basis source",
      "Cost basis date",
    ]);
    expect(COST_BASIS_REJECTION_FIELD).toEqual(
      expect.objectContaining({
        name: "Cost basis rejected lines",
        type: "double",
      }),
    );
    expect(TIER_BASIS_FIELDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Tier Basis - T3 Named vendors",
          type: "text",
          description: expect.stringContaining("Tier 3 only"),
        }),
      ]),
    );
    expect(TIER_BASIS_FIELDS.map((spec) => spec.name)).not.toContain("T3 - Priority surfaces");
    expect(TIER_BASIS_FIELDS.map((spec) => spec.name)).not.toContain("T3 - Named vendors");
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "Tier Basis - T3 Named vendors",
          body: expect.objectContaining({
            field_type: "text",
            description: expect.stringContaining("Every vendor PSG coordinates with"),
          }),
        }),
      ]),
    );
    for (const spec of COST_BASIS_FIELDS) {
      expect(plan.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldName: spec.name,
            body: expect.objectContaining({
              field_type: spec.type,
              required_fields: { enabled: false, stage_ids: [], statuses: {} },
            }),
          }),
        ]),
      );
    }
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "Cost basis rejected lines",
          body: expect.objectContaining({
            field_type: "double",
            description: expect.stringContaining("queryable by saved filter"),
          }),
        }),
      ]),
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
          fieldName: "phase3_design_hours_actual",
          body: expect.objectContaining({
            description: expect.stringContaining("role assigned in the PSG-658 task graph"),
          }),
        }),
        expect.objectContaining({
          fieldName: "change_order_design_hours",
          body: expect.objectContaining({
            description: expect.stringContaining("Keep these hours out of Phase 1-4 fixed-scope totals"),
          }),
        }),
      ]),
    );
  });

  it("reports the first three won branding jobs against phase totals and excludes change orders", () => {
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
          field_2004: 21,
          field_2005: 3,
          field_2006: 14,
          field_2007: 5,
          field_2008: 12,
          field_2009: 2,
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
          field_2008: 20,
          field_2009: 4,
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
          field_2004: 25,
          field_2005: 2,
          field_2006: 13,
          field_2007: 2,
          field_2008: 8,
          field_2009: 1,
        },
        {
          id: 4,
          title: "Fourth is outside the trigger window",
          status: "won",
          won_time: "2026-07-14T00:00:00Z",
          field_1005: "T1 Brand Mark",
          field_2000: 3,
        },
      ],
    });

    expect(ACTUAL_HOURS_REPORT_LIMIT).toBe(3);
    expect(BRANDING_TIER_ESTIMATES["T1 Brand Mark"].designHours).toBe(27);
    expect(report.ready).toBe(true);
    expect(report.firstClosedBrandingJobs.map((deal: { dealId: number }) => deal.dealId)).toEqual([1, 2, 3]);
    expect(report.firstClosedBrandingJobs[1]).toEqual(
      expect.objectContaining({
        estimatedDesignHours: 50,
        actualDesignHours: 60,
        designVariancePct: 20,
        changeOrderDesignHours: 8,
        repricingTrigger: true,
      }),
    );
    expect(report.firstClosedBrandingJobs[0]).toEqual(
      expect.objectContaining({
        actualDesignHours: 27,
        changeOrderDesignHours: 20,
        repricingTrigger: false,
      }),
    );
    expect(report.firstClosedBrandingJobs[1].phases[2]).toEqual(
      expect.objectContaining({
        name: "Review & Refinement",
        estimatedDesignHours: 15,
        actualDesignHours: 25,
        designVariancePct: 66.7,
      }),
    );
    expect(report.byTier.find((bucket) => bucket.tier === "T2 Brand Identity System")).toEqual(
      expect.objectContaining({
        estimatedDesignHours: 50,
        actualDesignHours: 60,
        designVariancePct: 20,
        estimatedPmHours: 8,
        actualPmHours: 8,
        pmVariancePct: 0,
        changeOrderDesignHours: 8,
      }),
    );
  });

  it("updates the Tier Basis audit filter to include the T3 vendor field fallback", () => {
    const { fieldsV1, fieldsV2 } = configuredFields();
    const tierBasisIds = fieldsV1.slice(0, TIER_BASIS_FIELDS.length).map((item) => item.id);
    const plan = buildPlan({
      fieldsV1,
      fieldsV2,
      filters: [auditFilter(tierBasisIds.slice(0, 8))],
    });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "updateFilter",
          filterId: 1237,
          filterName: "Branding audit - Proposal Sent missing Tier Basis",
          body: expect.objectContaining({
            conditions: expect.objectContaining({
              conditions: expect.arrayContaining([
	                expect.objectContaining({
	                  glue: "or",
	                  conditions: expect.arrayContaining([
	                    expect.objectContaining({ field_id: "1008", operator: "IS NULL" }),
	                  ]),
	                }),
              ]),
            }),
          }),
        }),
      ]),
    );
    expect(tierBasisIds[8]).toBe(1008);
  });

  it("renames the legacy T3 vendor field instead of creating a duplicate", () => {
    const legacyT3 = field(1008, "T3 - Named vendors", "text");
    const fieldsV1 = [
      ...TIER_BASIS_FIELDS.slice(0, 8).map((spec, index) => field(1000 + index, spec.name, spec.type, spec.options)),
      legacyT3,
    ];
    const fieldsV2 = fieldsV1.map((item) => fieldV2(Number(item.id), String(item.name), String(item.field_type)));
    const plan = buildPlan({ fieldsV1, fieldsV2, filters: [] });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "updateDealField",
          fieldId: 1008,
          fieldName: "Tier Basis - T3 Named vendors",
          body: expect.objectContaining({ field_name: "Tier Basis - T3 Named vendors" }),
        }),
      ]),
    );
    expect(
      plan.actions.filter((action) => action.type === "createDealField" && action.fieldName === "Tier Basis - T3 Named vendors"),
    ).toHaveLength(0);
  });

  it("creates a branding-only pipeline path and requires Tier Basis fields at Branding Proposal Sent", () => {
    const { fieldsV1, fieldsV2 } = configuredFields();
    const plan = buildPlan({
      fieldsV1,
      fieldsV2,
      filters: [],
      pipelines: [{ id: 10, name: BRANDING_PIPELINE_NAME } as never],
      stages: BRANDING_STAGE_NAMES.map(
        (name, index) => ({ id: 70 + index, name, pipeline_id: 10, order_nr: index + 1 }) as never,
      ),
      useBrandingPipeline: true,
    });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "updateDealField",
          fieldId: 1000,
          body: expect.objectContaining({
            required_fields: { enabled: true, stage_ids: [73], statuses: {} },
            ui_visibility: expect.objectContaining({
              show_in_pipelines: { show_in_all: false, pipeline_ids: [8, 10] },
            }),
          }),
        }),
      ]),
    );
    expect(plan.verification.pipeline).toEqual({ id: 10, name: BRANDING_PIPELINE_NAME, proposalSentStageId: 73 });
    expect(plan.verification.enforcement).toContain("Branding / Proposal Sent");
  });

  it("creates Cost Basis audit filters after the Cost Basis fields exist", () => {
    const { fieldsV1, fieldsV2 } = configuredFields();
    const tierBasisIds = fieldsV1.slice(0, TIER_BASIS_FIELDS.length).map((item) => item.id);
    const costBasisStart = TIER_BASIS_FIELDS.length;
    const costBasisIds = fieldsV1
      .slice(costBasisStart, costBasisStart + COST_BASIS_FIELDS.length)
      .map((item) => item.id);

    const plan = buildPlan({
      fieldsV1,
      fieldsV2,
      filters: [auditFilter(tierBasisIds)],
    });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "createFilter",
          filterName: COST_BASIS_AUDIT_FILTER_NAME,
          body: expect.objectContaining({
            conditions: expect.objectContaining({
              conditions: expect.arrayContaining([
                expect.objectContaining({
                  glue: "or",
                  conditions: expect.arrayContaining([
                    expect.objectContaining({ field_id: String(costBasisIds[0]) }),
                    expect.objectContaining({ field_id: String(costBasisIds[1]) }),
                    expect.objectContaining({ field_id: String(costBasisIds[2]) }),
                  ]),
                }),
              ]),
            }),
          }),
        }),
      ]),
    );
    expect(plan.verification.costBasisRejectionField).toEqual(
      expect.objectContaining({
        id: 1550,
        name: "Cost basis rejected lines",
        type: "double",
      }),
    );
    expect(plan.actions.map((action) => action.filterName)).not.toContain("Cost basis audit - Rejected lines");
  });

  it("updates an existing Cost Basis audit filter when a Cost Basis field is missing from it", () => {
    const { fieldsV1, fieldsV2 } = configuredFields();
    const tierBasisIds = fieldsV1.slice(0, TIER_BASIS_FIELDS.length).map((item) => item.id);
    const costBasisStart = TIER_BASIS_FIELDS.length;
    const costBasisIds = fieldsV1
      .slice(costBasisStart, costBasisStart + COST_BASIS_FIELDS.length)
      .map((item) => item.id);

    const plan = buildPlan({
      fieldsV1,
      fieldsV2,
      filters: [
        auditFilter(tierBasisIds),
        missingFieldsAuditFilter(1501, COST_BASIS_AUDIT_FILTER_NAME, costBasisIds.slice(0, 2)),
      ],
    });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "updateFilter",
          filterId: 1501,
          filterName: COST_BASIS_AUDIT_FILTER_NAME,
          body: expect.objectContaining({
            conditions: expect.objectContaining({
              conditions: expect.arrayContaining([
                expect.objectContaining({
                  glue: "or",
                  conditions: expect.arrayContaining([
                    expect.objectContaining({ field_id: String(costBasisIds[2]) }),
                  ]),
                }),
              ]),
            }),
          }),
        }),
      ]),
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
