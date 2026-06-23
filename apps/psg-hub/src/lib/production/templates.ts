/**
 * Production mail-merge engine (v1.3, PSG-42).
 *
 * Turns a Sanity-authored mail template + per-document merge data into the
 * print-ready HTML that feeds `MailDocument.front` / `.back` / `.file` (see
 * ./types.ts). The Lob adapter (./lob.ts) accepts HTML directly for postcard
 * front/back and letter `file`, so HTML — not PDF — is the critical submit
 * path; PDF rendering (./render-pdf.ts) is a thin follow-on for proofs and the
 * in-house print queue.
 *
 * This module is deliberately PURE: no DB, no Sanity client, no clock, no
 * network. The caller (the batch service, a follow-up) fetches the template
 * from Sanity and assembles `MailMergeData` from the customer / company /
 * `company_programs.customizations_jsonb` rows, then hands both here.
 *
 * Merge syntax is `{{ path }}` (whitespace optional), resolved against a flat
 * dotted path of `MailMergeData`. ONLY the substituted *values* are
 * HTML-escaped — the template body itself is author-trusted HTML. Unknown /
 * missing tokens collapse to "" and are reported back so a preview can flag a
 * template that references a field the shop has not filled in.
 *
 * Brand note (Decision D63): visual/brand design is Nick-owned. The defaults
 * below are a brand-aligned *starting point* (PSG palette, print geometry,
 * safe areas) that make the pipeline work end-to-end before Nick's design pass;
 * they are intentionally font-stack-only (no external font fetch) so they render
 * correctly when Lob renders the HTML server-side with no app origin to resolve
 * against.
 */

import type { MailAddress, MailDocument, MailPieceType } from "./types";

/** The PSG product a template is for. Mirrors the production piece catalog. */
export type MailProduct = "thank_you" | "warranty" | "envelope";

/**
 * Per-shop customization overrides, sourced from
 * `company_programs.customizations_jsonb` (PLANNING.md data model). Every field
 * is optional — a template references only what it needs and missing fields
 * collapse to "".
 */
export interface ProgramCustomizations {
  /** Absolute logo URL (Lob renders server-side; relative URLs will not resolve). */
  logo?: string;
  /** Header / masthead line override. */
  header?: string;
  /** Footer line override (e.g. legal / contact). */
  footer?: string;
  /** Greeting line override (e.g. "Thank you, {{customer.firstName}}!"). */
  greeting?: string;
  /** Free-form extra overrides referenced by bespoke templates. */
  [key: string]: string | undefined;
}

/** The end customer the piece is addressed to. */
export interface MailCustomer {
  firstName?: string;
  lastName?: string;
  /** Full display name; defaults to "firstName lastName" when absent. */
  fullName?: string;
  vehicle?: string;
  /** ISO date (yyyy-mm-dd) the work / repair completed, for warranty copy. */
  serviceDate?: string;
}

/** The body shop (PSG's client) the piece is sent on behalf of. */
export interface MailCompany {
  name?: string;
  phone?: string;
  email?: string;
  websiteUrl?: string;
  city?: string;
  state?: string;
}

/**
 * Pre-computed boolean / scalar flags a template can branch on via `{{#if}}`
 * blocks (L2, PSG-115c). PSG's variability model selects block content by
 * attribute — EV/ICE, in/out of warranty, repeat/first-time, repair-$ threshold
 * — so the trigger engine (./triggers.ts) resolves these flags once per
 * recipient and the template merely reads them. Keeping the values pre-computed
 * (rather than evaluating expressions in the template) matches the historical
 * Advantage model where each client picks a fixed trigger amount up front.
 */
export type TemplateFlags = Record<string, boolean | string | number | undefined>;

/** Everything a template can merge against. */
export interface MailMergeData {
  customer: MailCustomer;
  company: MailCompany;
  program: ProgramCustomizations;
  /**
   * Optional condition flags for `{{#if flags.xxx}}` block selection. Absent on
   * legacy templates, which render exactly as before.
   */
  flags?: TemplateFlags;
}

