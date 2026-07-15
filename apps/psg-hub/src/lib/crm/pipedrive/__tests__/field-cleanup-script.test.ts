import { describe, expect, it } from "vitest";

import {
  PSG_SALES_PIPELINE_ID,
  PSG_SALES_STAGE_IDS,
  WON_HANDOFF_DEAL_FIELDS,
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
      custom("Signed Contract / Approval Link", "signed_contract_link"),
      custom("Billing Model", "billing_model"),
      custom("Google Shared Drive Folder Link", "google_drive_folder_link"),
      custom("Delivery Owner", "delivery_owner"),
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
          label: "Signed Contract / Approval Link",
          fieldCode: "signed_contract_link",
          body: expect.objectContaining({
            required_fields: expect.objectContaining({
              statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
            }),
          }),
        }),
        expect.objectContaining({
          type: "updateDealFieldRequired",
          label: "Google Shared Drive Folder Link",
          fieldCode: "google_drive_folder_link",
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
        expect.objectContaining({ label: "Contact phone-or-email" }),
        expect.objectContaining({ label: "Lost Reason required-on-lost" }),
        expect.objectContaining({ label: "Custom Lost Reason" }),
        expect.objectContaining({ label: "qbo_item_id" }),
        expect.objectContaining({ label: "Legacy warranty/letter/header organization fields" }),
      ]),
    );
    expect(plan.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "First Contact Date auto-stamp",
          status: "handled outside this script",
        }),
      ]),
    );
    expect(plan.liveApplyScope.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Organization Website dedupe" }),
        expect.objectContaining({ label: "Lost Reason consolidation" }),
        expect.objectContaining({ label: "Contact phone-or-email" }),
        expect.objectContaining({ label: "First Contact Date auto-stamp" }),
      ]),
    );
    expect(plan.unresolved).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "First Contact Date auto-stamp" }),
      ]),
    );
  });

  it("plans PSG-1337 Won-stage custom fields with exact types and options when they are missing", () => {
    const plan = buildCleanupPlan({
      dealFields: [
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
      ],
      organizationFields: [],
      productFields: [],
    });

    const createOps = plan.operations.filter((op) => op.type === "createDealField");

    expect(createOps).toHaveLength(WON_HANDOFF_DEAL_FIELDS.length);
    expect(createOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Billing Model",
          body: expect.objectContaining({
            field_name: "Billing Model",
            field_type: "enum",
            options: [
              { label: "Not applicable / single location" },
              { label: "Parent-paid" },
              { label: "Location-paid" },
              { label: "Split billing" },
            ],
            required_fields: {
              enabled: true,
              stage_ids: [],
              statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
            },
          }),
        }),
        expect.objectContaining({
          label: "Signed Contract / Approval Link",
          body: expect.objectContaining({
            field_type: "varchar",
            show_in_pipelines: { show_in_all: false, pipeline_ids: [PSG_SALES_PIPELINE_ID] },
          }),
        }),
        expect.objectContaining({
          label: "Delivery Owner",
          body: expect.objectContaining({ field_type: "user" }),
        }),
        expect.objectContaining({
          label: "Google Shared Drive Folder Link",
          body: expect.objectContaining({ field_type: "varchar" }),
        }),
      ]),
    );
  });

  it("requires existing PSG-1337 Won-stage fields without creating duplicates", () => {
    const wonFields = WON_HANDOFF_DEAL_FIELDS.map((spec, index) =>
      custom(spec.create.field_name, `won_field_${index}`),
    );
    const plan = buildCleanupPlan({
      dealFields: [
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
        ...wonFields,
      ],
      organizationFields: [],
      productFields: [],
    });

    expect(plan.operations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "createDealField" })]),
    );
    for (const [index, spec] of WON_HANDOFF_DEAL_FIELDS.entries()) {
      expect(plan.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "updateDealFieldRequired",
            label: spec.create.field_name,
            fieldCode: `won_field_${index}`,
            body: expect.objectContaining({
              required_fields: expect.objectContaining({
                statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
              }),
            }),
          }),
        ]),
      );
    }
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
        "fieldCode" in op &&
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

  it("filters stale Pipedrive stage and pipeline ids before applying required-field updates", () => {
    const plan = buildCleanupPlan({
      activeStageIds: new Set([PSG_SALES_STAGE_IDS.newLead]),
      activePipelineIds: new Set([PSG_SALES_PIPELINE_ID]),
      dealFields: [
        custom("Lead Source (Channel)", "lead_source_channel", {
          required_fields: {
            enabled: true,
            stage_ids: [999],
            statuses: { "1": ["won", "lost"] },
          },
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
      organizationFields: [],
      productFields: [],
    });

    const leadSourceOp = plan.operations.find(
      (op) =>
        op.type === "updateDealFieldRequired" &&
        "fieldCode" in op &&
        op.fieldCode === "lead_source_channel",
    );

    expect(leadSourceOp).toMatchObject({
      body: {
        required_fields: {
          stage_ids: [PSG_SALES_STAGE_IDS.newLead],
          statuses: {},
        },
      },
    });
  });

  it("keeps lost reason consolidation unresolved when live metadata looks custom", () => {
    const plan = buildCleanupPlan({
      dealFields: [
        custom("Lead Source (Channel)", "lead_source_channel"),
        system("Organization", "org_id"),
        system("Contact person", "person_id"),
        custom("First Contact Date", "first_contact_date"),
        custom("Service Line", "service_line"),
        system("Value", "value"),
        system("Expected Close Date", "expected_close_date"),
        custom("Revenue Type", "revenue_type"),
        custom("Proposal Link", "proposal_link"),
        custom("Lost reason", "lost_reason", { field_code: "lost_reason" }),
      ],
      organizationFields: [],
      productFields: [],
    });

    expect(plan.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deleteDealField",
          fieldCode: "lost_reason",
        }),
      ]),
    );
    expect(plan.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Lost Reason required-on-lost" }),
      ]),
    );
  });
});
