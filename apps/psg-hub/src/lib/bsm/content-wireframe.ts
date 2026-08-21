export const CONTENT_WIREFRAME_CONTRACT_VERSION = 1;
export const CONTENT_FEEDBACK_DISPOSITIONS = ["resolved", "declined", "needs_clarification"] as const;
export type ContentFeedbackDisposition = (typeof CONTENT_FEEDBACK_DISPOSITIONS)[number];

export function isContentFeedbackDisposition(value: string): value is ContentFeedbackDisposition {
  return CONTENT_FEEDBACK_DISPOSITIONS.includes(value as ContentFeedbackDisposition);
}

export type ContentWireframeDiagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
  line: number;
};

export type ContentWireframeBlock =
  | { id: string; kind: "hero" | "section" | "callout"; ordinal: number; text: string }
  | { id: string; kind: "paragraph"; ordinal: number; text: string; links: Array<{ text: string; href: string }> }
  | { id: string; kind: "unordered_list" | "ordered_list"; ordinal: number; items: string[] }
  | { id: string; kind: "cta"; ordinal: number; text: string; href: string }
  | { id: string; kind: "faq"; ordinal: number; question: string; answer: string }
  | { id: string; kind: "image"; ordinal: number; assetId: string; alt: string };

export type ContentWireframeManifest = {
  contractVersion: typeof CONTENT_WIREFRAME_CONTRACT_VERSION;
  blocks: ContentWireframeBlock[];
  assetIds: string[];
};

export type MarkdownDiffLine = { kind: "context" | "added" | "removed"; line: string };

export function buildMarkdownDiff(before: string, after: string): MarkdownDiffLine[] {
  const left = before.replaceAll("\r\n", "\n").split("\n");
  const right = after.replaceAll("\r\n", "\n").split("\n");
  if (left.length * right.length > 1_000_000) {
    // ponytail: bounded fallback avoids quadratic memory for pathological 256 KiB inputs; use Myers if large-draft diffs become common.
    return [
      ...left.map((line) => ({ kind: "removed" as const, line })),
      ...right.map((line) => ({ kind: "added" as const, line })),
    ];
  }
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const diff: MarkdownDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      diff.push({ kind: "context", line: left[i] });
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || lengths[i][j + 1] >= lengths[i + 1][j])) {
      diff.push({ kind: "added", line: right[j] });
      j += 1;
    } else {
      diff.push({ kind: "removed", line: left[i] });
      i += 1;
    }
  }
  return diff;
}

type ParseOptions = {
  assets?: Array<{ id: string; documentId: string }>;
  documentId?: string;
};

const CTA_RE = /^\[CTA:\s*([^\]]+)]\(([^)]+)\)$/i;
const IMAGE_RE = /^!\[([^\]]*)]\(asset:([0-9a-f-]+)\)$/i;
const ANY_IMAGE_RE = /^!\[([^\]]*)]\(([^)]+)\)$/;
const LINK_RE = /\[([^\]]+)]\(([^)]+)\)/g;
const RAW_HTML_RE = /<\/?[a-z][^>]*>/i;

