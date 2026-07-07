import type { ReactNode } from "react";

/**
 * PSG-768 (B3) — faithful, sanitized Markdown → React renderer.
 *
 * The approval preview and the content preview must show the owner *exactly what
 * will publish*: real bold / italic / links / lists, never raw `**text**` or a
 * mangled list. That "what you see is what posts" faithfulness is the whole point
 * of the review-and-confirm step, so the same renderer is shared by both screens.
 *
 * SECURITY — sanitized by construction (no DOMPurify needed): we never call
 * `dangerouslySetInnerHTML`. Every span of author text becomes a React text node,
 * which React HTML-escapes, so agent-authored content can never inject markup or
 * script. The only attribute we ever emit from author input is a link `href`, and
 * that is passed through an allow-list (`safeUrl`) — anything but http/https/
 * mailto/tel/relative is dropped and the link degrades to plain text. This is a
 * deliberately small Markdown subset (headings, ordered/unordered lists, bold,
 * italic, inline code, links, hard line breaks) — enough to render agent content
 * faithfully, with no HTML passthrough.
 */

/** Allow-list a link target; return null (→ render as plain text) if unsafe. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  // Relative / same-page links are safe.
  if (url.startsWith("/") || url.startsWith("#")) return url;
  // Absolute links: only these schemes. Blocks javascript:, data:, vbscript:, …
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  return null;
}

// One pass matches the highest-priority inline token at each position. Code spans
// come first (their content is literal — no nested formatting); then bold, italic,
// then links. `key` is supplied by the caller so React lists stay stable.
// Bold allows nested `*` (so `**bold *italic***` works): it matches lazily, but the
// `(?!\*)` lookahead skips a `**` that's really the front of a `***` run, so the
// closing delimiter is the true end and the inner italic survives the recursion.
const INLINE_RE =
  /(`[^`]+`)|(\*\*[\s\S]+?\*\*(?!\*)|__[\s\S]+?__(?!_))|(\*[^*]+?\*|_[^_]+?_)|(\[[^\]]+?\]\([^)\s]+?\))/;

/** Parse inline Markdown in a single line into React nodes (recurses for nesting). */
export function parseInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;

  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m || m.index === undefined) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${n++}`;

    if (m[1]) {
      // `code` — literal, no nested parsing.
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (m[2]) {
      // **bold** / __bold__ (both delimiters are 2 chars)
      out.push(
        <strong key={key} className="font-semibold">
          {parseInline(token.slice(2, -2), key)}
        </strong>
      );
    } else if (m[3]) {
      // *italic* / _italic_
      out.push(<em key={key}>{parseInline(token.slice(1, -1), key)}</em>);
    } else if (m[4]) {
      // [text](url)
      const linkMatch = /^\[([^\]]+?)\]\(([^)\s]+?)\)$/.exec(token)!;
      const label = linkMatch[1];
      const href = safeUrl(linkMatch[2]);
      if (href) {
        out.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {parseInline(label, key)}
          </a>
        );
      } else {
        // Unsafe URL → keep the visible text, drop the link.
        out.push(<span key={key}>{parseInline(label, key)}</span>);
      }
    }

    rest = rest.slice(m.index + token.length);
  }

  return out;
}

/** Join the lines of a text block, inserting hard line breaks for single newlines. */
function withLineBreaks(lines: string[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyPrefix}-br-${i}`} />);
    out.push(...parseInline(line, `${keyPrefix}-l${i}`));
  });
  return out;
}

const UL_RE = /^[-*]\s+/;
const OL_RE = /^\d+\.\s+/;

export type MarkdownVariant = "article" | "compact";

/**
 * Render a Markdown body to React block elements (headings, lists, paragraphs).
 * `variant` only tunes typography — `compact` for the in-card approval preview,
 * `article` for the full content page. The parsing and safety are identical.
 */
export function renderMarkdown(body: string, variant: MarkdownVariant = "article"): ReactNode[] {
  const h1 = variant === "compact" ? "text-lg font-bold text-foreground" : "text-2xl font-bold text-foreground";
  const h2 = variant === "compact" ? "text-base font-semibold text-foreground" : "text-xl font-semibold text-foreground";
  const h3 = variant === "compact" ? "text-sm font-semibold text-foreground" : "text-lg font-semibold text-foreground";
  const p = variant === "compact" ? "text-sm leading-6 text-foreground" : "text-foreground leading-7";
  const list = variant === "compact" ? "space-y-0.5 pl-5 text-sm text-foreground" : "space-y-1 pl-6 text-foreground";

  const blocks = body.split(/\n{2,}/).filter((b) => b.trim().length > 0);

  return blocks.map((block, i) => {
    const trimmed = block.trim();
    const key = `b-${i}`;

    if (trimmed.startsWith("### ")) {
      return <h3 key={key} className={h3}>{parseInline(trimmed.slice(4), key)}</h3>;
    }
    if (trimmed.startsWith("## ")) {
      return <h2 key={key} className={h2}>{parseInline(trimmed.slice(3), key)}</h2>;
    }
    if (trimmed.startsWith("# ")) {
      return <h1 key={key} className={h1}>{parseInline(trimmed.slice(2), key)}</h1>;
    }

    const lines = trimmed.split("\n");
    const nonEmpty = lines.filter((l) => l.trim().length > 0);

    if (nonEmpty.length > 0 && nonEmpty.every((l) => UL_RE.test(l.trim()))) {
      return (
        <ul key={key} className={`list-disc ${list}`}>
          {nonEmpty.map((l, j) => (
            <li key={`${key}-${j}`}>{parseInline(l.trim().replace(UL_RE, ""), `${key}-${j}`)}</li>
          ))}
        </ul>
      );
    }
    if (nonEmpty.length > 0 && nonEmpty.every((l) => OL_RE.test(l.trim()))) {
      return (
        <ol key={key} className={`list-decimal ${list}`}>
          {nonEmpty.map((l, j) => (
            <li key={`${key}-${j}`}>{parseInline(l.trim().replace(OL_RE, ""), `${key}-${j}`)}</li>
          ))}
        </ol>
      );
    }

    return <p key={key} className={p}>{withLineBreaks(lines, key)}</p>;
  });
}
