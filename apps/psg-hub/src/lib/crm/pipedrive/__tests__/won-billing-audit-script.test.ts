import { describe, expect, it } from "vitest";

import { buildWonBillingAudit } from "../../../../../scripts/pipedrive-won-billing-audit.mjs";
import {
  GATE_1_REQUIRED_FIELD_IDS,
  PSG_SALES_PIPELINE_ID,
} from "../../../../../scripts/pipedrive-won-gate-fix.mjs";

const field = (id: number, name: string) => ({
  id,
  key: `field_${id}`,
  name,
  active_flag: true,
});

const completeDeal = (extra: Record<string, unknown> = {}) => ({
  id: 101,
  title: "Complete won deal",
  pipeline_id: PSG_SALES_PIPELINE_ID,
  ...Object.fromEntries(GATE_1_REQUIRED_FIELD_IDS.map((id) => [`field_${id}`, "filled"])),
  ...extra,
});

describe("pipedrive-won-billing-audit", () => {
  it("passes when PSG Sales won deals have every canonical Won-gate field", () => {
    const audit = buildWonBillingAudit({
      dealFields: GATE_1_REQUIRED_FIELD_IDS.map((id) => field(id, `Gate field ${id}`)),
      wonDeals: [completeDeal()],
    });

    expect(audit.ok).toBe(true);
    expect(audit.dealsChecked).toBe(1);
    expect(audit.violations).toEqual([]);
  });

  it("flags a PSG Sales won deal with blank billing fields", () => {
    const blankId = GATE_1_REQUIRED_FIELD_IDS[0];
    const audit = buildWonBillingAudit({
      dealFields: GATE_1_REQUIRED_FIELD_IDS.map((id) => field(id, `Gate field ${id}`)),
      wonDeals: [
        completeDeal({
          id: 3935,
          title: "API bypass proof",
          [`field_${blankId}`]: " ",
        }),
      ],
    });

    expect(audit.ok).toBe(false);
    expect(audit.violationCount).toBe(1);
    expect(audit.violations).toEqual([
      {
        dealId: 3935,
        title: "API bypass proof",
        missingFields: [
          { id: blankId, key: `field_${blankId}`, name: `Gate field ${blankId}` },
        ],
      },
    ]);
  });

  it("ignores won deals outside the PSG Sales pipeline", () => {
    const audit = buildWonBillingAudit({
      dealFields: GATE_1_REQUIRED_FIELD_IDS.map((id) => field(id, `Gate field ${id}`)),
      wonDeals: [
        {
          id: 202,
          title: "Other pipeline won deal",
          pipeline_id: 99,
        },
      ],
    });

    expect(audit.ok).toBe(true);
    expect(audit.dealsChecked).toBe(0);
  });
});