export function isContentWireframeHrefSafe(href: string, allowEmail = true): boolean {
  const value = href.trim();
  if (/^(?:\/|#|\.\.?\/)/.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return allowEmail && /^mailto:/i.test(value);
}

function startsBlock(line: string): boolean {
  const value = line.trim();
  return /^(?:#{1,3}\s|[-*]\s|\d+\.\s|>\s|!\[|\[CTA:)/i.test(value);
}

export function parseContentWireframe(markdown: string, _options: ParseOptions = {}): {
  manifest: ContentWireframeManifest;
  diagnostics: ContentWireframeDiagnostic[];
} {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: ContentWireframeBlock[] = [];
  const diagnostics: ContentWireframeDiagnostic[] = [];
  const ordinals = new Map<ContentWireframeBlock["kind"], number>();
  const assetIds: string[] = [];
  const heroCount = lines.filter((line) => /^#\s+/.test(line.trim())).length;

  if (heroCount === 0) {
    diagnostics.push({ code: "missing_hero", severity: "error", message: "Add exactly one H1 hero heading.", line: 1 });
  } else if (heroCount > 1) {
    diagnostics.push({ code: "multiple_heroes", severity: "error", message: "Use exactly one H1 hero heading.", line: 1 });
  }

  function nextId(kind: ContentWireframeBlock["kind"]): { id: string; ordinal: number } {
    const ordinal = (ordinals.get(kind) ?? 0) + 1;
    ordinals.set(kind, ordinal);
    return { id: `${kind}:${ordinal}`, ordinal };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      blocks.push({ ...nextId("hero"), kind: "hero", text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ ...nextId("section"), kind: "section", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("### ")) {
      let answerIndex = index + 1;
      while (answerIndex < lines.length && !lines[answerIndex].trim()) answerIndex += 1;
      const answerLine = lines[answerIndex]?.trim() ?? "";
      const answer = answerLine && !startsBlock(answerLine) ? answerLine : "";
      if (!answer) {
        diagnostics.push({ code: "faq_answer_required", severity: "error", message: "Add an answer paragraph after this FAQ question.", line: index + 1 });
      }
      blocks.push({
        ...nextId("faq"),
        kind: "faq",
        question: line.slice(4).trim(),
        answer,
      });
      if (answer) index = answerIndex;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [line.replace(/^[-*]\s+/, "")];
      while (index + 1 < lines.length && /^\s*[-*]\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
      }
      blocks.push({ ...nextId("unordered_list"), kind: "unordered_list", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [line.replace(/^\d+\.\s+/, "")];
      while (index + 1 < lines.length && /^\s*\d+\.\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
      }
      blocks.push({ ...nextId("ordered_list"), kind: "ordered_list", items });
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ ...nextId("callout"), kind: "callout", text: line.slice(2).trim() });
      continue;
    }
    const cta = line.match(CTA_RE);
    if (cta) {
      const href = cta[2].trim();
      if (!isContentWireframeHrefSafe(href, false)) {
        diagnostics.push({ code: "unsafe_link_scheme", severity: "error", message: "CTA links must be relative or use HTTP/HTTPS.", line: index + 1 });
      }
      blocks.push({ ...nextId("cta"), kind: "cta", text: cta[1].trim(), href });
      continue;
    }
    const image = line.match(IMAGE_RE);
    if (image) {
      const assetId = image[2].toLowerCase();
      const alt = image[1].trim();
      if (!alt) {
        diagnostics.push({ code: "image_alt_required", severity: "warning", message: "Add meaningful alt text for this image.", line: index + 1 });
      }
      const asset = _options.assets?.find((candidate) => candidate.id.toLowerCase() === assetId);
      if (!asset) {
        diagnostics.push({ code: "asset_missing", severity: "error", message: "This Content Asset is not available.", line: index + 1 });
      } else if (_options.documentId && asset.documentId !== _options.documentId) {
        diagnostics.push({ code: "asset_wrong_document", severity: "error", message: "This Content Asset belongs to another Review Document.", line: index + 1 });
      }
      blocks.push({ ...nextId("image"), kind: "image", alt, assetId });
      if (!assetIds.includes(assetId)) assetIds.push(assetId);
      continue;
    }

    if (ANY_IMAGE_RE.test(line)) {
      diagnostics.push({ code: "external_image_rejected", severity: "error", message: "Images must use a private Content Asset reference.", line: index + 1 });
      blocks.push({ ...nextId("paragraph"), kind: "paragraph", text: line, links: [] });
      continue;
    }

    const paragraphLines = [line];
    while (index + 1 < lines.length && lines[index + 1].trim() && !startsBlock(lines[index + 1])) {
      index += 1;
      paragraphLines.push(lines[index].trim());
    }
    const paragraph = paragraphLines.join(" ");
    if (RAW_HTML_RE.test(paragraph)) {
      diagnostics.push({ code: "raw_html_escaped", severity: "warning", message: "Raw HTML is shown as text and is never executed.", line: index + 1 });
    }
    const links = Array.from(paragraph.matchAll(LINK_RE), (match) => ({ text: match[1].trim(), href: match[2].trim() }));
    for (const link of links) {
      if (!isContentWireframeHrefSafe(link.href, true)) {
        diagnostics.push({ code: "unsafe_link_scheme", severity: "error", message: "Links must be relative, HTTP/HTTPS, or email links.", line: index + 1 });
      }
    }

    blocks.push({ ...nextId("paragraph"), kind: "paragraph", text: paragraph, links });
  }

  return {
    manifest: { contractVersion: CONTENT_WIREFRAME_CONTRACT_VERSION, blocks, assetIds },
    diagnostics,
  };
}
