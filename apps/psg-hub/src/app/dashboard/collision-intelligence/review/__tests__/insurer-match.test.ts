import { describe, expect, it } from "vitest";
import {
  findInsurerNameMatches,
  groupRegistryMatches,
  includeFocusedAlias,
} from "../insurer-match";

const insurers = [
  { label: "Progressive Insurance Company", value: "progressive" },
  { label: "USAA Insurance Company", value: "usaa" },
  { label: "United Services Automobile Association", value: "usaa-legal" },
];

describe("insurer name matching", () => {
  it("matches spaced abbreviations to existing PSG names", () => {
    expect(findInsurerNameMatches(insurers, "U S A A")[0]).toEqual({
      label: "USAA Insurance Company",
      value: "usaa",
    });
  });

  it("matches a partial company name and returns no unrelated names", () => {
    expect(findInsurerNameMatches(insurers, "Progressive")).toEqual([
      insurers[0],
    ]);
  });

  it("keeps a requested saved alias visible outside the ranked queue", () => {
    const ranked = [
      { source_label_normalized: "progressive", review_status: "candidate" },
    ];
    const focused = {
      source_label_normalized: "u s a a",
      review_status: "approved",
    };

    expect(includeFocusedAlias(ranked, focused)).toEqual([focused, ...ranked]);
  });

  it("does not present weak registry names as usable matches", () => {
    const strong = { label: "USAA", match_score: 100 };
    const possible = { label: "United Auto", match_score: 74 };
    const unrelated = { label: "Essilorluxottica USA", match_score: 60 };

    expect(groupRegistryMatches([strong, possible, unrelated])).toEqual({
      strong: [strong],
      possible: [possible],
    });
  });
});
