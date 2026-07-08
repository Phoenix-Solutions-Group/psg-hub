// PSG-846: minimal, safe Markdown -> HTML renderer for the daily board briefing
// email. The PSG-768 shared renderer is a React/JSX component (client-oriented
// and not yet on main), so the email path uses this small server-safe renderer
// instead. It escapes ALL HTML first, then applies a fixed allow-list of inline
// and block transforms — so briefing content can never inject markup into the
// email, even though the source is our own trusted agent.

/** Escape the five HTML-significant characters. Applied before any transform. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Inline transforms, applied to already-escaped text:
 *   - `[label](http/https url)` -> anchor (only http/https, to block javascript:)
 *   - `**bold**` / `__bold__`   -> <strong>
 *   - `*italic*` / `_italic_`   -> <em>
 *   - `` `code` ``              -> <code>
 * Order matters: links first (so their text can still be styled), then code
 * (so its contents are not re-styled), then bold before italic.
 */
export function renderInline(escaped: string): string {
  let out = escaped;

  // Links — the URL was HTML-escaped, so "&amp;" etc. are safe in href. Only
  // permit http(s) targets; anything else is left as literal text.
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${url}" style="color:#2563eb;text-decoration:underline">${label}</a>`
  );

  // Inline code
  out = out.replace(
    /`([^`]+)`/g,
    '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.9em">$1</code>'
  );

  // Bold (must run before italic so ** is consumed before *)
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_/g, "$1<em>$2</em>");

  return out;
}

interface ListState {
  type: "ul" | "ol";
  items: string[];
}

/**
 * Render a Markdown string to a self-contained HTML fragment. Supports the block
 * constructs the briefing uses: ATX headings (`#`..`######`), unordered lists
 * (`-`/`*`/`+`), ordered lists (`1.`), blockquotes (`>`), horizontal rules
 * (`---`), and paragraphs. Everything else becomes a paragraph. All content is
 * HTML-escaped before inline transforms, so the output is injection-safe.
 */
export function renderBriefingHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let list: ListState | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flushList = () => {
    if (!list) return;
    const tag = list.type;
    parts.push(
      `<${tag} style="margin:0 0 12px 20px;padding:0">` +
        list.items.map((i) => `<li style="margin:0 0 4px">${i}</li>`).join("") +
        `</${tag}>`
    );
    list = null;
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    parts.push(
      `<p style="margin:0 0 12px;line-height:1.5">${paragraph.join("<br>")}</p>`
    );
    paragraph = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    parts.push(
      `<blockquote style="margin:0 0 12px;padding:8px 14px;border-left:4px solid #cbd5e1;background:#f8fafc;color:#334155">` +
        quote.join("<br>") +
        `</blockquote>`
    );
    quote = [];
  };

  const flushInline = () => {
    flushList();
    flushParagraph();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const escaped = escapeHtml(line);

    // Blank line — close any open inline block.
    if (line.trim() === "") {
      flushInline();
      continue;
    }

    // Horizontal rule
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushInline();
      parts.push(
        `<hr style="border:0;border-top:1px solid #e2e8f0;margin:16px 0">`
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushInline();
      const level = heading[1].length;
      const size = [22, 19, 17, 15, 14, 13][level - 1];
      parts.push(
        `<h${level} style="margin:18px 0 8px;font-size:${size}px;font-weight:700;line-height:1.3">` +
          renderInline(escapeHtml(heading[2])) +
          `</h${level}>`
      );
      continue;
    }

    // Blockquote
    const bq = /^\s*>\s?(.*)$/.exec(line);
    if (bq) {
      flushList();
      flushParagraph();
      quote.push(renderInline(escapeHtml(bq[1])));
      continue;
    }

    // Ordered list item
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(renderInline(escapeHtml(ol[1])));
      continue;
    }

    // Unordered list item
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(renderInline(escapeHtml(ul[1])));
      continue;
    }

    // Paragraph text
    flushList();
    flushQuote();
    paragraph.push(renderInline(escaped));
  }

  flushInline();
  return parts.join("\n");
}

/** Wrap the rendered briefing fragment in a complete, email-client-safe HTML doc. */
export function wrapBriefingEmail(options: {
  bodyHtml: string;
  docUrl: string;
  dateLabel: string;
}): string {
  const { bodyHtml, docUrl, dateLabel } = options;
  return [
    `<!doctype html><html><body style="margin:0;background:#f1f5f9">`,
    `<div style="max-width:680px;margin:0 auto;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;font-size:15px">`,
    `<div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Phoenix Solutions Group</div>`,
    bodyHtml,
    `<hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0">`,
    `<p style="margin:0;font-size:13px;color:#64748b">This is the same briefing that updates each morning on the board. ` +
      `<a href="${escapeHtml(docUrl)}" style="color:#2563eb;text-decoration:underline">Open the live version</a> ` +
      `to see the latest.</p>`,
    `<p style="margin:8px 0 0;font-size:12px;color:#94a3b8">Automated daily send · ${escapeHtml(dateLabel)}</p>`,
    `</div></body></html>`,
  ].join("\n");
}