/**
 * The render-relevant slice of a Sanity `productionMailTemplate`. The caller
 * maps the Sanity document onto this shape; the engine never touches Sanity.
 */
export interface MailTemplate {
  product: MailProduct;
  pieceType: MailPieceType;
  /** Postcard front HTML (author-trusted, may contain `{{ }}` tokens). */
  frontHtml?: string;
  /** Postcard back HTML. */
  backHtml?: string;
  /** Letter body HTML. */
  bodyHtml?: string;
  /** Postcard size, e.g. "4x6" | "6x9" | "6x11". */
  size?: string;
  /** Letters only: color print. */
  color?: boolean;
}

/** Result of rendering a template's HTML content for a document. */
export interface RenderedMailContent {
  front?: string;
  back?: string;
  file?: string;
  /** Merge tokens referenced by the template that had no value. */
  missing: string[];
}

/** Escape a substituted merge value for safe HTML interpolation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve a dotted path ("customer.firstName") against the merge data. */
function resolvePath(data: MailMergeData, path: string): string | undefined {
  const segments = path.split(".");
  let cursor: unknown = data;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || cursor === undefined) return undefined;
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number" || typeof cursor === "boolean") return String(cursor);
  // Objects / arrays are never valid merge leaves.
  return undefined;
}

/**
 * Resolve a dotted path to its RAW value (un-stringified) for truthiness checks
 * in `{{#if}}` conditions. Unlike `resolvePath`, this does not coerce booleans
 * to "true"/"false" — `false` stays falsy.
 */
function resolveRaw(data: MailMergeData, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = data;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Truthiness for `{{#if}}` conditions. Empty string, the strings "false"/"0"/
 * "no" (case-insensitive), 0, NaN, null and undefined are falsy; everything else
 * is truthy. Objects/arrays are never valid condition leaves.
 */
function isTruthyValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0" && v !== "no";
  }
  return false;
}

type BlockToken =
  | { type: "text"; value: string }
  | { type: "if"; expr: string }
  | { type: "else" }
  | { type: "endif" };

