import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  renderInline,
  renderBriefingHtml,
  wrapBriefingEmail,
} from "../render";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">& '`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp; &#39;"
    );
  });
});

describe("renderInline", () => {
  it("renders bold, italic, and inline code", () => {
    expect(renderInline("**b** and *i* and `c`")).toContain("<strong>b</strong>");
    expect(renderInline("**b** and *i* and `c`")).toContain("<em>i</em>");
    expect(renderInline("**b** and *i* and `c`")).toContain("<code");
  });

  it("renders only http(s) links", () => {
    expect(renderInline("[live](https://home.psgweb.me/issues/1)")).toContain(
      '<a href="https://home.psgweb.me/issues/1"'
    );
    // A non-http scheme is NOT turned into an anchor.
    expect(renderInline("[x](javascript:alert(1))")).not.toContain("<a ");
  });
});

describe("renderBriefingHtml", () => {
  it("renders headings, bold, blockquote, hr, and lists", () => {
    const md = [
      "# Daily Briefing",
      "",
      "> **Bottom line:** all good",
      "",
      "## Queue",
      "1. First item",
      "2. Second item",
      "",
      "- bullet a",
      "- bullet b",
      "",
      "---",
      "",
      "A closing paragraph.",
    ].join("\n");
    const html = renderBriefingHtml(md);
    expect(html).toContain("<h1");
    expect(html).toContain("Daily Briefing");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<strong>Bottom line:</strong>");
    expect(html).toContain("<h2");
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    expect(html).toContain("First item");
    expect(html).toContain("<ul");
    expect(html).toContain("<hr");
    expect(html).toContain("<p");
    expect(html).toContain("A closing paragraph.");
  });

  it("escapes HTML in the source so content cannot inject markup", () => {
    const html = renderBriefingHtml("A <script>alert(1)</script> line");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps ordered and unordered lists separate", () => {
    const html = renderBriefingHtml("1. one\n- two");
    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
  });
});

describe("wrapBriefingEmail", () => {
  it("wraps the body and includes the live-doc link", () => {
    const html = wrapBriefingEmail({
      bodyHtml: "<p>hi</p>",
      docUrl: "https://home.psgweb.me/issues/1",
      dateLabel: "Wednesday, July 8, 2026",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain('href="https://home.psgweb.me/issues/1"');
    expect(html).toContain("Wednesday, July 8, 2026");
  });
});
