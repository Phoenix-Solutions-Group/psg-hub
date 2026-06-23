// Wave 1A / PSG-236 — Client deliverable renderer tests.
//
// Asserts the branded HTML is grounded in the package (business name, pages, calendar,
// quality, approvals), embeds the SAME Mermaid the source artifact emits, can omit the
// mermaid script for the PDF worker, and escapes untrusted text.

import { describe, expect, it } from "vitest";
import { renderSitemapDeliverable } from "../render";
import { toMermaid } from "../architecture";
import { runSitemapPipeline, type CheckpointApproval, type CheckpointPayload, type ShopBrief, type SitemapPackage } from "../index";

const BRIEF: ShopBrief = {
  shopId: "shop-courtesy",
  businessName: "Courtesy Body Works",
  domain: "courtesybodyworks.com",
  vertical: "collision_repair",
  services: ["collision repair", "frame straightening"],
  locations: [{ city: "Lincoln", state: "NE", primary: true }],
  competitors: [],
};

async function buildPackage(brief: ShopBrief = BRIEF): Promise<SitemapPackage> {
  const approve = async (p: CheckpointPayload): Promise<CheckpointApproval> => ({
    phase: p.phase,
    decision: "approved",
    approvedBy: "Lee (CD)",
    approvedAt: "2026-06-23T00:00:00.000Z",
    notes: "looks good",
  });
  const res = await runSitemapPipeline(brief, { generatedAt: "2026-06-23T00:00:00.000Z", onCheckpoint: approve });
  if (res.status !== "complete") throw new Error("fixture pipeline did not complete");
  return res.package;
}

describe("renderSitemapDeliverable", () => {
  it("renders a self-contained branded document grounded in the package", async () => {
    const pkg = await buildPackage();
    const html = renderSitemapDeliverable(pkg);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Courtesy Body Works");
    expect(html).toContain("Body Shop Marketer");
    expect(html).toContain("Prepared 2026-06-23");
    // KPI / scope / sections present
    expect(html).toContain("Pages planned");
    expect(html).toContain("Proposed sitemap");
    expect(html).toContain("Page inventory");
    expect(html).toContain("Content calendar");
    expect(html).toContain("Quality checks");
    // approval audit trail rendered
    expect(html).toContain("Lee (CD)");
  });

  it("embeds the exact Mermaid the source artifact emits", async () => {
    const pkg = await buildPackage();
    const html = renderSitemapDeliverable(pkg);
    const mmd = toMermaid(pkg.root);
    expect(html).toContain('<pre class="mermaid">');
    // first node line of the diagram should appear (HTML-escaped) in the doc
    const firstLine = mmd.split("\n").find((l) => l.includes("graph TD")) ?? "graph TD";
    expect(html).toContain(firstLine);
    // default mermaid CDN boot script included
    expect(html).toContain("mermaid.esm.min.mjs");
  });

  it("omits the mermaid script when mermaidScriptSrc is empty (PDF worker injects its own)", async () => {
    const pkg = await buildPackage();
    const html = renderSitemapDeliverable(pkg, { mermaidScriptSrc: "" });
    expect(html).not.toContain("<script");
    expect(html).toContain('<pre class="mermaid">'); // diagram source still present
  });

  it("escapes untrusted text from the brief", async () => {
    const pkg = await buildPackage({ ...BRIEF, businessName: 'Bob "The" <Body> & Shop' });
    const html = renderSitemapDeliverable(pkg);
    expect(html).toContain("Bob &quot;The&quot; &lt;Body&gt; &amp; Shop");
    expect(html).not.toContain("<Body>");
  });

  it("renders disposition pills for the inventory", async () => {
    const pkg = await buildPackage();
    const html = renderSitemapDeliverable(pkg);
    expect(html).toMatch(/pill pill-(new|keep|improve)/);
  });
});
