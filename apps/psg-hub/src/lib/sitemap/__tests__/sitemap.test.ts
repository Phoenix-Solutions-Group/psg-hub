// Wave 1A / PSG-225 — Sitemap & content-architecture engine tests.
//
// Asserts the acceptance criteria directly:
//   • end-to-end run on a real shop brief produces all four artifacts,
//   • the CSV and the Mermaid tree stay in sync (single hierarchy source, no drift),
//   • BOTH human checkpoints fire,
//   • the collision vertical activates for an auto-body client (8-persona coverage),
//   • the general flow does NOT get collision pages,
//   • the 3-click rule + validation hold,
//   • changes_requested at either gate stops the run.

import { describe, expect, it, vi } from "vitest";
import {
  COLLISION_PERSONAS,
  COLLISION_REQUIRED_PAGES,
  buildArchitecture,
  buildArtifacts,
  clusterKeywords,
  deterministicKeywordProvider,
  flattenHierarchy,
  humanizeClusterTitle,
  pageTypeForIntent,
  runSitemapPipeline,
  slugify,
  toMermaid,
  toPageInventoryRows,
  validateArchitecture,
  validatePageType,
  type CheckpointApproval,
  type CheckpointPayload,
  type ShopBrief,
  type SerpCluster,
} from "../index";

/* -------------------------------------------------------------------------- */
/* Fixtures — a real-shaped auto-body shop brief + a general brief            */
/* -------------------------------------------------------------------------- */

const COLLISION_BRIEF: ShopBrief = {
  shopId: "shop-courtesy-body-works",
  businessName: "Courtesy Body Works",
  domain: "courtesybodyworks.com",
  vertical: "collision_repair",
  services: ["collision repair", "auto body painting", "frame straightening", "paintless dent repair"],
  locations: [
    { city: "Lincoln", state: "NE", primary: true },
    { city: "Omaha", state: "NE" },
  ],
  competitors: ["abra-auto-body.com", "caliber-collision.com"],
};

const GENERAL_BRIEF: ShopBrief = {
  shopId: "shop-acme-plumbing",
  businessName: "Acme Plumbing",
  domain: null,
  vertical: "general",
  services: ["drain cleaning", "water heater repair"],
  locations: [{ city: "Denver", state: "CO" }],
  competitors: [],
};

/** Approve every checkpoint. */
const autoApprove = (): CheckpointApproval => ({
  phase: "clusters_page_types",
  decision: "approved",
  approvedBy: "test",
  approvedAt: "2026-06-23T00:00:00.000Z",
});

/* -------------------------------------------------------------------------- */
/* slugify                                                                    */
/* -------------------------------------------------------------------------- */

describe("slugify", () => {
  it("produces deterministic ascii slugs", () => {
    expect(slugify("Frame & Unibody Straightening")).toBe("frame-unibody-straightening");
    expect(slugify("  Lincoln, NE  ")).toBe("lincoln-ne");
    expect(slugify("EV/Luxury Repair")).toBe("ev-luxury-repair");
  });
});

/* -------------------------------------------------------------------------- */
/* Page-type validation (seo-sxo)                                             */
/* -------------------------------------------------------------------------- */

describe("page-type validation", () => {
  it("maps intent → page type", () => {
    expect(pageTypeForIntent("service")).toBe("service");
    expect(pageTypeForIntent("local")).toBe("service_area");
    expect(pageTypeForIntent("transactional")).toBe("landing");
    expect(pageTypeForIntent("informational")).toBe("resource");
  });

  it("corrects an inconsistent proposed page type", () => {
    expect(validatePageType("service", "landing")).toEqual({ pageType: "service", corrected: true });
    expect(validatePageType("service", "service")).toEqual({ pageType: "service", corrected: false });
    // informational family is allowed
    expect(validatePageType("informational", "blog_post")).toEqual({ pageType: "blog_post", corrected: false });
  });
});

/* -------------------------------------------------------------------------- */
/* THE no-drift invariant                                                     */
/* -------------------------------------------------------------------------- */

