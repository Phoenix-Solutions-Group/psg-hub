import { describe, expect, it } from "vitest";
import { filterCompaniesByWord, type CompanySearchRow } from "@/lib/ops/company-search";

const companies: CompanySearchRow[] = [
  {
    name: "Wallace Collision Center",
    contact: "Maya Rivera",
    phone: "555-0101",
    status: "active",
  },
  {
    name: "Tedesco Auto Body",
    contact: "Nick Barnes",
    phone: "555-0102",
    status: "active",
  },
];

describe("filterCompaniesByWord", () => {
  it("matches full shop words without requiring internal IDs", () => {
    expect(filterCompaniesByWord(companies, "Collision")).toEqual([companies[0]]);
    expect(filterCompaniesByWord(companies, "wallace collision")).toEqual([companies[0]]);
  });

  it("matches contact and phone words for admin cleanup", () => {
    expect(filterCompaniesByWord(companies, "Nick")).toEqual([companies[1]]);
    expect(filterCompaniesByWord(companies, "0101")).toEqual([companies[0]]);
  });

  it("returns all rows for blank searches", () => {
    expect(filterCompaniesByWord(companies, "   ")).toEqual(companies);
  });
});
