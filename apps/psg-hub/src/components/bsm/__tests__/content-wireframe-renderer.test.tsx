import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentWireframeRenderer } from "@/components/bsm/content-wireframe-renderer";
import { parseContentWireframe } from "@/lib/bsm/content-wireframe";

describe("ContentWireframeRenderer", () => {
  it("renders the same safe, accessible immutable manifest used by staff and Reviewers", () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    const { manifest } = parseContentWireframe([
      "# Repair with confidence",
      "",
      "Our <script>alert('no')</script> team keeps you informed. [Email us](mailto:help@example.com)",
      "",
      "[CTA: Request an estimate](/estimate)",
      "",
      `![Technician inspecting a vehicle](asset:${assetId})`,
    ].join("\n"), {
      assets: [{ id: assetId, documentId: "document-1" }],
      documentId: "document-1",
    });

    const html = renderToStaticMarkup(
      <ContentWireframeRenderer
        manifest={manifest}
        assetUrl={(id) => `/private-assets/${id}`}
      />,
    );

    expect(html).toContain('data-review-block="hero:1"');
    expect(html).toContain("&lt;script&gt;alert(&#x27;no&#x27;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="mailto:help@example.com"');
    expect(html).toContain('href="/estimate"');
    expect(html).toContain(`src="/private-assets/${assetId}"`);
    expect(html).toContain('alt="Technician inspecting a vehicle"');
    expect(html).toContain("Content and structure review only");
    expect(html).toContain("does not approve final design or production launch");
  });

  it("keeps inline links and highlight offsets aligned in reviewer rendering", () => {
    const html = renderToStaticMarkup(
      <ContentWireframeRenderer
        manifest={{
          contractVersion: 1,
          assetIds: [],
          blocks: [
            { id: "paragraph:1", kind: "paragraph", ordinal: 1, text: "Read our [policy](https://example.com/policy) first.", links: [{ text: "policy", href: "https://example.com/policy" }] },
            { id: "faq:1", kind: "faq", ordinal: 2, question: "Question?", answer: "Answer." },
          ],
        }}
        renderText={(blockId, text, offset) => <mark data-block={blockId} data-offset={offset}>{text}</mark>}
      />,
    );

    expect(html).toContain('href="https://example.com/policy"');
    expect(html).toContain('<mark data-block="paragraph:1" data-offset="9">policy</mark>');
    expect(html).toContain('<mark data-block="faq:1" data-offset="9">Answer.</mark>');
  });
});