const BLOCK_RE = /\{\{\s*#if\s+(!?[\w.]+)\s*\}\}|\{\{\s*else\s*\}\}|\{\{\s*\/if\s*\}\}/g;

/** Split a template into text + `{{#if}}`/`{{else}}`/`{{/if}}` control tokens. */
function tokenizeBlocks(template: string): BlockToken[] {
  const tokens: BlockToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((match = BLOCK_RE.exec(template)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", value: template.slice(last, match.index) });
    }
    if (match[1] !== undefined) tokens.push({ type: "if", expr: match[1] });
    else if (/else/.test(match[0])) tokens.push({ type: "else" });
    else tokens.push({ type: "endif" });
    last = match.index + match[0].length;
  }
  if (last < template.length) tokens.push({ type: "text", value: template.slice(last) });
  return tokens;
}

/**
 * Render `{{#if path}} … {{else}} … {{/if}}` conditional blocks (L2, PSG-115c)
 * against `data` BEFORE merge-field substitution. Conditions are a dotted path,
 * optionally negated with a leading `!`, evaluated for truthiness via
 * `isTruthyValue` (so `{{#if flags.isEV}}` / `{{#if !flags.inWarranty}}` work).
 * Blocks nest. Templates with no `{{#if` are returned untouched (fast path), so
 * existing pure-merge templates are unaffected.
 */
export function renderConditionalBlocks(template: string, data: MailMergeData): string {
  if (!template.includes("{{#if")) return template;
  const tokens = tokenizeBlocks(template);
  let i = 0;

  const renderUntil = (stops: ReadonlySet<BlockToken["type"]>): string => {
    let out = "";
    while (i < tokens.length) {
      const token = tokens[i];
      if (stops.has(token.type)) return out; // leave the stop token for the caller
      if (token.type === "text") {
        out += token.value;
        i++;
        continue;
      }
      if (token.type === "if") {
        const negate = token.expr.startsWith("!");
        const path = negate ? token.expr.slice(1) : token.expr;
        i++; // consume the #if
        const condition = negate
          ? !isTruthyValue(resolveRaw(data, path))
          : isTruthyValue(resolveRaw(data, path));
        const thenBranch = renderUntil(IF_STOPS);
        let elseBranch = "";
        if (i < tokens.length && tokens[i].type === "else") {
          i++; // consume the else
          elseBranch = renderUntil(ENDIF_STOPS);
        }
        if (i < tokens.length && tokens[i].type === "endif") i++; // consume the /if
        out += condition ? thenBranch : elseBranch;
        continue;
      }
      // Stray {{else}} / {{/if}} with no opener: drop it and continue.
      i++;
    }
    return out;
  };

  return renderUntil(NO_STOPS);
}

const NO_STOPS: ReadonlySet<BlockToken["type"]> = new Set();
const IF_STOPS: ReadonlySet<BlockToken["type"]> = new Set(["else", "endif"]);
const ENDIF_STOPS: ReadonlySet<BlockToken["type"]> = new Set(["endif"]);

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Substitute `{{ path }}` tokens in `template` with HTML-escaped values from
 * `data`. Conditional `{{#if}}` blocks (L2, PSG-115c) are resolved first, so a
 * single template can yield materially different copy by attribute. Synthesises
 * `customer.fullName` from first/last when not provided. Returns the rendered
 * string plus the list of tokens that resolved to nothing (deduped, in
 * first-seen order) so callers can surface incomplete templates.
 */
export function renderMergeFields(
  template: string,
  data: MailMergeData
): { html: string; missing: string[] } {
  const joinedName =
    [data.customer.firstName, data.customer.lastName].filter(Boolean).join(" ") || undefined;
  const enriched: MailMergeData = {
    ...data,
    customer: {
      ...data.customer,
      fullName: data.customer.fullName ?? joinedName,
    },
  };

  const selected = renderConditionalBlocks(template, enriched);
  const missing: string[] = [];
  const html = selected.replace(TOKEN_RE, (_match, path: string) => {
    const value = resolvePath(enriched, path);
    if (value === undefined || value === "") {
      if (!missing.includes(path)) missing.push(path);
      return "";
    }
    return escapeHtml(value);
  });
  return { html, missing };
}

/**
 * Render a template's HTML content for one document. Postcards yield
 * `front`/`back`; letters yield `file`. The returned strings are ready to drop
 * onto a `MailDocument` and submit to Lob (HTML) or render to PDF for the
 * in-house path. `missing` aggregates unresolved tokens across every rendered
 * surface.
 */
export function renderMailContent(
  template: MailTemplate,
  data: MailMergeData
): RenderedMailContent {
  const missing: string[] = [];
  const out: RenderedMailContent = { missing };

  const render = (html: string | undefined): string | undefined => {
    if (!html) return undefined;
    const result = renderMergeFields(html, data);
    for (const token of result.missing) {
      if (!missing.includes(token)) missing.push(token);
    }
    return result.html;
  };

  if (template.pieceType === "postcard") {
    out.front = render(template.frontHtml);
    out.back = render(template.backHtml);
  } else {
    out.file = render(template.bodyHtml);
  }
  return out;
}

export interface BuildMailDocumentArgs {
  template: MailTemplate;
  data: MailMergeData;
  /** Stable id used for correlation + Lob idempotency (e.g. production_documents.id). */
  documentId: string;
  to: MailAddress;
  from: MailAddress;
  /** Human-readable description shown in the Lob dashboard. */
  description?: string;
  /** Flat metadata echoed back on webhooks for correlation. */
  metadata?: Record<string, string>;
}

/**
 * Assemble a fully-rendered `MailDocument` from a template + merge data + the
 * addressing. Wires `front`/`back` (postcard) or `file` (letter), carries the
 * template's `size`/`color`, and returns the unresolved tokens so the batch
 * service / preview can block or flag an incomplete piece before submit.
 */
export function buildMailDocument(
  args: BuildMailDocumentArgs
): { document: MailDocument; missing: string[] } {
  const { template, data, documentId, to, from, description, metadata } = args;
  const content = renderMailContent(template, data);

  const document: MailDocument = {
    documentId,
    pieceType: template.pieceType,
    to,
    from,
    description,
    metadata,
  };
  if (template.pieceType === "postcard") {
    document.front = content.front;
    document.back = content.back;
    if (template.size) document.size = template.size;
  } else {
    document.file = content.file;
    document.color = template.color ?? false;
  }
  return { document, missing: content.missing };
}

/* -------------------------------------------------------------------------- */
/* Brand-aligned default templates (D63: Nick owns the final visual pass).    */
/* -------------------------------------------------------------------------- */

/** PSG palette + print primitives shared by the default templates. */
const BRAND = {
  midnight: "#1E3A52",
  ember: "#D88378",
  paper: "#FAFAFA",
  graphite: "#2A2A2A",
  mist: "#949494",
  fontDisplay: `"Helvetica Neue", Arial, system-ui, sans-serif`,
  fontBody: `Georgia, "Times New Roman", serif`,
} as const;

/**
 * Base print CSS for a 4x6 postcard side. Lob's 4x6 trim is 6.25in x 4.25in
 * with a 0.125in bleed and a 0.1875in safe margin; we render to the full bleed
 * size and keep content inside the safe area.
 */
function postcardStyle(): string {
  return `<style>
@page { size: 6.25in 4.25in; margin: 0; }
html, body { margin: 0; padding: 0; }
.side { box-sizing: border-box; width: 6.25in; height: 4.25in; padding: 0.3125in; position: relative; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${BRAND.fontBody}; color: ${BRAND.graphite}; }
.front { background: ${BRAND.midnight}; color: ${BRAND.paper}; display: flex; flex-direction: column; justify-content: center; }
.eyebrow { font-family: ${BRAND.fontDisplay}; text-transform: uppercase; letter-spacing: 0.18em; font-size: 11pt; color: ${BRAND.ember}; margin: 0 0 0.12in; }
.headline { font-family: ${BRAND.fontDisplay}; font-size: 30pt; line-height: 1.1; margin: 0 0 0.12in; }
.front .sub { font-size: 13pt; line-height: 1.4; max-width: 4.2in; color: ${BRAND.paper}; }
.back { background: ${BRAND.paper}; }
.greeting { font-family: ${BRAND.fontDisplay}; font-size: 16pt; color: ${BRAND.midnight}; margin: 0 0 0.1in; }
.body { font-size: 11.5pt; line-height: 1.5; max-width: 3.6in; }
.signoff { margin-top: 0.18in; font-size: 11.5pt; }
.company { font-family: ${BRAND.fontDisplay}; font-weight: 700; color: ${BRAND.midnight}; }
.contact { font-size: 9.5pt; color: ${BRAND.mist}; position: absolute; left: 0.3125in; bottom: 0.28in; }
</style>`;
}

/** Wrap a postcard side body in a self-contained HTML document. */
function postcardDoc(klass: string, inner: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    postcardStyle() +
    `</head><body><div class="side ${klass}">${inner}</div></body></html>`
  );
}

/** Base print CSS for a US-Letter letter body (Lob letters, #10 window envelope). */
function letterStyle(): string {
  return `<style>
@page { size: Letter; margin: 0; }
html, body { margin: 0; padding: 0; }
.page { box-sizing: border-box; width: 8.5in; min-height: 11in; padding: 1in 1in 0.75in; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${BRAND.fontBody}; color: ${BRAND.graphite}; font-size: 11.5pt; line-height: 1.55; }
.masthead { font-family: ${BRAND.fontDisplay}; font-size: 18pt; font-weight: 700; color: ${BRAND.midnight}; border-bottom: 2px solid ${BRAND.ember}; padding-bottom: 0.12in; margin-bottom: 0.4in; }
.recipient { margin-bottom: 0.4in; }
.greeting { margin: 0 0 0.18in; }
p { margin: 0 0 0.16in; }
.signoff { margin-top: 0.3in; }
.company { font-family: ${BRAND.fontDisplay}; font-weight: 700; color: ${BRAND.midnight}; }
.contact { font-size: 9.5pt; color: ${BRAND.mist}; margin-top: 0.1in; }
</style>`;
}

/** Wrap a letter body in a self-contained HTML document. */
function letterDoc(inner: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    letterStyle() +
    `</head><body><div class="page">${inner}</div></body></html>`
  );
}

