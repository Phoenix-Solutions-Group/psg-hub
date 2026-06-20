// PSG-132 — Tests for USPS suffix expansion + address unit extraction.

import { describe, it, expect } from "vitest";
import { expandStreetSuffix, extractUnit } from "@/lib/ops/import/data/address-units";

describe("expandStreetSuffix — USPS suffix/directional expansion", () => {
  it("expands suffix abbreviations to long form (case-insensitive, period-tolerant)", () => {
    expect(expandStreetSuffix("St")).toBe("Street");
    expect(expandStreetSuffix("AVE")).toBe("Avenue");
    expect(expandStreetSuffix("blvd.")).toBe("Boulevard");
    expect(expandStreetSuffix("pkwy")).toBe("Parkway");
  });

  it("expands directional abbreviations to long form", () => {
    expect(expandStreetSuffix("N")).toBe("North");
    expect(expandStreetSuffix("sw")).toBe("Southwest");
  });

  it("returns the original token when it is not a recognized abbreviation", () => {
    expect(expandStreetSuffix("Main")).toBe("Main");
    expect(expandStreetSuffix("")).toBe("");
  });
});

describe("extractUnit — secondary-unit extraction", () => {
  it("splits a designator unit off the end of the street line", () => {
    expect(extractUnit("123 Main St Apt 4B")).toEqual({ street: "123 Main St", unit: "Apt 4B" });
    expect(extractUnit("100 Elm St Suite 200")).toEqual({ street: "100 Elm St", unit: "Suite 200" });
  });

  it("splits a hash-form unit off the end of the street line", () => {
    expect(extractUnit("456 Oak Ave #12")).toEqual({ street: "456 Oak Ave", unit: "#12" });
  });

  it("collapses internal whitespace before extracting", () => {
    expect(extractUnit("  789   Pine   Rd   Unit 7 ")).toEqual({ street: "789 Pine Rd", unit: "Unit 7" });
  });

  it("returns an empty unit when there is no trailing designator", () => {
    expect(extractUnit("321 Cedar Rd")).toEqual({ street: "321 Cedar Rd", unit: "" });
    expect(extractUnit("   ")).toEqual({ street: "", unit: "" });
  });
});
