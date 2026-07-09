import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderBoardBriefingEmail,
  renderBriefingHtml,
  renderInline,
  wrapBriefingEmail,
} from "../render";

const BASE_INPUT = {
  briefingUrl: "https://hub.psgweb.me/PSG/issues/PSG-209/documents/daily-briefing",
  subject: "PSG Board Briefing - 2026-07-09",
};

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">& '`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp; &#39;");
  });
});

describe("renderInline", () => {
  it("renders bold, italic, and inline code", () => {
    const html = renderInline("**b** and *i* and `c`");
    expect(html).toContain("<strong");
    expect(html).toContain(">b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<code");
  });

  it("renders http(s), mailto, and base-resolved relative links only", () => {
    expect(renderInline("[live](https://home.psgweb.me/issues/1)")).toContain(
      'href="https://home.psgweb.me/issues/1"',
    );
    expect(renderInline("[email](mailto:nick@example.com)")).toContain(
      'href="mailto:nick@example.com"',
    );
    expect(renderInline("[issue](/PSG/issues/1)", "https://hub.psgweb.me/root")).toContain(
      'href="https://hub.psgweb.me/PSG/issues/1"',
    );
    expect(renderInline("[x](javascript:alert(1))")).not.toContain("<a ");
  });
});

describe("renderBriefingHtml", () => {
  it("renders headings, bold, blockquote, hr, and lists", () => {
    const markdown = [
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

    const html = renderBriefingHtml(markdown);

    expect(html).toContain("<h2");
    expect(html).toContain("Daily Briefing");
    expect(html).toContain("<blockquote");
    expect(html).toContain("Bottom line");
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

describe("renderBoardBriefingEmail", () => {
  it("renders common briefing markdown without leaking raw markers", () => {
    const { html, text } = renderBoardBriefingEmail({
      ...BASE_INPUT,
      body: [
        "## What changed",
        "",
        "**Revenue risk** is visible in [PSG-286](/PSG/issues/PSG-286).",
        "",
        "- First action",
        "- Second action with `owner`",
        "",
        "1. Confirm",
        "2. Ship",
      ].join("\n"),
    });

    expect(html).toContain("What changed");
    expect(html).toContain("<strong");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("<code");
    expect(html).not.toContain("## What changed");
    expect(html).not.toContain("**Revenue risk**");
    expect(html).not.toContain("[PSG-286](/PSG/issues/PSG-286)");
    expect(text).toContain("## What changed");
  });

  it("resolves relative briefing links to absolute email-safe links", () => {
    const { html } = renderBoardBriefingEmail({
      ...BASE_INPUT,
      body: "Read [PSG-286](/PSG/issues/PSG-286) today.",
    });

    expect(html).toContain('href="https://hub.psgweb.me/PSG/issues/PSG-286"');
    expect(html).not.toContain('href="/PSG/issues/PSG-286"');
  });

  it("renders the bottom-line paragraph as a styled callout", () => {
    const { html } = renderBoardBriefingEmail({
      ...BASE_INPUT,
      body: "**Bottom line:** Nick can read the daily update cleanly in email.",
    });

    expect(html).toContain("background:#FAEEEC");
    expect(html).toContain("border-left:4px solid #B8483E");
    expect(html).toContain("<strong");
    expect(html).not.toContain("**Bottom line:**");
  });

  it("escapes unsafe HTML before rendering markdown", () => {
    const { html } = renderBoardBriefingEmail({
      ...BASE_INPUT,
      subject: "Briefing <Today>",
      generatedAt: "2026-07-09T12:10:00Z & later",
      body: "## Risk\n<script>alert('x')</script> & [bad](javascript:<script>)",
    });

    expect(html).toContain("Briefing &lt;Today&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp;");
    expect(html).toContain("2026-07-09T12:10:00Z &amp; later");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("javascript:");
  });
});