/**
 * The brand-aligned default templates, one per product. These are the fallback
 * used when a shop has no custom Sanity template; they reference the standard
 * merge fields so per-shop `customizations_jsonb` (greeting/footer/header)
 * flows through automatically.
 */
export const DEFAULT_TEMPLATES: Record<MailProduct, MailTemplate> = {
  thank_you: {
    product: "thank_you",
    pieceType: "postcard",
    size: "4x6",
    frontHtml: postcardDoc(
      "front",
      `<p class="eyebrow">{{company.name}}</p>` +
        `<h1 class="headline">Thank you for trusting us with your repair.</h1>` +
        `<p class="sub">It was our pleasure getting you back on the road.</p>`
    ),
    backHtml: postcardDoc(
      "back",
      `<p class="greeting">{{program.greeting}}</p>` +
        `<p class="greeting">Dear {{customer.firstName}},</p>` +
        `<p class="body">Thank you for choosing {{company.name}} to repair your {{customer.vehicle}}. ` +
        `We stand behind our work and we are grateful for your trust. If anything is less than perfect, ` +
        `please reach out — we will make it right.</p>` +
        `<p class="signoff">Warm regards,<br /><span class="company">{{company.name}}</span></p>` +
        `<p class="contact">{{program.footer}} {{company.phone}} &middot; {{company.websiteUrl}}</p>`
    ),
  },
  warranty: {
    product: "warranty",
    pieceType: "letter",
    color: true,
    bodyHtml: letterDoc(
      `<div class="masthead">{{company.name}}</div>` +
        `<div class="recipient">{{customer.fullName}}</div>` +
        `<p class="greeting">Dear {{customer.firstName}},</p>` +
        `<p>{{program.greeting}}</p>` +
        `<p>Your {{customer.vehicle}}, repaired on {{customer.serviceDate}}, is covered by our written ` +
        `workmanship warranty. We guarantee the quality of the repairs performed for as long as you own ` +
        `the vehicle.</p>` +
        `<p>If you notice any issue related to our work, contact us at {{company.phone}} and we will ` +
        `schedule an inspection at no charge to you.</p>` +
        `<p class="signoff">Sincerely,<br /><span class="company">{{company.name}}</span></p>` +
        `<p class="contact">{{program.footer}} {{company.websiteUrl}} &middot; {{company.email}}</p>`
    ),
  },
  envelope: {
    product: "envelope",
    pieceType: "letter",
    color: false,
    bodyHtml: letterDoc(
      `<div class="masthead">{{company.name}}</div>` +
        `<p>{{customer.fullName}}</p>`
    ),
  },
};

/**
 * Pick the brand-aligned default template for a product. Used when a shop has
 * no custom Sanity template; the result feeds straight into `renderMailContent`
 * / `buildMailDocument`.
 */
export function defaultTemplate(product: MailProduct): MailTemplate {
  return DEFAULT_TEMPLATES[product];
}
