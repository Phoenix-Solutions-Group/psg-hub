// PSG-132 — Sanity tests for the master source-header alias map.

import { describe, it, expect } from "vitest";
import { MASTER_HEADER_MAPPINGS } from "@/lib/ops/import/data/header-mappings";

describe("MASTER_HEADER_MAPPINGS", () => {
  it("maps key canonical-38 fields onto their expected source-header aliases", () => {
    expect(MASTER_HEADER_MAPPINGS.OwnerFName).toContain("First Name");
    expect(MASTER_HEADER_MAPPINGS.OwnerLName).toContain("Last Name");
    expect(MASTER_HEADER_MAPPINGS.VehicleMake).toContain("Make");
    expect(MASTER_HEADER_MAPPINGS.VehicleModel).toContain("Model");
    expect(MASTER_HEADER_MAPPINGS.BusinessKeyPSG).toContain("PSGID");
  });

  it("uses non-empty string[] alias lists for every canonical field", () => {
    const entries = Object.entries(MASTER_HEADER_MAPPINGS);
    expect(entries.length).toBeGreaterThan(20);
    for (const [key, aliases] of entries) {
      expect(Array.isArray(aliases), `${key} should map to an array`).toBe(true);
      expect(aliases.length, `${key} should have at least one alias`).toBeGreaterThan(0);
      for (const alias of aliases) {
        expect(typeof alias).toBe("string");
        expect(alias.length).toBeGreaterThan(0);
      }
    }
  });
});
