import { describe, it, expect } from "vitest";
import {
  CCC_CONNECTION_STATUSES,
  CCC_CONNECTION_STEPS,
  CCC_ONE_EXPORT_SCOPE,
  CONNECTION_PRESENTATION,
  CTA_LABELS,
  errorHint,
  formatLastEvent,
  formatRelative,
  type CtaKey,
} from "@/lib/ccc/connection-state";

// State → presentation mapping, asserted EXACTLY against the spec §2 table + §4 A″ wireframe.
describe("CONNECTION_PRESENTATION (state → presentation, spec §2)", () => {
  it("covers all five canonical states and nothing else", () => {
    expect(Object.keys(CONNECTION_PRESENTATION).sort()).toEqual(
      [...CCC_CONNECTION_STATUSES].sort(),
    );
    expect(CCC_CONNECTION_STATUSES).toHaveLength(5);
  });

  it("maps each state to the spec's primary CTA(s)", () => {
    const ctas = (s: keyof typeof CONNECTION_PRESENTATION): CtaKey[] =>
      CONNECTION_PRESENTATION[s].ctas;
    expect(ctas("not_connected")).toEqual(["get_steps"]);
    expect(ctas("pending_review")).toEqual(["cancel_request"]);
    expect(ctas("connected")).toEqual(["view_scope", "disconnect"]);
    expect(ctas("error")).toEqual(["reconnect", "view_scope"]);
    expect(ctas("declined")).toEqual(["request_again"]);
  });

  it("each state has a label, glyph, summary and a valid badge variant", () => {
    const validVariants = new Set(["secondary", "warning", "success", "destructive"]);
    for (const status of CCC_CONNECTION_STATUSES) {
      const p = CONNECTION_PRESENTATION[status];
      expect(p.status).toBe(status);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.glyph.length).toBeGreaterThan(0);
      expect(p.summary.length).toBeGreaterThan(0);
      expect(validVariants.has(p.badgeVariant)).toBe(true);
      // Every referenced CTA must have a human label.
      for (const cta of p.ctas) expect(CTA_LABELS[cta]).toBeTruthy();
    }
  });

  it("uses the documented status labels (no jargon)", () => {
    expect(CONNECTION_PRESENTATION.pending_review.label).toBe("Waiting on PSG");
    expect(CONNECTION_PRESENTATION.connected.label).toBe("Connected");
    expect(CONNECTION_PRESENTATION.error.label).toBe("Connection error");
  });
});

describe("errorHint (machine reason → human hint, spec §3.3/§5)", () => {
  it("maps known reasons to the documented hint", () => {
    expect(errorHint("auth_expired")).toContain("CCC authorization expired");
    expect(errorHint("sync_failed")).toContain("last sync");
    expect(errorHint("revoked_by_ccc")).toContain("revoked access");
  });

  it("falls back to a generic, actionable hint for unknown/empty reasons", () => {
    expect(errorHint("totally_unknown")).toContain("Reconnect");
    expect(errorHint(null)).toContain("Reconnect");
    expect(errorHint(undefined)).toContain("Reconnect");
  });
});

describe("formatRelative (pure, now injected)", () => {
  const now = new Date("2026-06-23T18:00:00Z");
  it("'just now' under a minute", () => {
    expect(formatRelative("2026-06-23T17:59:30Z", now)).toBe("just now");
  });
  it("minutes", () => {
    expect(formatRelative("2026-06-23T17:57:00Z", now)).toBe("3 min ago");
  });
  it("hours", () => {
    expect(formatRelative("2026-06-23T16:00:00Z", now)).toBe("2 hr ago");
  });
  it("older than a day → a short date", () => {
    const out = formatRelative("2026-06-20T09:00:00Z", now);
    expect(out).not.toContain("ago");
    expect(out.length).toBeGreaterThan(0);
  });
  it("invalid timestamp → empty string", () => {
    expect(formatRelative("not-a-date", now)).toBe("");
  });
});

describe("formatLastEvent (spec §4 A″ 'Last event…' line)", () => {
  const now = new Date("2026-06-23T18:00:00Z");
  it("label + relative time", () => {
    expect(
      formatLastEvent(
        { lastEventLabel: "Workfile saved", lastEventAt: "2026-06-23T17:57:00Z" },
        now,
      ),
    ).toBe("Workfile saved · 3 min ago");
  });
  it("label only (no timestamp)", () => {
    expect(
      formatLastEvent({ lastEventLabel: "Workfile saved", lastEventAt: null }, now),
    ).toBe("Workfile saved");
  });
  it("timestamp only (no label)", () => {
    expect(
      formatLastEvent({ lastEventLabel: null, lastEventAt: "2026-06-23T17:57:00Z" }, now),
    ).toBe("3 min ago");
  });
  it("neither → null (so the card omits the line)", () => {
    expect(formatLastEvent({ lastEventLabel: null, lastEventAt: null }, now)).toBeNull();
  });
});

describe("CCC_ONE_EXPORT_SCOPE fixture (documented CCC ONE export scope, spec §4 C)", () => {
  it("is data-driven and grounded in the export guide", () => {
    expect(CCC_ONE_EXPORT_SCOPE.received.length).toBeGreaterThanOrEqual(6);
    const labels = CCC_ONE_EXPORT_SCOPE.received.map((f) => f.label).join(" | ");
    expect(labels).toContain("Customer name & mailing address");
    expect(labels).toContain("Repair $ amount");
    // Optional fields are flagged so the panel can soften them.
    expect(CCC_ONE_EXPORT_SCOPE.received.some((f) => f.optional)).toBe(true);
    // Exclusions name banking + open estimates (the consent guarantee).
    expect(CCC_ONE_EXPORT_SCOPE.excluded.join(" ")).toMatch(/banking|open estimates/);
    expect(CCC_ONE_EXPORT_SCOPE.assurance).toContain("disconnect");
  });
});

describe("CCC_CONNECTION_STEPS fixture (spec §4 A′)", () => {
  it("lists the enable steps and carries the Phase-0 menu-path placeholder", () => {
    expect(CCC_CONNECTION_STEPS.length).toBe(4);
    expect(CCC_CONNECTION_STEPS[0]).toContain("Phase 0");
    expect(CCC_CONNECTION_STEPS.join(" ")).toContain("Phoenix Solutions Group");
  });
});
