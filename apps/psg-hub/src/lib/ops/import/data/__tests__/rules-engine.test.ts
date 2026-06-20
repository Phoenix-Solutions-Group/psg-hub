// PSG-132 — Tests for the ported import rules engine.

import { describe, it, expect } from "vitest";
import { applyRules, DEFAULT_FLEET_KEYWORDS } from "@/lib/ops/import/data/rules-engine";
import type { Row } from "@/lib/ops/import/data/types";

const row = (r: Partial<Record<string, string>>): Row => ({ ...r }) as Row;

describe("applyRules — fleet/commercial detection", () => {
  it("routes keyword-matched owners to errors and keeps real customers clean", () => {
    const { clean, errors } = applyRules([
      row({ OwnerCompanyName: "Enterprise Rent-A-Car", OwnerAddress1: "1 Fleet Way" }),
      row({ OwnerFName: "John", OwnerLName: "Doe", OwnerAddress1: "123 Main St" }),
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].OwnerLName).toBe("Doe");
    expect(errors).toHaveLength(1);
    expect(errors[0]._errorReason).toBe("Fleet/Commercial detected");
  });

  it("flags a company-only row (no personal name) when it matches a keyword", () => {
    const { clean, errors } = applyRules([
      row({ OwnerCompanyName: "Acme Leasing LLC" }),
    ]);
    expect(clean).toHaveLength(0);
    expect(errors[0]._errorReason).toBe("Fleet/Commercial detected");
  });

  it("exposes the default keyword list and honors a custom override", () => {
    expect(DEFAULT_FLEET_KEYWORDS).toContain("rental");
    const { clean, errors } = applyRules(
      [row({ OwnerFName: "Globex", OwnerCompanyName: "Globex Widgets" })],
      ["widgets"],
    );
    expect(clean).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

describe("applyRules — ampersand handling", () => {
  it("decodes HTML-entity ampersands and rewrites '&' to 'and'", () => {
    const { clean } = applyRules([
      row({ OwnerFName: "Tom", OwnerLName: "Smith &amp; Jones", OwnerAddress1: "9 Oak St" }),
    ]);
    expect(clean[0].OwnerLName).toBe("Smith and Jones");
    expect(clean[0]._nameContainedAmpersand).toBe("true");
  });
});

describe("applyRules — deduplication", () => {
  it("keeps the row with the newer DeliveredDate and errors the older duplicate", () => {
    const base = { OwnerFName: "Jane", OwnerLName: "Roe", OwnerAddress1: "5 Elm St", OwnerHomePhone: "(555) 111-2222" };
    const { clean, errors } = applyRules([
      row({ ...base, DeliveredDate: "2024-01-15" }),
      row({ ...base, DeliveredDate: "2024-08-01" }),
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].DeliveredDate).toBe("2024-08-01");
    expect(errors).toHaveLength(1);
    expect(errors[0].DeliveredDate).toBe("2024-01-15");
    expect(errors[0]._errorReason).toBe("Duplicate (older record)");
  });

  it("keeps distinct records (different addresses are not duplicates)", () => {
    const { clean, errors } = applyRules([
      row({ OwnerFName: "Al", OwnerLName: "Vee", OwnerAddress1: "1 A St", OwnerHomePhone: "5550000001" }),
      row({ OwnerFName: "Al", OwnerLName: "Vee", OwnerAddress1: "2 B St", OwnerHomePhone: "5550000002" }),
    ]);
    expect(clean).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });
});
