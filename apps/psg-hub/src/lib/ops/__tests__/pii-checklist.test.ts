import { describe, expect, it } from "vitest";
import {
  PII_CHECKLIST,
  PII_STATUS_LABELS,
  piiStatusCounts,
  type PiiStatus,
} from "@/lib/ops/pii-checklist";

const VALID: PiiStatus[] = ["in_place", "partial", "todo"];

describe("PII_CHECKLIST integrity", () => {
  it("has unique ids and valid statuses", () => {
    const ids = new Set<string>();
    for (const c of PII_CHECKLIST) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(VALID).toContain(c.status);
      expect(c.surface.length).toBeGreaterThan(0);
      expect(c.control.length).toBeGreaterThan(0);
      expect(c.evidence.length).toBeGreaterThan(0);
    }
  });
  it("labels every status", () => {
    for (const s of VALID) expect(PII_STATUS_LABELS[s].length).toBeGreaterThan(0);
  });
});

describe("piiStatusCounts", () => {
  it("counts add up to the list length", () => {
    const counts = piiStatusCounts();
    const total = counts.in_place + counts.partial + counts.todo;
    expect(total).toBe(PII_CHECKLIST.length);
  });
  it("counts a supplied list", () => {
    const counts = piiStatusCounts([
      { id: "a", surface: "s", control: "c", status: "in_place", evidence: "e" },
      { id: "b", surface: "s", control: "c", status: "todo", evidence: "e" },
    ]);
    expect(counts).toEqual({ in_place: 1, partial: 0, todo: 1 });
  });
});
