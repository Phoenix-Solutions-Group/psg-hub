import { describe, it, expect } from "vitest";
import { emiPctToFraction, formatEmi, SURVEY_SCORE_FIELDS } from "../surveys";

// Guards the one piece of schema coordination PSG-36 had to get right:
// scale_emi_pct is a 0..1 fraction, but the UI works in 0..100 percentages.
// network_summary alerts when AVG(scale_emi_pct)*100 < 88.

describe("emiPctToFraction", () => {
  it("converts a human percentage to the stored 0..1 fraction", () => {
    expect(emiPctToFraction(95)).toBeCloseTo(0.95, 10);
    expect(emiPctToFraction(88)).toBeCloseTo(0.88, 10);
    expect(emiPctToFraction(0)).toBe(0);
    expect(emiPctToFraction(100)).toBe(1);
  });

  it("passes null/undefined through unchanged", () => {
    expect(emiPctToFraction(null)).toBeNull();
    expect(emiPctToFraction(undefined)).toBeNull();
  });
});

describe("formatEmi", () => {
  it("renders a stored fraction as a 1dp percentage", () => {
    expect(formatEmi(0.95)).toBe("95.0%");
    expect(formatEmi(0.877)).toBe("87.7%");
    expect(formatEmi(1)).toBe("100.0%");
  });

  it("renders a dash for missing values", () => {
    expect(formatEmi(null)).toBe("—");
    expect(formatEmi(undefined)).toBe("—");
  });

  it("round-trips with emiPctToFraction", () => {
    expect(formatEmi(emiPctToFraction(92.4))).toBe("92.4%");
  });
});

describe("SURVEY_SCORE_FIELDS", () => {
  it("maps q05_01..04 to the shop_detail sub-scores in order", () => {
    expect(SURVEY_SCORE_FIELDS.map((f) => [f.column, f.label])).toEqual([
      ["q05_01", "Quality"],
      ["q05_02", "Cleanliness"],
      ["q05_03", "Communication"],
      ["q05_04", "Courtesy"],
    ]);
  });
});