describe("single hierarchy source → CSV and Mermaid never drift", () => {
  function nodeCounts(root: ReturnType<typeof buildArchitecture>) {
    const flat = flattenHierarchy(root);
    const csvRows = toPageInventoryRows(root);
    const mermaid = toMermaid(root);
    // Count Mermaid node declarations: lines like `  id["label"]` (not edges).
    const decls = mermaid
      .split("\n")
      .filter((l) => /^\s+\S+\["/.test(l)).length;
    // Count Mermaid edges: lines containing `-->`.
    const edges = mermaid.split("\n").filter((l) => l.includes("-->")).length;
    return { flat: flat.length, csvRows: csvRows.length, decls, edges };
  }

  it("matches node count across flatten, CSV rows and Mermaid declarations (collision)", async () => {
    const clusters = await clusterKeywords(await deterministicKeywordProvider(COLLISION_BRIEF), {
      cityTokens: new Set(["lincoln", "omaha"]),
    });
    const root = buildArchitecture(COLLISION_BRIEF, clusters);
    const c = nodeCounts(root);
    expect(c.csvRows).toBe(c.flat);
    expect(c.decls).toBe(c.flat);
    // Every non-root node has exactly one parent edge → edges === nodes - 1 (a tree).
    expect(c.edges).toBe(c.flat - 1);
  });

  it("matches for the general flow too", async () => {
    const clusters = await clusterKeywords(await deterministicKeywordProvider(GENERAL_BRIEF), {
      cityTokens: new Set(["denver"]),
    });
    const root = buildArchitecture(GENERAL_BRIEF, clusters);
    const c = nodeCounts(root);
    expect(c.csvRows).toBe(c.flat);
    expect(c.decls).toBe(c.flat);
    expect(c.edges).toBe(c.flat - 1);
  });

  it("CSV paths and Mermaid labels reference the same nodes", () => {
    const clusters: SerpCluster[] = [];
    const root = buildArchitecture(COLLISION_BRIEF, clusters);
    const rows = toPageInventoryRows(root);
    const titles = new Set(rows.map((r) => r.title));
    const mermaid = toMermaid(root);
    for (const title of titles) {
      expect(mermaid).toContain(title);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Collision vertical                                                         */
/* -------------------------------------------------------------------------- */

describe("collision-repair vertical", () => {
  it("exposes exactly 8 personas", () => {
    expect(COLLISION_PERSONAS).toHaveLength(8);
    expect(new Set(COLLISION_PERSONAS.map((p) => p.id)).size).toBe(8);
  });

  it("seeds all required pages so coverage is complete with zero clusters", () => {
    const root = buildArchitecture(COLLISION_BRIEF, []);
    const validation = validateArchitecture(root, COLLISION_BRIEF);
    expect(validation.coverageGaps).toEqual([]);
    const slugs = new Set(flattenHierarchy(root).map((f) => f.node.slug));
    for (const req of COLLISION_REQUIRED_PAGES) {
      expect(slugs.has(req.key)).toBe(true);
    }
  });

  it("attaches personas to pages", () => {
    const root = buildArchitecture(COLLISION_BRIEF, []);
    const withPersonas = flattenHierarchy(root).filter((f) => f.node.personaIds.length > 0);
    expect(withPersonas.length).toBeGreaterThan(0);
  });

  it("does NOT add collision pages to the general flow", () => {
    const root = buildArchitecture(GENERAL_BRIEF, []);
    const slugs = new Set(flattenHierarchy(root).map((f) => f.node.slug));
    expect(slugs.has("frame-straightening")).toBe(false);
    expect(slugs.has("insurance-claims")).toBe(false);
    // General flow has no coverage requirement → no gaps reported.
    expect(validateArchitecture(root, GENERAL_BRIEF).coverageGaps).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 3-click rule + validation                                                  */
/* -------------------------------------------------------------------------- */

describe("architecture validation", () => {
  it("keeps everything within 3 clicks of home", () => {
    const root = buildArchitecture(COLLISION_BRIEF, []);
    const validation = validateArchitecture(root, COLLISION_BRIEF);
    expect(validation.threeClickViolations).toEqual([]);
    expect(validation.ok).toBe(true);
    const maxDepth = Math.max(...flattenHierarchy(root).map((f) => f.depth));
    expect(maxDepth).toBeLessThanOrEqual(3);
  });

  it("flags a hand-built 4-deep page", () => {
    const deep = buildArchitecture(GENERAL_BRIEF, []);
    // graft a 4th-level node under the first depth-2 page
    const flat = flattenHierarchy(deep);
    const depth2 = flat.find((f) => f.depth === 2);
    expect(depth2).toBeDefined();
    // Graft depth-3 → depth-4 chain; the depth-4 node violates the 3-click rule.
    depth2!.node.children.push({
      id: "depth-three",
      title: "Depth Three",
      slug: "depth-three",
      pageType: "resource",
      intent: "informational",
      disposition: "new",
      targetKeywords: [],
      clusterId: null,
      personaIds: [],
      internalLinks: [],
      children: [
        {
          id: "too-deep",
          title: "Too Deep",
          slug: "too-deep",
          pageType: "resource",
          intent: "informational",
          disposition: "new",
          targetKeywords: [],
          clusterId: null,
          personaIds: [],
          internalLinks: [],
          children: [],
        },
      ],
    });
    const v = validateArchitecture(deep, GENERAL_BRIEF);
    expect(v.threeClickViolations.length).toBeGreaterThan(0);
    expect(v.ok).toBe(false);
  });

  it("flags broken internal links", () => {
    const root = buildArchitecture(GENERAL_BRIEF, []);
    flattenHierarchy(root)[1].node.internalLinks.push("does-not-exist");
    const v = validateArchitecture(root, GENERAL_BRIEF);
    expect(v.brokenInternalLinks.length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end pipeline + both checkpoints                                     */
/* -------------------------------------------------------------------------- */

describe("runSitemapPipeline (end-to-end)", () => {
  it("produces all four artifacts and fires BOTH checkpoints (collision)", async () => {
    const phases: string[] = [];
    const onCheckpoint = vi.fn(async (payload: CheckpointPayload) => {
      phases.push(payload.phase);
      return { ...autoApprove(), phase: payload.phase };
    });

    const result = await runSitemapPipeline(COLLISION_BRIEF, {
      generatedAt: "2026-06-23T12:00:00.000Z",
      onCheckpoint,
    });

    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;

    // Both checkpoints fired, in order.
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
    expect(phases).toEqual(["clusters_page_types", "package_handoff"]);
    expect(result.package.checkpoints).toHaveLength(2);

    // All four artifacts present + non-trivial.
    const artifacts = buildArtifacts(result.package);
    expect(artifacts.pageInventoryCsv.split("\r\n").length).toBeGreaterThan(5);
    expect(artifacts.sitemapMmd.startsWith("graph TD")).toBe(true);
    expect(artifacts.contentCalendarMd).toContain("# Content Calendar");
    expect(artifacts.summaryMd).toContain("Courtesy Body Works");

    // Collision vertical activated: coverage complete, summary says so.
    expect(result.package.validation.coverageGaps).toEqual([]);
    expect(artifacts.summaryMd).toContain("complete (8-persona)");

    // The CSV and Mermaid still agree end-to-end.
    const csvRows = artifacts.pageInventoryCsv.split("\r\n").length - 1; // minus header
    const decls = artifacts.sitemapMmd.split("\n").filter((l) => /^\s+\S+\["/.test(l)).length;
    expect(csvRows).toBe(decls);
  });

  it("runs the general flow with the deterministic keyword provider", async () => {
    const onCheckpoint = vi.fn(async (payload: CheckpointPayload) => ({
      ...autoApprove(),
      phase: payload.phase,
    }));
    const result = await runSitemapPipeline(GENERAL_BRIEF, {
      generatedAt: "2026-06-23T12:00:00.000Z",
      onCheckpoint,
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.package.root.children.length).toBeGreaterThan(0);
  });

  it("stops at checkpoint 1 when changes are requested (no second gate)", async () => {
    const onCheckpoint = vi.fn(async (payload: CheckpointPayload) => ({
      phase: payload.phase,
      decision: "changes_requested" as const,
      approvedBy: "reviewer",
      approvedAt: "2026-06-23T00:00:00.000Z",
      notes: "Merge the two estimate clusters.",
    }));
    const result = await runSitemapPipeline(COLLISION_BRIEF, {
      generatedAt: "2026-06-23T12:00:00.000Z",
      onCheckpoint,
    });
    expect(result.status).toBe("changes_requested");
    if (result.status !== "changes_requested") return;
    expect(result.phase).toBe("clusters_page_types");
    // Only the first gate ran.
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(result.partial.clusters).toBeDefined();
  });

  it("stops at checkpoint 2 when the package is rejected", async () => {
    let call = 0;
    const onCheckpoint = vi.fn(async (payload: CheckpointPayload) => {
      call += 1;
      return {
        phase: payload.phase,
        decision: call === 1 ? ("approved" as const) : ("changes_requested" as const),
        approvedBy: "reviewer",
        approvedAt: "2026-06-23T00:00:00.000Z",
      };
    });
    const result = await runSitemapPipeline(COLLISION_BRIEF, {
      generatedAt: "2026-06-23T12:00:00.000Z",
      onCheckpoint,
    });
    expect(result.status).toBe("changes_requested");
    if (result.status !== "changes_requested") return;
    expect(result.phase).toBe("package_handoff");
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
  });

  it("applies Keep/Improve from the URL inventory onto matching pages", async () => {
    const onCheckpoint = vi.fn(async (payload: CheckpointPayload) => ({
      ...autoApprove(),
      phase: payload.phase,
    }));
    const result = await runSitemapPipeline(COLLISION_BRIEF, {
      generatedAt: "2026-06-23T12:00:00.000Z",
      onCheckpoint,
      auditProvider: async () => [
        { url: "https://courtesybodyworks.com/about", title: "About", disposition: "keep" },
        { url: "https://courtesybodyworks.com/contact", title: "Contact", disposition: "improve" },
      ],
    });
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    const flat = flattenHierarchy(result.package.root);
    expect(flat.find((f) => f.node.slug === "about")?.node.disposition).toBe("keep");
    expect(flat.find((f) => f.node.slug === "contact")?.node.disposition).toBe("improve");
  });
});

/* -------------------------------------------------------------------------- */
/* PSG-259 (Lee design review) — cluster→page quality gate + clean titles     */
/* -------------------------------------------------------------------------- */

describe("PSG-259: no keyword-clustering noise reaches the client page tree", () => {
  async function buildCollisionPackage() {
    const onCheckpoint = vi.fn(async (payload: CheckpointPayload) => ({ ...autoApprove(), phase: payload.phase }));
    const result = await runSitemapPipeline(COLLISION_BRIEF, { generatedAt: "2026-06-23T12:00:00.000Z", onCheckpoint });
    if (result.status !== "complete") throw new Error("pipeline did not complete");
    return result.package;
  }

  it("humanizeClusterTitle strips the internal (intent) suffix and fixes acronym casing (CR-2)", () => {
    expect(humanizeClusterTitle("Pdr (service)")).toBe("PDR");
    expect(humanizeClusterTitle("Auto Repair (service)")).toBe("Auto Repair");
    expect(humanizeClusterTitle("Our (local)")).toBe("Our");
    expect(humanizeClusterTitle("Ev Repair (service)")).toBe("EV Repair");
    expect(humanizeClusterTitle("Collision Repair")).toBe("Collision Repair"); // idempotent / no suffix
  });

  it("no page title carries an internal (intent) annotation (CR-2)", async () => {
    const pkg = await buildCollisionPackage();
    for (const { node } of flattenHierarchy(pkg.root)) {
      expect(node.title).not.toMatch(/\((?:service|local|transactional|informational|emergency)\)/i);
    }
  });

  it("the specific noise pages Lee flagged are gone, and are not duplicated (CR-1)", async () => {
    const pkg = await buildCollisionPackage();
    const titles = flattenHierarchy(pkg.root).map((f) => f.node.title);
    for (const junk of ["Pdr (service)", "Auto Repair (service)", "Our (local)", "Class Gold (local)", "Rental Repaired (local)", "Auto Turnaround (local)", "Body (transactional)"]) {
      expect(titles).not.toContain(junk);
    }
    // PDR appears exactly once — as the real required service page, not a bare duplicate.
    expect(titles.filter((t) => /paintless dent repair/i.test(t))).toHaveLength(1);
    expect(titles).not.toContain("PDR");
    expect(titles).not.toContain("Auto Repair");
  });

  it("folds the noise clusters' keywords into the correct spine pages instead of dropping them (CR-1)", async () => {
    const pkg = await buildCollisionPackage();
    const flat = flattenHierarchy(pkg.root);
    const find = (slug: string) => flat.find((f) => f.node.slug === slug)?.node;
    const allKeywords = flat.flatMap((f) => f.node.targetKeywords);
    // "auto body repair" → Collision Repair; the bare "PDR" acronym → Paintless Dent Repair.
    expect(find("collision-repair")?.targetKeywords).toContain("auto body repair");
    expect(find("paintless-dent-repair")?.targetKeywords).toContain("PDR");
    // The persona-fragment keywords are folded into a real page somewhere, never dropped.
    expect(allKeywords).toContain("I-CAR gold class");
    expect(allKeywords).toContain("rental car while repaired");
    expect(allKeywords).toContain("fast turnaround auto body");
  });

  it("preserves every cluster in the source artifact even when not promoted to a page (no silent loss, CR-1)", async () => {
    const pkg = await buildCollisionPackage();
    // The dropped fragments stay in pkg.clusters (the raw hand-off) — more clusters than pages.
    expect(pkg.clusters.length).toBeGreaterThan(flattenHierarchy(pkg.root).length);
  });

  it("the general (non-collision) flow still promotes its real service clusters (no over-gating)", async () => {
    const clusters = await clusterKeywords(await deterministicKeywordProvider(GENERAL_BRIEF), {});
    const root = buildArchitecture(GENERAL_BRIEF, clusters);
    const titles = flattenHierarchy(root).map((f) => f.node.title.toLowerCase());
    expect(titles.some((t) => t.includes("drain"))).toBe(true);
    expect(titles.some((t) => t.includes("heater"))).toBe(true);
  });
});
