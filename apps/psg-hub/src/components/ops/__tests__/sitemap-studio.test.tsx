import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SitemapStudio,
  parseRunResponse,
  buildDecisionPayload,
  decisionErrorMessage,
  deriveSteps,
  readGate1Summary,
  readGate2Summary,
  pageTypeLabel,
  type SitemapShopOption,
} from "@/components/ops/sitemap-studio";

const shops = (n: number): SitemapShopOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Shop ${i + 1}` }));

describe("parseRunResponse (pure run-state mapping)", () => {
  it("complete → fetch-the-deliverable signal", () => {
    expect(parseRunResponse(200, true, { status: "complete" })).toEqual({ kind: "complete" });
  });

  it("202 awaiting_approval → awaiting, carrying phase + contentHash for the decision", () => {
    const r = parseRunResponse(202, false, {
      status: "awaiting_approval",
      phase: "clusters_page_types",
      contentHash: "hash-A",
      summary: { clusterCount: 3 },
    });
    expect(r).toEqual({
      kind: "awaiting",
      phase: "clusters_page_types",
      summary: { clusterCount: 3 },
      contentHash: "hash-A",
    });
  });

  it("409 changes_requested → changes with the notes", () => {
    expect(
      parseRunResponse(409, false, { status: "changes_requested", phase: "package_handoff", notes: "redo" }),
    ).toEqual({ kind: "changes", phase: "package_handoff", notes: "redo" });
  });

  it("403/5xx → error surfacing the route message or a status fallback", () => {
    expect(parseRunResponse(403, false, { error: "Forbidden" })).toEqual({ kind: "error", message: "Forbidden" });
    const s = parseRunResponse(500, false, null);
    expect(s.kind === "error" && s.message).toContain("500");
  });
});

describe("buildDecisionPayload (pure)", () => {
  it("approve drops notes even if a draft note was typed", () => {
    expect(
      buildDecisionPayload({
        shopId: "s1",
        phase: "clusters_page_types",
        contentHash: "h",
        decision: "approved",
        changeNotes: "ignored on approve",
      }),
    ).toEqual({ shopId: "s1", phase: "clusters_page_types", contentHash: "h", decision: "approved", notes: null });
  });

  it("changes_requested trims notes; blank → null", () => {
    expect(
      buildDecisionPayload({ shopId: "s1", phase: "x", contentHash: "h", decision: "changes_requested", changeNotes: "  fix it  " }).notes,
    ).toBe("fix it");
    expect(
      buildDecisionPayload({ shopId: "s1", phase: "x", contentHash: "h", decision: "changes_requested", changeNotes: "   " }).notes,
    ).toBeNull();
  });
});

describe("decisionErrorMessage (pure)", () => {
  it("prefers the route message, then error, then a status fallback", () => {
    expect(decisionErrorMessage(409, { message: "stale!" })).toBe("stale!");
    expect(decisionErrorMessage(409, { error: "already_decided" })).toBe("already_decided");
    expect(decisionErrorMessage(500, null)).toContain("500");
  });
});

describe("deriveSteps (pure stepper spine — PSG-377 §5)", () => {
  const statuses = (s: { kind: string; phase?: string }) => deriveSteps(s).map((x) => x.status);

  it("idle → all not_started", () => {
    expect(statuses({ kind: "idle" })).toEqual(["not_started", "not_started", "not_started"]);
  });

  it("loading (no phase) → gate 1 running", () => {
    expect(statuses({ kind: "loading" })).toEqual(["running", "not_started", "not_started"]);
  });

  it("loading toward package → gate 1 done, gate 2 running", () => {
    expect(statuses({ kind: "loading", phase: "package_handoff" })).toEqual(["done", "running", "not_started"]);
  });

  it("awaiting gate 1 → in_review; awaiting gate 2 → gate 1 done", () => {
    expect(statuses({ kind: "awaiting", phase: "clusters_page_types" })).toEqual([
      "in_review",
      "not_started",
      "not_started",
    ]);
    expect(statuses({ kind: "awaiting", phase: "package_handoff" })).toEqual([
      "done",
      "in_review",
      "not_started",
    ]);
  });

  it("changes at a gate → that node changes_requested, earlier done", () => {
    expect(statuses({ kind: "changes", phase: "package_handoff" })).toEqual([
      "done",
      "changes_requested",
      "not_started",
    ]);
  });

  it("complete → whole spine done (all green)", () => {
    expect(statuses({ kind: "complete" })).toEqual(["done", "done", "done"]);
  });

  it("labels are fixed across the three nodes", () => {
    expect(deriveSteps({ kind: "idle" }).map((s) => s.label)).toEqual([
      "Clusters & page types",
      "Final package",
      "Complete",
    ]);
  });
});

describe("pageTypeLabel (pure — never raw enum, PSG-259 CR-2)", () => {
  it("maps known enums to friendly labels", () => {
    expect(pageTypeLabel("service")).toBe("Service");
    expect(pageTypeLabel("local")).toBe("Local (city)");
    expect(pageTypeLabel("transactional")).toBe("Convert");
    expect(pageTypeLabel("informational")).toBe("Inform");
  });

  it("title-cases unknown tokens; blanks → em dash", () => {
    expect(pageTypeLabel("product_listing")).toBe("Product Listing");
    expect(pageTypeLabel("")).toBe("—");
    expect(pageTypeLabel(undefined)).toBe("—");
  });
});

describe("readGate1Summary (pure — KPI chips + table view, NO raw JSON)", () => {
  it("projects counts + per-page rows with friendly page types", () => {
    const view = readGate1Summary({
      clusterCount: 57,
      inventoryCount: 12,
      clusters: [
        { label: "Collision Repair", pageType: "service", keywords: 29 },
        { label: "Lincoln Collision", pageType: "local", keywords: 4 },
      ],
    });
    expect(view).toEqual({
      clusterCount: 57,
      proposedPages: 2,
      inventoryCount: 12,
      rows: [
        { label: "Collision Repair", pageType: "Service", keywords: 29 },
        { label: "Lincoln Collision", pageType: "Local (city)", keywords: 4 },
      ],
    });
  });

  it("degrades quietly on missing/garbage fields", () => {
    const view = readGate1Summary({ clusters: [{ keywords: "x" }] });
    expect(view.clusterCount).toBe(0);
    expect(view.inventoryCount).toBe(0);
    expect(view.rows[0]).toEqual({ label: "—", pageType: "—", keywords: 0 });
  });
});

describe("readGate2Summary (pure — package KPI + validation chip)", () => {
  it("projects business/page/calendar/validation", () => {
    expect(
      readGate2Summary({ businessName: "Riverside Collision", pageCount: 24, calendarEntries: 12, validationOk: true }),
    ).toEqual({ businessName: "Riverside Collision", pageCount: 24, calendarEntries: 12, validationOk: true });
  });

  it("validationOk is strict-true only; missing → false + em-dash name", () => {
    expect(readGate2Summary({}).validationOk).toBe(false);
    expect(readGate2Summary({ validationOk: "yes" }).validationOk).toBe(false);
    expect(readGate2Summary({}).businessName).toBe("—");
  });
});

describe("SitemapStudio render branches", () => {
  it("no shops: empty-state, no picker/run control", () => {
    const html = renderToStaticMarkup(<SitemapStudio shops={[]} />);
    expect(html).toContain("No shops are available yet");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Run pipeline");
  });

  it("with shops, idle: sign-off notice + picker + run + 3-node stepper; no decision/JSON/iframe", () => {
    const html = renderToStaticMarkup(<SitemapStudio shops={shops(2)} />);
    expect(html).toContain("Two human sign-offs");
    expect(html).toContain('aria-label="Shop"');
    expect((html.match(/<option/g) ?? []).length).toBe(2);
    expect(html).toContain("Run pipeline");
    // Stepper spine is always present (where am I / what's left).
    expect(html).toContain("Step 1");
    expect(html).toContain("Final package");
    expect(html).toContain("Not started");
    // Idle hides decision controls + deliverable, and NEVER dumps raw JSON.
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Request changes");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<pre");
  });
});
