import { describe, it, expect } from "vitest";
import {
  ROLE_LABELS,
  templateTaskCount,
  type OnboardingRole,
} from "../onboarding-template";
import { NEW_WEBSITE_BUILD_TEMPLATE } from "../web-build-template";

// PSG-668 — the New Website Build template is a faithful transcription of PSG-650's
// board-approved `web-build-template` doc: 4 phases, 22 tasks, 4 gates, roles AS/UX/Web/QA.
// NOTE: the PSG-650 doc's prose headline (and the PSG-668/PSG-672 spec) say "23 tasks",
// but the doc's actual task table sums to 22 (6 + 5 + 6 + 5). We transcribe the table
// verbatim (the authoritative graph) — the "23" headline is a source miscount flagged to
// PMO/CTO on PSG-672. This test asserts the TRUE transcribed shape.
describe("NEW_WEBSITE_BUILD_TEMPLATE (PSG-650 transcription)", () => {
  it("has exactly 4 phases keyed P1..P4", () => {
    expect(NEW_WEBSITE_BUILD_TEMPLATE.length).toBe(4);
    expect(NEW_WEBSITE_BUILD_TEMPLATE.map((p) => p.key)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  it("has 22 tasks (6 + 5 + 6 + 5) matching the doc's task table verbatim", () => {
    expect(NEW_WEBSITE_BUILD_TEMPLATE.map((p) => p.tasks.length)).toEqual([6, 5, 6, 5]);
    expect(templateTaskCount(NEW_WEBSITE_BUILD_TEMPLATE)).toBe(22);
  });

  it("uses only roles that exist in the typed model (incl. the PSG-668 UX/QA roles)", () => {
    const allowed = new Set(Object.keys(ROLE_LABELS) as OnboardingRole[]);
    const used = new Set<OnboardingRole>();
    for (const phase of NEW_WEBSITE_BUILD_TEMPLATE) {
      for (const t of phase.tasks) {
        expect(allowed.has(t.owner)).toBe(true);
        used.add(t.owner);
      }
    }
    // The doc's four roles are all exercised.
    expect(used).toEqual(new Set<OnboardingRole>(["AS", "UX", "Web", "QA"]));
  });

  it("marks the four hard gates (one per phase) and gates are QA/AS owned", () => {
    const gates = NEW_WEBSITE_BUILD_TEMPLATE.flatMap((p) =>
      p.tasks.filter((t) => t.gate),
    );
    expect(gates.length).toBe(4);
    // Every phase has exactly one gate.
    for (const phase of NEW_WEBSITE_BUILD_TEMPLATE) {
      expect(phase.tasks.filter((t) => t.gate).length).toBe(1);
    }
    for (const g of gates) expect(["AS", "QA"]).toContain(g.owner);
  });

  it("every task carries a title, owner, and a non-negative day-offset; offsets run 2..63", () => {
    const offsets: number[] = [];
    for (const phase of NEW_WEBSITE_BUILD_TEMPLATE) {
      for (const t of phase.tasks) {
        expect(t.title.trim().length).toBeGreaterThan(0);
        expect(typeof t.owner).toBe("string");
        expect(Number.isInteger(t.dayOffset)).toBe(true);
        expect(t.dayOffset).toBeGreaterThanOrEqual(0);
        offsets.push(t.dayOffset);
      }
    }
    expect(Math.min(...offsets)).toBe(2); // kick-off, Day 2
    expect(Math.max(...offsets)).toBe(63); // project-done gate, Day 63
  });
});
