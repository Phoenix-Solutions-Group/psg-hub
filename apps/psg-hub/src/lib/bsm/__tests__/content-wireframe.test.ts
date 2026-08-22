import { describe, expect, it } from "vitest";
import { parseContentWireframe } from "@/lib/bsm/content-wireframe";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";

describe("Content Wireframe parser", () => {
  it("builds a deterministic source-ordered manifest for the supported Markdown contract", () => {
    const markdown = [
      "# Collision repair that gets you back on the road",
      "",
      "Certified repairs with clear communication from estimate to delivery.",
      "",
      "## Why drivers choose us",
      "",
      "- Lifetime repair warranty",
      "- Direct insurance coordination",
      "",
      "> Your team kept me informed the whole way.",
      "",
      "[CTA: Request an estimate](/estimate)",
      "",
      "### Do you work with my insurer?",
      "",
      "Yes. We coordinate directly with all major carriers.",
      "",
      `![Technician inspecting a repaired vehicle](asset:${ASSET_ID})`,
    ].join("\n");

    const result = parseContentWireframe(markdown, {
      assets: [{ id: ASSET_ID, documentId: "document-1" }],
      documentId: "document-1",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual({
      contractVersion: 1,
      blocks: [
        { id: "hero:1", kind: "hero", ordinal: 1, text: "Collision repair that gets you back on the road" },
        { id: "paragraph:1", kind: "paragraph", ordinal: 1, text: "Certified repairs with clear communication from estimate to delivery.", links: [] },
        { id: "section:1", kind: "section", ordinal: 1, text: "Why drivers choose us" },
        { id: "unordered_list:1", kind: "unordered_list", ordinal: 1, items: ["Lifetime repair warranty", "Direct insurance coordination"] },
        { id: "callout:1", kind: "callout", ordinal: 1, text: "Your team kept me informed the whole way." },
        { id: "cta:1", kind: "cta", ordinal: 1, text: "Request an estimate", href: "/estimate" },
        { id: "faq:1", kind: "faq", ordinal: 1, question: "Do you work with my insurer?", answer: "Yes. We coordinate directly with all major carriers." },
        { id: "image:1", kind: "image", ordinal: 1, assetId: ASSET_ID, alt: "Technician inspecting a repaired vehicle" },
      ],
      assetIds: [ASSET_ID],
    });
  });

  it("preserves incomplete source while reporting structural, asset, and URL diagnostics", () => {
    const markdown = [
      "Intro <script>alert('no')</script>",
      "",
      "[Open unsafe link](javascript:alert(1))",
      "",
      "![External image](https://example.com/image.jpg)",
      "",
      "### Question without an answer?",
      "",
      `![](asset:${ASSET_ID})`,
    ].join("\n");

    const result = parseContentWireframe(markdown, {
      assets: [],
      documentId: "document-1",
    });

    expect(result.manifest.blocks).toContainEqual(expect.objectContaining({
      kind: "paragraph",
      text: "Intro <script>alert('no')</script>",
    }));
    expect(result.diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: "missing_hero", severity: "error" },
      { code: "raw_html_escaped", severity: "warning" },
      { code: "unsafe_link_scheme", severity: "error" },
      { code: "external_image_rejected", severity: "error" },
      { code: "faq_answer_required", severity: "error" },
      { code: "image_alt_required", severity: "warning" },
      { code: "asset_missing", severity: "error" },
    ]);
  });

  it("keeps multiline paragraphs, normal email links, and ordered lists in source order", () => {
    const result = parseContentWireframe([
      "# Repair process",
      "",
      "We explain every repair step",
      "and [email your advisor](mailto:advisor@example.com) when questions come up.",
      "",
      "1. Approve the estimate",
      "2. Track the repair",
    ].join("\n"));

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest.blocks).toEqual([
      { id: "hero:1", kind: "hero", ordinal: 1, text: "Repair process" },
      {
        id: "paragraph:1",
        kind: "paragraph",
        ordinal: 1,
        text: "We explain every repair step and [email your advisor](mailto:advisor@example.com) when questions come up.",
        links: [{ text: "email your advisor", href: "mailto:advisor@example.com" }],
      },
      { id: "ordered_list:1", kind: "ordered_list", ordinal: 1, items: ["Approve the estimate", "Track the repair"] },
    ]);
  });

  it("treats asterisk bullets as an unordered list", () => {
    const result = parseContentWireframe("# Services\n\n* Collision repair\n* Paint correction");

    expect(result.manifest.blocks[1]).toMatchObject({
      kind: "unordered_list",
      items: ["Collision repair", "Paint correction"],
    });
  });

  it("blocks a private asset owned by another Review Document", () => {
    const result = parseContentWireframe(`# Proof\n\n![Shop](asset:${ASSET_ID})`, {
      documentId: "document-1",
      assets: [{ id: ASSET_ID, documentId: "document-2" }],
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "asset_wrong_document",
      severity: "error",
    }));
  });
});
