import { describe, expect, it } from "vitest";

import {
  DELIVERY_TEMPLATE_FIELD_ID,
  DELIVERY_TEMPLATE_OPTIONS,
  GATE_1_REQUIRED_FIELD_IDS,
  GATE_2_FIELD_IDS,
  OPTIONAL_FIELD_IDS,
  PSG_SALES_PIPELINE_ID,
  RETIRED_FIELD_IDS,
  buildPlan,
} from "../../../../../scripts/pipedrive-won-gate-fix.mjs";

const field = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  key: `field_${id}`,
  name,
  field_type: "varchar",
  active_flag: true,
  ...extra,
});

const fieldV2 = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  field_code: `field_${id}`,
  field_name: name,
  field_type: "varchar",
  required_fields: { enabled: false, stage_ids: [], statuses: {} },
  ...extra,
});

function baseFields() {
  const fieldsV1 = [
    ...GATE_1_REQUIRED_FIELD_IDS.map((id) => field(id, `Gate 1 ${id}`)),
    ...OPTIONAL_FIELD_IDS.map((id) => field(id, `Optional ${id}`)),
    ...GATE_2_FIELD_IDS.map((id) => field(id, `Gate 2 ${id}`)),
    ...RETIRED_FIELD_IDS.map((id) => field(id, `Retire ${id}`)),
    field(12563, "Handoff Complete"),
  ];
  const fieldsV2 = fieldsV1.map((f) => fieldV2(Number(f.id), String(f.name)));
  return { fieldsV1, fieldsV2 };
}

describe("pipedrive-won-gate-fix plan", () => {
  it("requires only the 14 canonical Gate 1 fields and retires duplicate fields", () => {
    const { fieldsV1, fieldsV2 } = baseFields();
    const plan = buildPlan({ fieldsV1, fieldsV2, openDeals: [] });

    expect(plan.errors).toEqual([]);
    expect(plan.actions.filter((action) => action.type === "requireGate1Field")).toHaveLength(14);
    for (const id of GATE_1_REQUIRED_FIELD_IDS) {
      expect(plan.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "requireGate1Field",
            id,
            body: expect.objectContaining({
              required_fields: {
                enabled: true,
                stage_ids: [],
                statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
              },
            }),
          }),
        ]),
      );
    }
    for (const id of RETIRED_FIELD_IDS) {
      expect(plan.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "retireDealField",
            id,
          }),
        ]),
      );
    }
  });

  it("clears accidental required rules from optional and Gate 2 fields", () => {
    const { fieldsV1, fieldsV2 } = baseFields();
    for (const field of fieldsV2) {
      if (
        OPTIONAL_FIELD_IDS.includes(Number(field.field_code.replace("field_", ""))) ||
        GATE_2_FIELD_IDS.includes(Number(field.field_code.replace("field_", "")))
      ) {
        field.required_fields = { enabled: true, stage_ids: [63], statuses: { "8": ["won"] } };
      }
    }

    const plan = buildPlan({ fieldsV1, fieldsV2, openDeals: [] });

    expect(plan.actions.filter((action) => action.type === "clearOptionalRequired")).toHaveLength(5);
    expect(plan.actions.filter((action) => action.type === "clearGate2ApiRequired")).toHaveLength(5);
  });

  it("keeps Rev 3 Delivery Template options on the canonical field", () => {
    const { fieldsV1, fieldsV2 } = baseFields();
    const template = fieldsV1.find((f) => f.id === DELIVERY_TEMPLATE_FIELD_ID);
    Object.assign(template!, {
      field_type: "enum",
      options: [
        { id: 1, label: "New-client onboarding" },
        { id: 2, label: "New Website Build" },
        { id: 3, label: "Custom Delivery Project" },
        { id: 4, label: "Needs Production decision" },
      ],
    });

    const plan = buildPlan({ fieldsV1, fieldsV2, openDeals: [] });

    expect(DELIVERY_TEMPLATE_OPTIONS).toEqual([
      "New-client onboarding",
      "New Website Build",
      "Custom Delivery Project",
      "Needs Production decision",
    ]);
    expect(plan.actions.some((action) => action.type === "syncDeliveryTemplateOptions")).toBe(false);
  });

  it("refuses apply when deals contain values in fields planned for retirement", () => {
    const { fieldsV1, fieldsV2 } = baseFields();
    const firstField = fieldsV1.find((f) => f.id === RETIRED_FIELD_IDS[0])!;
    const plan = buildPlan({
      fieldsV1,
      fieldsV2,
      openDeals: [{ id: 99, [String(firstField.key)]: "filled" }],
    });

    expect(plan.errors).toEqual([
      "Deals have nonblank values in fields planned for retirement; refusing to apply without data migration (1 value(s))",
    ]);
    expect(plan.verification.dealNonBlankRetiredValues).toEqual([
      { dealId: 99, fieldCode: firstField.key },
    ]);
  });
});
