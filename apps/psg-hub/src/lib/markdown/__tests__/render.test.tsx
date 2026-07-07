import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown, parseInline, safeUrl } from "../render";

// PSG-768 (B3) — the approval preview must render faithfully (WYSIWYG "what
// posts") AND be safe by construction. These tests pin both: real formatting
// (no raw **/lists) and no HTML/script/unsafe-URL passthrough.

const html = (body: string, variant: "article" | "compact" = "compact") =>
  renderToStaticMarkup(<>{renderMarkdown(body, variant)}</>);

describe("renderMarkdown — faithful rendering", () => {
  it("renders **bold** as <strong>, never raw asterisks", () => {
    const out = html("Book your **free estimate** today.");
    expect(out).toContain("<strong");
    expect(out).toContain("free estimate");
    expect(out).not.toContain("**");
  });

  it("renders *italic* and `code`", () => {
    const out = html("Call *now* and ask for `VIN`.");
    expect(out).toContain("<em>now</em>");
    expect(out).toContain("<code");
    expect(out).toContain("VIN");
  });

  it("renders a bullet list as <ul><li>, not raw dashes", () => {
    const out = html("- Free estimate\n- Loaner car\n- Lifetime warranty");
    expect(out).toContain("<ul");
    expect((out.match(/<li/g) ?? []).length).toBe(3);
    expect(out).toContain("Loaner car");
    expect(out).not.toContain("- Free");
  });

  it("renders an ordered list as <ol><li>", () => {
    const out = html("1. Drop off\n2. We repair\n3. Pick up");
    expect(out).toContain("<ol");
    expect((out.match(/<li/g) ?? []).length).toBe(3);
  });

  it("renders headings", () => {
    const out = html("# Big News\n\nWe reopened.");
    expect(out).toContain("<h1");
    expect(out).toContain("Big News");
    expect(out).toContain("<p");
  });

  it("keeps single newlines inside a paragraph as line breaks", () => {
    const out = html("Line one\nLine two");
    expect(out).toContain("<br");
    expect(out).toContain("Line one");
    expect(out).toContain("Line two");
  });

  it("renders a safe link as an anchor with the given href", () => {
    const out = html("See [our reviews](https://example.com/reviews).");
    expect(out).toContain('href="https://example.com/reviews"');
    expect(out).toContain("our reviews");
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe("renderMarkdown — sanitized by construction", () => {
  it("escapes raw HTML rather than emitting it", () => {
    const out = html("<img src=x onerror=alert(1)> hi");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("escapes a <script> tag as text", () => {
    const out = html("hello <script>alert('xss')</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("drops a javascript: link, keeping only the visible text", () => {
    const out = html("[click me](javascript:alert(1))");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a ");
    expect(out).toContain("click me");
  });

  it("drops a data: URL link", () => {
    const out = html("[x](data:text/html,<script>alert(1)</script>)");
    expect(out).not.toContain("data:");
    expect(out).not.toContain("<a ");
  });
});

describe("safeUrl allow-list", () => {
  it("permits http/https/mailto/tel and relative/anchor", () => {
    expect(safeUrl("https://a.com")).toBe("https://a.com");
    expect(safeUrl("http://a.com")).toBe("http://a.com");
    expect(safeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeUrl("tel:+15551234")).toBe("tel:+15551234");
    expect(safeUrl("/dashboard")).toBe("/dashboard");
    expect(safeUrl("#section")).toBe("#section");
  });

  it("rejects javascript:, data:, vbscript: and empty", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
  });
});

describe("parseInline", () => {
  it("returns plain text unchanged (no tokens)", () => {
    const out = renderToStaticMarkup(<>{parseInline("just plain text")}</>);
    expect(out).toBe("just plain text");
  });

  it("nests italic inside bold", () => {
    const out = renderToStaticMarkup(<>{parseInline("**bold and *italic***")}</>);
    expect(out).toContain("<strong");
    expect(out).toContain("<em>italic</em>");
  });
});
