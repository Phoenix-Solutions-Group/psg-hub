import { describe, expect, it } from "vitest";

import {
  PSG_SALES_PIPELINE_ID,
  PSG_SALES_STAGE_IDS,
  buildCleanupPlan,
} from "../../../../../scripts/pipedrive-field-cleanup.mjs";

const custom = (name: string, key: string, extra: Record<string, unknown> = {}) => ({
  name,
  key,
  field_code: key,
  is_custom_flag: true,
  edit_flag: true,
  active_flag: true,
  ...extra,
});

const system = (name: string, key: string, extra: Record<string, unknown> = {}) => ({
  name,
  key,
  field_code: key,
  is_custom_flag: false,
  edit_flag: false,
  active_flag: true,
  ...extra,
});

describe("pipedrive-field-cleanup plan", () => {
  it("builds stage-required field updates, dedupe cleanup, and protected follow-ups", () => {
    const dealFields = [
      custom("Lead Source (Channel)", "lead_source_channel"),
      system("Organization", "org_id"),
      system("Contact person", "person_id"),
      custom("First Contact Date", "first_contact_date"),
      custom("Service Line", "service_line"),
      system("Value", "value"),
      system("Expected Close Date", "expected_close_date"),
      custom("Revenue Type", "revenue_type"),
      custom("Proposal Link", "proposal_link"),
      system("Lost reason", "lost_reason"),
      custom("Lost Reason", "custom_lost_reason"),
    ];
    const organizationFields = [
      system("Website", "website"),
      custom("Website", "custom_website"),
      custom("WarrantyHeader1", "warranty_header_1"),
    ];
    const productFields = [
      custom("Income Account", "income_account"),
      custom("Expense Account", "expense_account"),
      custom("Supplier", "supplier"),
      custom("qbo_item_id", "qbo_item_id"),
    ];

    const plan = buildCleanupPlan({ dealFields, organizationFields, productFields });

    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "updateDealFieldRequired",
          label: "Lead Source (Channel)",
          fieldCode: "lead_source_channel",
          body: expect.objectContaining({
            required_fields: expect.objectContaining({
              enabled: true,
              stage_ids: [PSG_SALES_STAGE_IDS.newLead],
            }),
          }),
        }),
        expect.objectContaining({
          type: "updateDealFieldRequired",
          label: "Proposal Link",
          fieldCode: "proposal_link",
          body: expect.objectContaining({
            required_fields: expect.objectContaining({
              stage_ids: [PSG_SALES_STAGE_IDS.proposalSent],
            }),
          }),
        }),
        expect.objectContaining({
          type: "updateDealFieldRequired",
          label: "Lost Reason",
          fieldCode: "lost_reason",
          body: expect.objectContaining({
            required_fields: expect.objectContaining({
              statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["lost"] },
            }),
          }),
        }),
        expect.objectContaining({
          type: "deleteDealField",
          fieldCode: "custom_lost_reason",
        }),
        expect.objectContaining({
          type: "dedupeOrganizationWebsite",
          customFieldCode: "custom_website",
        }),
        expect.objectContaining({
          type: "deleteProductField",
          fieldCode: "income_account",
        }),
      ]),
    );
    expect(plan.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldCode: "warranty_header_1" }),
        expect.objectContaining({ fieldCode: "qbo_item_id" }),
      ]),
    );
    expect(plan.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "qbo_item_id" }),
        expect.objectContaining({ label: "Legacy warranty/letter/header organization fields" }),
        expect.objectContaining({ label: "First Contact Date auto-stamp" }),
      ]),
    );
  });

  it("preserves existing required stages while adding Reese's stage gate", () => {
    const plan = buildCleanupPlan({
      dealFields: [
        custom("Lead Source (Channel)", "lead_source_channel", {
          required_fields: { enabled: true, stage_ids: [999], statuses: {} },
        }),
        system("Organization", "org_id"),
        system("Contact person", "person_id"),
        custom("First Contact Date", "first_contact_date"),
        custom("Service Line", "service_line"),
        system("Value", "value"),
        system("Expected Close Date", "expected_close_date"),
        custom("Revenue Type", "revenue_type"),
        custom("Proposal Link", "proposal_link"),
        system("Lost reason", "lost_reason"),
      ],
      organizationFields: [system("Website", "website"), custom("Website", "custom_website")],
      productFields: [
        custom("Income Account", "income_account"),
        custom("Expense Account", "expense_account"),
        custom("Supplier", "supplier"),
      ],
    });

    const leadSourceOp = plan.operations.find(
      (op) =>
        op.type === "updateDealFieldRequired" &&
        op.fieldCode === "lead_source_channel",
    );

    expect(leadSourceOp).toMatchObject({
      body: {
        required_fields: {
          stage_ids: [PSG_SALES_STAGE_IDS.newLead, 999],
        },
      },
    });
  });
});
