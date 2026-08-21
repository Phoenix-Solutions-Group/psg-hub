import { describe, expect, it } from "vitest";

import {
  EXPECTED_WON_BILLING_REQUIRED_FIELDS,
  WON_STAGE_ID,
  buildWonBillingCoverageCheck,
} from "../../../../../scripts/pipedrive-won-billing-coverage-check.mjs";

const expectedFieldById = new Map(
  EXPECTED_WON_BILLING_REQUIRED_FIELDS.map((field) => [field.id, field]),
);

const requiredField = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  field_code: expectedFieldById.get(id)?.code ?? `field_${id}`,
  field_name: name,
  required_fields: { enabled: true, stage_ids: [WON_STAGE_ID], statuses: { "8": ["won"] } },
  ...extra,
});

describe("pipedrive-won-billing-coverage-check", () => {
  it("passes only when the Won gate covers the exact 19 billing fields", () => {
    const check = buildWonBillingCoverageCheck({
      dealFields: EXPECTED_WON_BILLING_REQUIRED_FIELDS.map((field) =>
        requiredField(field.id, field.name),
      ),
    });

    expect(check.ok).toBe(true);
    expect(check.expectedFieldCount).toBe(19);
    expect(check.actualFieldCount).toBe(19);
    expect(check.missingNames).toEqual([]);
    expect(check.unexpectedNames).toEqual([]);
    expect(check.alertText).toBe("");
  });

  it("flags missing fields with business-readable names", () => {
    const check = buildWonBillingCoverageCheck({
      dealFields: EXPECTED_WON_BILLING_REQUIRED_FIELDS
        .filter((field) => ![12543, 12549].includes(field.id))
        .map((field) => requiredField(field.id, field.name)),
    });

    expect(check.ok).toBe(false);
    expect(check.missingIds).toEqual([12543, 12549]);
    expect(check.missingNames).toEqual(["Billing Email", "Monthly Recurring Fees"]);
    expect(check.alertText).toContain(
      "Won-gate billing check lost coverage: Billing Email, Monthly Recurring Fees no longer required",
    );
    expect(check.alertText).toContain("Finance may be unable to invoice new sales");
  });

  it("flags an expected field when it keeps the Won stage rule but loses the Won button rule", () => {
    const check = buildWonBillingCoverageCheck({
      dealFields: EXPECTED_WON_BILLING_REQUIRED_FIELDS.map((field) =>
        requiredField(
          field.id,
          field.name,
          field.id === 12543
            ? { required_fields: { enabled: true, stage_ids: [WON_STAGE_ID] } }
            : {},
        ),
      ),
    });

    expect(check.ok).toBe(false);
    expect(check.missingIds).toEqual([12543]);
    expect(check.missingNames).toEqual(["Billing Email"]);
    expect(check.alertText).toContain("Billing Email no longer required");
  });

  it("does not count a field that has only the Won button rule without the Won stage rule", () => {
    const check = buildWonBillingCoverageCheck({
      dealFields: EXPECTED_WON_BILLING_REQUIRED_FIELDS.map((field) =>
        requiredField(
          field.id,
          field.name,
          field.id === 12549
            ? { required_fields: { enabled: true, statuses: { "8": ["won"] } } }
            : {},
        ),
      ),
    });

    expect(check.ok).toBe(false);
    expect(check.missingIds).toEqual([12549]);
    expect(check.missingNames).toEqual(["Monthly Recurring Fees"]);
  });

  it("flags unexpected additions even when the count is still 19", () => {
    const swappedFields = EXPECTED_WON_BILLING_REQUIRED_FIELDS
      .filter((field) => field.id !== 12549)
      .map((field) => requiredField(field.id, field.name));
    swappedFields.push(requiredField(99999, "Unexpected Billing Field"));

    const check = buildWonBillingCoverageCheck({ dealFields: swappedFields });

    expect(check.ok).toBe(false);
    expect(check.actualFieldCount).toBe(19);
    expect(check.missingNames).toEqual(["Monthly Recurring Fees"]);
    expect(check.unexpectedNames).toEqual(["Unexpected Billing Field"]);
    expect(check.alertText).toContain("lost coverage: Monthly Recurring Fees no longer required");
    expect(check.alertText).toContain("unexpectedly requires: Unexpected Billing Field");
  });

  it("ignores fields required outside the Won stage", () => {
    const check = buildWonBillingCoverageCheck({
      dealFields: [
        ...EXPECTED_WON_BILLING_REQUIRED_FIELDS.map((field) => requiredField(field.id, field.name)),
        requiredField(88888, "Other Stage Field", {
          required_fields: { enabled: true, stage_ids: [62], statuses: {} },
        }),
      ],
    });

    expect(check.ok).toBe(true);
    expect(check.actualFieldCount).toBe(19);
    expect(check.unexpectedNames).toEqual([]);
  });
});
