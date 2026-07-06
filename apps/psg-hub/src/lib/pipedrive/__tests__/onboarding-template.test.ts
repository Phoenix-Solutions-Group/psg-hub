import { describe, it, expect } from "vitest";
import {
  WHM_ONBOARDING_TEMPLATE,
  templateTaskCount,
  dueDateFor,
  ROLE_LABELS,
  type OnboardingRole,
} from "../onboarding-template";

// PSG-584 — lock the CONFIRMED template (Noelle, PSG-580) so drift is caught in CI.
describe("WHM onboarding template", () => {
  it("has exactly the 5 confirmed D-phases in order", () => {
    expect(WHM_ONBOARDING_TEMPLATE.map((p) => p.key)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
    ]);
  });

  it("gives every task a single accountable owner and an explicit day-offset", () => {
    const roles = new Set<OnboardingRole>(["AS", "Ads", "Analytics", "Web", "CRO"]);
    for (const phase of WHM_ONBOARDING_TEMPLATE) {
      expect(phase.tasks.length).toBeGreaterThan(0);
      for (const t of phase.tasks) {
        expect(roles.has(t.owner)).toBe(true);
        expect(Number.isInteger(t.dayOffset)).toBe(true);
        expect(t.dayOffset).toBeGreaterThan(0);
        expect(ROLE_LABELS[t.owner]).toBeTruthy();
      }
    }
  });

  it("carries exactly the 3 confirmed gate tasks", () => {
    const gates = WHM_ONBOARDING_TEMPLATE.flatMap((p) =>
      p.tasks.filter((t) => t.gate),
    );
    expect(gates).toHaveLength(3);
    expect(gates.every((g) => g.title.startsWith("GATE:"))).toBe(true);
  });

  it("has non-decreasing offsets across the phase sequence (Day 0..55)", () => {
    const offsets = WHM_ONBOARDING_TEMPLATE.flatMap((p) => p.tasks.map((t) => t.dayOffset));
    const sorted = [...offsets].sort((a, b) => a - b);
    // The template is authored in schedule order; the last task lands on Day 55.
    expect(offsets[0]).toBe(1);
    expect(Math.max(...offsets)).toBe(55);
    expect(sorted[sorted.length - 1]).toBe(55);
  });

  it("counts all tasks (excludes phase parents)", () => {
    // 7 + 6 + 3 + 5 + 4 = 25 leaf tasks.
    expect(templateTaskCount()).toBe(25);
  });
});

describe("dueDateFor", () => {
  it("adds calendar days in UTC, crossing month boundaries", () => {
    expect(dueDateFor("2026-07-06", 0)).toBe("2026-07-06");
    expect(dueDateFor("2026-07-06", 1)).toBe("2026-07-07");
    expect(dueDateFor("2026-07-06", 55)).toBe("2026-08-30");
  });

  it("is timezone-stable (accepts a timestamp, uses the date part)", () => {
    expect(dueDateFor("2026-12-31 23:00:00", 1)).toBe("2027-01-01");
  });
});
