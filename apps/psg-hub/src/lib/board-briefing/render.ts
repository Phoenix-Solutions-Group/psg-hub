import "server-only";

const MIDNIGHT = "#1E3A52";
const EMBER = "#B8483E";
const EMBER_SOFT = "#FAEEEC";
const PAPER = "#FAFAFA";
const INK = "#161616";
const MIST = "#707070";
const STONE = "#E0E0E0";
const BONE = "#F0F0F0";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Escape the five HTML-significant characters. Applied before any transform. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveHref(href: string, base?: string): string | null {
  try {
    const resolved = base ? new URL(href, base) : new URL(href);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:" && resolved.protocol !== "mailto:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Inline transforms, applied to already-escaped text:
 *   - `[label](url)` -> anchor for http(s), mailto, and base-resolved relative URLs
 *   - `**bold**` / `__bold__` -> <strong>
 *   - `*italic*` / `_italic_` -> <em>
 *   - `` `code` `` -> <code>
 */
export function renderInline(escaped: string, base?: string): string {
  let out = escaped;

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const resolved = resolveHref(href.replaceAll("&amp;", "&"), base);
    if (!resolved) return label;
    return `<a href="${escapeHtml(resolved)}" style="color:${MIDNIGHT};font-weight:600;text-decoration:none;border-bottom:1px solid ${EMBER};">${label}</a>`;
  });

  out = out.replace(
    /`([^`]+)`/g,
    `<code style="background:${BONE};border:1px solid ${STONE};border-radius:4px;padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:${MIDNIGHT};">$1</code>`,
  );

  out = out.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${INK};font-weight:700;">$1</strong>`);
  out = out.replace(/__([^_]+)__/g, `<strong style="color:${INK};font-weight:700;">$1</strong>`);
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_/g, "$1<em>$2</em>");

  return out;
}

interface ListState {
  type: "ul" | "ol";
  items: string[];
}

export function renderBriefingHtml(markdown: string, base?: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let list: ListState | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flushList = () => {
    if (!list) return;
    const tag = list.type;
    const items = list.items
      .map(
        (item) =>
          `<li style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#4B5058;padding-left:4px;">${item}</li>`,
      )
      .join("");
    parts.push(`<${tag} style="margin:4px 0 18px;padding-left:22px;">${items}</${tag}>`);
    list = null;
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const body = paragraph.join("<br>");
    const bottomLine = /^(?:<strong\b[^>]*>)?Bottom line\s*:/i.test(body);
    if (bottomLine) {
      parts.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td style="background:${EMBER_SOFT};border-left:4px solid ${EMBER};border-radius:6px;padding:14px 18px;font-size:15px;line-height:1.6;color:${INK};">${body}</td></tr></table>`,
      );
    } else {
      parts.push(`<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4B5058;">${body}</p>`);
    }
    paragraph = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    parts.push(
      `<blockquote style="margin:0 0 12px;padding:8px 14px;border-left:4px solid ${EMBER};background:${EMBER_SOFT};color:${INK}">` +
        quote.join("<br>") +
        `</blockquote>`,
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

    if (line.trim() === "") {
      flushInline();
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushInline();
      parts.push(`<hr style="border:none;border-top:1px solid ${STONE};margin:22px 0;">`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushInline();
      const level = Math.min(heading[1].length, 3);
      if (level === 1) {
        parts.push(
          `<h2 style="margin:28px 0 12px;font-size:20px;line-height:1.3;color:${MIDNIGHT};font-weight:700;">${renderInline(escapeHtml(heading[2]), base)}</h2>`,
        );
      } else if (level === 2) {
        parts.push(
          `<h2 style="margin:30px 0 14px;padding-top:18px;border-top:1px solid ${STONE};font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${EMBER};font-weight:700;">${renderInline(escapeHtml(heading[2]), base)}</h2>`,
        );
      } else {
        parts.push(
          `<h3 style="margin:20px 0 8px;font-size:16px;line-height:1.35;color:${MIDNIGHT};font-weight:700;">${renderInline(escapeHtml(heading[2]), base)}</h3>`,
        );
      }
      continue;
    }

    const blockquote = /^\s*>\s?(.*)$/.exec(line);
    if (blockquote) {
      flushList();
      flushParagraph();
      quote.push(renderInline(escapeHtml(blockquote[1]), base));
      continue;
    }

    const orderedItem = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (orderedItem) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(renderInline(escapeHtml(orderedItem[1]), base));
      continue;
    }

    const unorderedItem = /^\s*(?:[-*+]|\u2022)\s+(.*)$/.exec(line);
    if (unorderedItem) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(renderInline(escapeHtml(unorderedItem[1]), base));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(renderInline(escapeHtml(line), base));
  }

  flushInline();
  return parts.join("\n");
}

export function wrapBriefingEmail(options: {
  bodyHtml: string;
  docUrl: string;
  dateLabel: string;
  subject?: string;
}): string {
  const { bodyHtml, docUrl, dateLabel, subject = "PSG Board Briefing" } = options;
  const safeUrl = escapeHtml(docUrl);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${PAPER};color:${INK};font-family:${FONT};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your daily Phoenix Solutions Group board briefing: the numbers, the risks, and what needs your call.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
      <tr><td align="center" style="padding:28px 16px;">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid ${STONE};border-radius:10px;overflow:hidden;">
          <tr><td style="background:${MIDNIGHT};padding:26px 32px 22px;border-bottom:3px solid ${EMBER};">
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8FA1B2;font-weight:700;">Phoenix Solutions Group</p>
            <h1 style="margin:0;font-size:22px;line-height:1.3;color:#FFFFFF;font-weight:700;">${escapeHtml(subject)}</h1>
          </td></tr>
          <tr><td style="padding:26px 32px 8px;">
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:8px 32px 30px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${MIDNIGHT};border-radius:6px;">
              <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;">Open the live briefing &rarr;</a>
            </td></tr></table>
            <p style="margin:14px 0 0;color:${MIST};font-size:12px;">Automated daily send: ${escapeHtml(dateLabel)}</p>
          </td></tr>
          <tr><td style="padding:18px 32px;background:${BONE};border-top:1px solid ${STONE};">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${MIST};">Sent automatically each morning by Phoenix Hub. Reply to this email to change who receives the briefing.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export interface BoardBriefingRenderInput {
  body: string;
  briefingUrl: string;
  subject: string;
  generatedAt?: string;
}

function textWithLink(input: BoardBriefingRenderInput): string {
  return [
    input.subject,
    "",
    input.body.trim(),
    "",
    `Read the source briefing: ${input.briefingUrl}`,
    input.generatedAt ? `Generated: ${input.generatedAt}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function renderBoardBriefingEmail(input: BoardBriefingRenderInput): {
  html: string;
  text: string;
} {
  return {
    html: wrapBriefingEmail({
      bodyHtml: renderBriefingHtml(input.body.trim(), input.briefingUrl),
      docUrl: input.briefingUrl,
      dateLabel: input.generatedAt ?? new Date().toISOString(),
      subject: input.subject,
    }),
    text: textWithLink(input),
  };
}
