import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SitemapStudio,
  parseRunResponse,
  buildDecisionPayload,
  decisionErrorMessage,
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
    expect(parseRunResponse(409, false, { status: "changes_requested", phase: "package_handoff", notes: "redo" })).toEqual(
      { kind: "changes", phase: "package_handoff", notes: "redo" },
    );
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

describe("SitemapStudio render branches", () => {
  it("no shops: empty-state, no picker/run control", () => {
    const html = renderToStaticMarkup(<SitemapStudio shops={[]} />);
    expect(html).toContain("No shops are available yet");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Run pipeline");
  });

  it("with shops: two-sign-off notice + picker + run button, idle hides decision controls", () => {
    const html = renderToStaticMarkup(<SitemapStudio shops={shops(2)} />);
    expect(html).toContain("Two human sign-offs required");
    expect(html).toContain('aria-label="Shop"');
    expect((html.match(/<option/g) ?? []).length).toBe(2);
    expect(html).toContain("Run pipeline");
    // Idle: the awaiting decision controls + deliverable are not rendered yet.
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Request changes");
    expect(html).not.toContain("<iframe");
  });
});
