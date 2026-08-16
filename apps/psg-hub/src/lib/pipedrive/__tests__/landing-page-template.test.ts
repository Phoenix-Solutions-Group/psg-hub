import { describe, it, expect } from "vitest";
import {
  ROLE_LABELS,
  templateTaskCount,
  type OnboardingRole,
} from "../onboarding-template";
import { LANDING_PAGE_TEMPLATE } from "../landing-page-template";

// PSG-655 / PSG-2814 — Landing Page / Campaign Page live template transcription.
describe("LANDING_PAGE_TEMPLATE (PSG-655 transcription)", () => {
  it("has exactly 4 phases keyed P1..P4", () => {
    expect(LANDING_PAGE_TEMPLATE.length).toBe(4);
    expect(LANDING_PAGE_TEMPLATE.map((p) => p.key)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  it("has 17 tasks (4 + 4 + 4 + 5) matching the signed-off task table", () => {
    expect(LANDING_PAGE_TEMPLATE.map((p) => p.tasks.length)).toEqual([4, 4, 4, 5]);
    expect(templateTaskCount(LANDING_PAGE_TEMPLATE)).toBe(17);
  });

  it("uses only roles that exist in the typed model", () => {
    const allowed = new Set(Object.keys(ROLE_LABELS) as OnboardingRole[]);
    const used = new Set<OnboardingRole>();
    for (const phase of LANDING_PAGE_TEMPLATE) {
      for (const task of phase.tasks) {
        expect(allowed.has(task.owner)).toBe(true);
        used.add(task.owner);
      }
    }
    expect(used).toEqual(new Set<OnboardingRole>(["AS", "UX", "Web", "QA"]));
  });

  it("marks the four hard gates (one per phase) and gates are QA/AS owned", () => {
    const gates = LANDING_PAGE_TEMPLATE.flatMap((p) => p.tasks.filter((t) => t.gate));
    expect(gates.length).toBe(4);
    for (const phase of LANDING_PAGE_TEMPLATE) {
      expect(phase.tasks.filter((t) => t.gate).length).toBe(1);
    }
    for (const gate of gates) expect(["AS", "QA"]).toContain(gate.owner);
  });

  it("every task carries a title, owner, and a non-negative day-offset; offsets run 1..18", () => {
    const offsets: number[] = [];
    for (const phase of LANDING_PAGE_TEMPLATE) {
      for (const task of phase.tasks) {
        expect(task.title.trim().length).toBeGreaterThan(0);
        expect(typeof task.owner).toBe("string");
        expect(Number.isInteger(task.dayOffset)).toBe(true);
        expect(task.dayOffset).toBeGreaterThanOrEqual(0);
        offsets.push(task.dayOffset);
      }
    }
    expect(Math.min(...offsets)).toBe(1);
    expect(Math.max(...offsets)).toBe(18);
  });
});
