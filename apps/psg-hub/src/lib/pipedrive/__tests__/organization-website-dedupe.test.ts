import { describe, expect, it } from "vitest";

import {
  buildMarkdownReport,
  buildWebsiteDedupeReport,
  classifyOrganizationWebsite,
  isCopyableWebsiteValue,
  normalizeWebsite,
} from "../../../../scripts/pipedrive-organization-website-dedupe.mjs";

const keeper = { name: "Website", code: "website" };
const duplicate = {
  name: "Website",
  code: "6ea223d17fb76811dc47ae73d35610559621cf39",
};

describe("Pipedrive Organization Website dedupe", () => {
  it("normalizes harmless URL formatting differences", () => {
    expect(normalizeWebsite("https://www.Example.com/")).toBe("example.com");
  });

  it("classifies custom-only values as copy candidates", () => {
    expect(
      classifyOrganizationWebsite(
        {
          website: "",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "https://example.com",
        },
        { keptKey: keeper.code, duplicateKey: duplicate.code },
      ),
    ).toBe("copy");
  });

  it("flags multi-site and non-website custom-only values for manual review", () => {
    expect(isCopyableWebsiteValue("a.example, b.example")).toBe(false);
    expect(isCopyableWebsiteValue("Parkside Auto Body, Inc.")).toBe(false);
    expect(
      classifyOrganizationWebsite(
        {
          website: "",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "a.example, b.example",
        },
        { keptKey: keeper.code, duplicateKey: duplicate.code },
      ),
    ).toBe("needs_review");
  });

  it("does not flag matching values as conflicts", () => {
    expect(
      classifyOrganizationWebsite(
        {
          website: "https://example.com/",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "http://www.example.com",
        },
        { keptKey: keeper.code, duplicateKey: duplicate.code },
      ),
    ).toBe("same");
  });

  it("counts copy, conflict, already-safe, and blank rows", () => {
    const report = buildWebsiteDedupeReport({
      keeperField: keeper,
      duplicateField: duplicate,
      organizations: [
        {
          id: 1,
          name: "Copy Shop",
          website: null,
          "6ea223d17fb76811dc47ae73d35610559621cf39": "copy.example",
        },
        {
          id: 2,
          name: "Conflict Shop",
          website: "keeper.example",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "duplicate.example",
        },
        {
          id: 3,
          name: "Needs Review Shop",
          website: "",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "one.example, two.example",
        },
        {
          id: 4,
          name: "Same Shop",
          website: "https://same.example/",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "same.example",
        },
        {
          id: 5,
          name: "Keeper Shop",
          website: "keeper-only.example",
          "6ea223d17fb76811dc47ae73d35610559621cf39": "",
        },
        {
          id: 6,
          name: "Blank Shop",
          website: "",
          "6ea223d17fb76811dc47ae73d35610559621cf39": null,
        },
      ],
    });

    expect(report.counts).toMatchObject({
      totalOrganizations: 6,
      copy: 1,
      conflict: 1,
      needsReview: 1,
      same: 1,
      keeperOnly: 1,
      blank: 1,
    });
    expect(report.rows).toEqual([
      {
        id: 1,
        name: "Copy Shop",
        status: "copy",
        keptWebsite: null,
        duplicateWebsite: "copy.example",
      },
      {
        id: 2,
        name: "Conflict Shop",
        status: "conflict",
        keptWebsite: "keeper.example",
        duplicateWebsite: "duplicate.example",
      },
      {
        id: 3,
        name: "Needs Review Shop",
        status: "needs_review",
        keptWebsite: null,
        duplicateWebsite: "one.example, two.example",
      },
    ]);
    expect(report.archiveAllowed).toBe(false);
  });

  it("writes the archive guard into the markdown report", () => {
    const report = buildWebsiteDedupeReport({
      keeperField: keeper,
      duplicateField: duplicate,
      organizations: [],
    });

    expect(buildMarkdownReport(report)).toContain("Do not archive the duplicate Website field");
  });
});
