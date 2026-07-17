import { describe, expect, it } from "vitest";

import {
  ACTUAL_HOURS_FIELDS,
  ACTUAL_HOURS_REPORT_LIMIT,
  BRANDING_TIER_ESTIMATES,
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
  options: options.map((label) => ({ label })),
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

function configuredFields() {
  const fieldsV1 = [
    ...TIER_BASIS_FIELDS.map((spec, index) => field(1000 + index, spec.name, spec.type, spec.options)),
    ...ACTUAL_HOURS_FIELDS.map((spec, index) => field(2000 + index, spec.name, spec.type, spec.options)),
  ];
  const fieldsV2 = fieldsV1.map((item) => fieldV2(Number(item.id), String(item.name), String(item.field_type)));
  return { fieldsV1, fieldsV2 };
}

describe("pipedrive-branding-tier-basis plan", () => {
  it("creates the engagement-level actual-hours fields with the Tier Basis setup", () => {
    const plan = buildPlan({ fieldsV1: [], fieldsV2: [], filters: [] });

    expect(plan.actions.filter((action) => action.type === "createDealField")).toHaveLength(
      TIER_BASIS_FIELDS.length + ACTUAL_HOURS_FIELDS.length,
    );
    expect(TIER_BASIS_FIELDS).toHaveLength(9);
    expect(TIER_BASIS_FIELDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "T3 - Named vendors",
          type: "text",
          description: expect.stringContaining("Tier 3 only"),
        }),
      ]),
    );
    expect(TIER_BASIS_FIELDS.map((spec) => spec.name)).not.toContain("T3 - Priority surfaces");
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "T3 - Named vendors",
          body: expect.objectContaining({
            field_type: "text",
            description: expect.stringContaining("Every vendor PSG coordinates with"),
          }),
        }),
      ]),
    );
    expect(ACTUAL_HOURS_FIELDS.map((spec) => spec.name)).toEqual([
      "Branding Actual - Design Hours",
      "Branding Actual - PM Hours",
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
          fieldName: "Branding Actual - Design Hours",
          body: expect.objectContaining({
            description: expect.stringContaining("total actual design hours"),
          }),
        }),
      ]),
    );
  });

  it("reports the first three won branding jobs against the engagement-level baseline", () => {
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
          field_2000: 82,
          field_2001: 14,
        },
        {
          id: 1,
          title: "First",
          status: "won",
          won_time: "2026-07-11T00:00:00Z",
          field_1005: "T1 Brand Mark",
          field_2000: 27,
          field_2001: 5,
        },
        {
          id: 2,
          title: "Second",
          status: "won",
          won_time: "2026-07-12T00:00:00Z",
          field_1005: "T2 Brand Identity System",
          field_2000: 60,
          field_2001: 8,
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
        repricingTrigger: true,
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

  it("updates an existing audit filter when the ninth Tier Basis field is missing from it", () => {
    const { fieldsV1, fieldsV2 } = configuredFields();
    const tierBasisIds = fieldsV1.slice(0, TIER_BASIS_FIELDS.length).map((item) => item.id);
    const plan = buildPlan({
      fieldsV1,
      fieldsV2,
      filters: [auditFilter(tierBasisIds.slice(0, 8))],
    });

    expect(plan.actions).toEqual([
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
                  expect.objectContaining({ field_id: String(tierBasisIds[8]) }),
                ]),
              }),
            ]),
          }),
        }),
      }),
    ]);
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
