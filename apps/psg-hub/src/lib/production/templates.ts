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

/**
 * The PSG product a template is for. Mirrors the production piece catalog.
 *
 * `thank_you` is the W1 master "Thank-You + ACRB survey" letter (PSG-115a /
 * PSG-308, faithful US-Letter productization of the real PS682/PS105 pieces);
 * `service_recovery` is the W1 master owner service-recovery letter ("The
 * Owner's Direct Line"). Both are authored as block-decomposed letters here.
 */
export type MailProduct =
  | "thank_you"
  | "warranty"
  | "envelope"
  | "service_recovery"
  | "self_mailer";

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
  /**
   * Per-shop workmanship-warranty TERM clause. Honest-claims go-live gate
   * (PSG-316 C1): the warranty duration is NOT universal — each shop asserts only
   * its own term. Warranty copy tokenizes this as `{{program.warrantyTerm}}` so no
   * shop ever prints another shop's term.
   *
   * AUTHORING CONTRACT (Lee, PSG-322): the copy frames read "covered — {{term}}",
   * "warranty {{term}}", "performed {{term}}", so author this as a clause that
   * BEGINS WITH "for …", e.g. "for as long as you own the vehicle" or "for 12
   * months or 12,000 miles, whichever comes first". A bare "12 months / 12k miles"
   * (no leading "for") reads off in those frames.
   *
   * Fail-closed: unconfigured → the token resolves to nothing and the proof gate's
   * missing-token report blocks the piece (never an invented term).
   */
  warrantyTerm?: string;
  /**
   * Per-shop review destination URL (Google/Yelp/etc.) for the post-fix review
   * ask (PSG-316 C3, optional enhancement). When set, the review CTA becomes a
   * one-click link; when unset, copy falls back to the generic "online" ask via a
   * `{{#if program.reviewLink}}` block — so an unconfigured shop still sends.
   *
   * PRINT NOTE (Lee, PSG-322): this renders as a RAW URL inline on a printed
   * letter — recipients type it by hand. Configure a short, human-typable review
   * URL (g.page short link / vanity), not a long tracking URL.
   */
  reviewLink?: string;

  /* W1 master-template skin keys (PSG-219 §2 → PSG-308). All flat strings so the
   * engine's resolvePath resolves them; missing keys collapse to "". */
  /** Hex accent override for the `ember` accent token. */
  accent?: string;
  /** Owner's name, rendered under the signature. */
  ownerName?: string;
  /** Owner's title under the signature (e.g. "Owner"). */
  ownerTitle?: string;
  /** Owner first name for the survey P.S. sign-off. */
  ownerFirstName?: string;
  /** Absolute URL of the owner's hand-signature PNG (transparent). */
  ownerSignatureUrl?: string;
  /** Owner's direct/cell line for the service-recovery letter. */
  ownerDirectLine?: string;
  /** Masthead shop address, line 1 (street). */
  addressLine1?: string;
  /** Masthead shop address, line 2 (city/state/zip). */
  addressLine2?: string;
  /** ACRB survey landing URL (e.g. "www.theacrb.com"). */
  surveyUrl?: string;
  /** Footer tagline (center of the tri-part footer). */
  tagline?: string;
  /** Footer piece code (left of the tri-part footer, e.g. "PS682"). */
  pieceCode?: string;
  /** Footer job number (right of the tri-part footer). */
  jobNumber?: string;
  /** Pre-rendered certifications string the shop actually holds (honest-claims). */
  certifications?: string;
  /**
   * Truthy when the shop offers a written workmanship warranty — the PS105
   * warranty paragraph (a `{{#if program.hasWarranty}}` block) renders only then.
   */
  hasWarranty?: string;

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
  /** Short vehicle reference (e.g. "Accord") for in-body copy. */
  vehicleShort?: string;
  /** ISO date (yyyy-mm-dd) the work / repair completed, for warranty copy. */
  serviceDate?: string;

  /* W1 master-template per-recipient fields (PSG-219 §2/§3 → PSG-308). These
   * ride on the customer/RO feed, never on the per-shop skin. */
  /** Letter dateline (display string, e.g. "June 2026"). */
  letterDate?: string;
  /** Recipient mailing street line (for the #10 window address block). */
  addressLine1?: string;
  /** Recipient city. */
  city?: string;
  /** Recipient state. */
  state?: string;
  /** Recipient ZIP. */
  zip?: string;
  /** ACRB per-recipient online security code (survey P.S.). */
  surveySecurityCode?: string;
  /** ACRB per-recipient survey ID (survey P.S.). */
  surveyId?: string;
  /** Repair-order number (footer job number / correlation). */
  roNumber?: string;
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
  /** Letter body HTML. Legacy self-mailer templates may fall back to this as inside art. */
  bodyHtml?: string;
  /** Self-mailer inside-panel HTML. */
  insideHtml?: string;
  /** Self-mailer outside-panel HTML, including the address/postage clear panel. */
  outsideHtml?: string;
  /** Mail size, e.g. "4x6" | "6x9" | "6x11" | "6x18_bifold". */
  size?: string;
  /** Letters and self-mailers only: color print. */
  color?: boolean;
}

/** Result of rendering a template's HTML content for a document. */
export interface RenderedMailContent {
  front?: string;
  back?: string;
  file?: string;
  inside?: string;
  outside?: string;
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
  } else if (template.pieceType === "self_mailer") {
    out.inside = render(template.insideHtml ?? template.bodyHtml);
    out.outside = render(template.outsideHtml);
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
 * addressing. Wires `front`/`back` (postcard), `file` (letter), or
 * `inside`/`outside` (self-mailer), carries the template's `size`/`color`, and
 * returns unresolved tokens so the batch service / preview can block or flag an
 * incomplete piece before submit.
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
  } else if (template.pieceType === "self_mailer") {
    document.inside = content.inside;
    document.outside = content.outside;
    document.color = template.color ?? false;
    if (template.size) document.size = template.size;
  } else {
    document.file = content.file;
    document.color = template.color ?? false;
    if (template.size) document.size = template.size;
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

// NOTE: the prior brand-aligned 4x6 postcard chassis (postcardStyle/postcardDoc)
// was removed when the W1 thank-you was re-anchored to the faithful US-Letter
// (PSG-308; the postcard was a first-cut invention — design-system doc §0/§4).
// The engine still renders postcards generically (renderMailContent/
// buildMailDocument handle `pieceType: "postcard"`); a postcard "nudge" piece is
// a documented W2+ opt-in and can be authored fresh when scoped. The W2 letter
// matrix (./letter-matrix.ts) composes its pieces via `letterDoc` (US-Letter).

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
export function letterDoc(inner: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    letterStyle() +
    `</head><body><div class="page">${inner}</div></body></html>`
  );
}

/** Base print CSS for Lob's default 6x18 bifold self-mailer. */
function selfMailerStyle(): string {
  return `<style>
@page { size: 18in 6in; margin: 0; }
html, body { margin: 0; padding: 0; }
.sheet { box-sizing: border-box; width: 18in; height: 6in; display: grid; grid-template-columns: repeat(3, 1fr); -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${BRAND.fontBody}; color: ${BRAND.graphite}; background: #fff; }
.panel { box-sizing: border-box; padding: 0.45in; border-right: 1px dashed #cbd5e1; }
.panel:last-child { border-right: 0; }
.masthead { font-family: ${BRAND.fontDisplay}; font-weight: 700; color: ${BRAND.midnight}; font-size: 20pt; border-bottom: 2px solid ${BRAND.ember}; padding-bottom: 0.08in; margin-bottom: 0.22in; }
.eyebrow { font-family: ${BRAND.fontDisplay}; text-transform: uppercase; font-size: 8pt; color: ${BRAND.ember}; letter-spacing: 0.05em; }
.headline { font-family: ${BRAND.fontDisplay}; font-weight: 700; font-size: 18pt; line-height: 1.12; color: ${BRAND.midnight}; margin: 0.1in 0 0.2in; }
p { margin: 0 0 0.13in; font-size: 10.5pt; line-height: 1.42; }
.signature { margin-top: 0.2in; font-family: ${BRAND.fontDisplay}; color: ${BRAND.midnight}; font-weight: 700; }
.address-clear-zone { min-height: 2.15in; border: 1px dashed #94a3b8; background: #fff; margin-bottom: 0.2in; }
.address-note { font-family: ${BRAND.fontDisplay}; color: #64748b; font-size: 8pt; text-transform: uppercase; }
.return { font-size: 9pt; color: ${BRAND.graphite}; }
.cta { font-family: ${BRAND.fontDisplay}; font-weight: 700; color: ${BRAND.ember}; }
</style>`;
}

/** Wrap one self-mailer side in a self-contained, panelized 6x18 document. */
function selfMailerDoc(inner: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    selfMailerStyle() +
    `</head><body><div class="sheet">${inner}</div></body></html>`
  );
}

/* -------------------------------------------------------------------------- */
/* W1 master letter chassis (PSG-219 brand system → PSG-308).                 */
/* Faithful US-Letter productization of PSG's real library pieces: shop        */
/* identity leads, hand-signed owner signature, tri-part footer. Shared by the */
/* Thank-You+ACRB-survey and the owner service-recovery masters; per-shop      */
/* variability flows entirely through the `program.*` skin (customizations_jsonb). */
/* -------------------------------------------------------------------------- */

/**
 * Print CSS for a W1 master letter. US-Letter, full-bleed, content inside the
 * 1in/0.75in safe area; first page top reserved for the #10 window address
 * block. Font-stack only (Lob renders server-side, no webfonts). BRAND tokens
 * are inlined (matching letterStyle/postcardStyle house style) — no CSS custom
 * properties — so the HTML renders identically wherever Lob rasterizes it.
 */
function masterLetterStyle(): string {
  return `<style>
@page { size: 8.5in 11in; margin: 0; }
html, body { margin: 0; padding: 0; }
.page { box-sizing: border-box; width: 8.5in; min-height: 11in; background: #FFFFFF; padding: 0.75in 1in; position: relative; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: ${BRAND.fontBody}; color: ${BRAND.graphite}; }
.masthead { display: flex; align-items: flex-end; justify-content: space-between; padding-bottom: 0.06in; }
.masthead .addr, .masthead .tel { font-family: ${BRAND.fontDisplay}; font-size: 9.5pt; line-height: 1.35; color: ${BRAND.graphite}; border-bottom: 1.25px solid ${BRAND.midnight}; padding-bottom: 0.04in; min-width: 2.1in; }
.masthead .tel { text-align: right; }
.masthead .logo { text-align: center; flex: 1; padding: 0 0.25in; }
.masthead .logo img { max-height: 0.7in; max-width: 2.6in; }
.masthead .logo .name { font-family: ${BRAND.fontDisplay}; font-weight: 700; font-size: 17pt; letter-spacing: 0.04em; color: ${BRAND.midnight}; }
.date { margin: 0.5in 0 0.35in; font-size: 11pt; }
.address { font-size: 11pt; line-height: 1.4; margin-bottom: 0.45in; }
.salutation { font-size: 11.5pt; margin: 0 0 0.14in; }
.headline { font-family: ${BRAND.fontDisplay}; font-size: 13pt; font-weight: 700; color: ${BRAND.midnight}; margin: 0 0 0.16in; }
.body p { font-size: 11.5pt; line-height: 1.52; margin: 0 0 0.16in; max-width: 6.4in; }
.ps { font-size: 11.5pt; line-height: 1.52; margin: 0.18in 0 0; max-width: 6.4in; }
.ps .field { font-family: ${BRAND.fontDisplay}; font-weight: 700; color: ${BRAND.midnight}; }
.ps .val { font-family: ${BRAND.fontDisplay}; color: ${BRAND.ember}; text-decoration: underline; letter-spacing: 0.02em; }
.signoff { font-size: 11.5pt; margin: 0.22in 0 0; }
.sig-img { height: 0.5in; display: block; margin: 0.04in 0; }
.sig-fallback { font-family: ${BRAND.fontDisplay}; font-style: italic; font-weight: 700; color: ${BRAND.midnight}; font-size: 16pt; margin: 0.06in 0; }
.sig-name { font-family: ${BRAND.fontDisplay}; font-weight: 700; color: ${BRAND.midnight}; font-size: 12pt; }
.sig-title { font-size: 10.5pt; color: ${BRAND.graphite}; }
.sig-contact { font-size: 10.5pt; color: ${BRAND.graphite}; margin-top: 0.04in; }
.footer { position: absolute; left: 1in; right: 1in; bottom: 0.5in; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #e2e2e2; padding-top: 0.08in; }
.footer .code, .footer .job { font-family: ${BRAND.fontDisplay}; font-size: 8.5pt; color: ${BRAND.mist}; }
.footer .tagline { font-style: italic; font-size: 11pt; color: ${BRAND.midnight}; text-align: center; flex: 1; }
</style>`;
}

/** Wrap a W1 master letter body in a self-contained HTML document. */
function masterLetterDoc(inner: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    masterLetterStyle() +
    `</head><body><div class="page">${inner}</div></body></html>`
  );
}

/**
 * `masthead` block — shop identity leads (never PSG): address left, logo center
 * (typeset shop-name fallback so the piece always mails — PSG-219 §1.4), phone /
 * website right. Rules under address and phone per the real letterhead.
 */
const MASTER_MASTHEAD =
  `<!-- block:masthead -->` +
  `<div class="masthead">` +
  `<div class="addr">{{program.addressLine1}}<br/>{{program.addressLine2}}</div>` +
  `<div class="logo">` +
  `{{#if program.logo}}<img src="{{program.logo}}" alt="{{company.name}}" />` +
  `{{else}}<div class="name">{{company.name}}</div>{{/if}}` +
  `</div>` +
  `<div class="tel">Phone: {{company.phone}}<br/>{{company.websiteUrl}}</div>` +
  `</div>` +
  `<!-- /block:masthead -->`;

/** Dateline + `address` block (recipient / #10 window). */
const MASTER_DATE_ADDRESS =
  `<p class="date">{{customer.letterDate}}</p>` +
  `<!-- block:address -->` +
  `<div class="address">` +
  `{{customer.fullName}}<br/>` +
  `{{customer.addressLine1}}<br/>` +
  `{{customer.city}}, {{customer.state}} {{customer.zip}}` +
  `</div>` +
  `<!-- /block:address -->`;

/**
 * `signature` block — hand-signed owner convention (PSG-219 §1.4). The owner's
 * hand-signature PNG when present; typeset display-italic owner name as the
 * fallback so the piece still mails. `signoff` is the closing line ("Sincerely,"
 * / "Personally,"); `extra` carries an optional direct-contact line.
 */
function masterSignature(signoff: string, extra = ""): string {
  return (
    `<!-- block:signature -->` +
    `<p class="signoff">${signoff}</p>` +
    `{{#if program.ownerSignatureUrl}}<img class="sig-img" src="{{program.ownerSignatureUrl}}" alt="" />` +
    `{{else}}<div class="sig-fallback">{{program.ownerName}}</div>{{/if}}` +
    `<div class="sig-name">{{program.ownerName}}</div>` +
    `<div class="sig-title">{{program.ownerTitle}}</div>` +
    extra +
    `<!-- /block:signature -->`
  );
}

/** `footer` block — real tri-part convention: piece code · tagline · job number. */
function masterFooter(pieceCode = "{{program.pieceCode}}"): string {
  return (
  `<!-- block:footer -->` +
  `<div class="footer">` +
  `<span class="code">${pieceCode}</span>` +
  `<span class="tagline">{{program.tagline}}</span>` +
  `<span class="job">{{program.jobNumber}}</span>` +
  `</div>` +
    `<!-- /block:footer -->`
  );
}

const MASTER_FOOTER = masterFooter();

const SELF_MAILER_DEFAULT_SIZE = "6x18_bifold";

/**
 * The brand-aligned default templates, one per product. These are the fallback
 * used when a shop has no custom Sanity template; they reference the standard
 * merge fields so per-shop `customizations_jsonb` (greeting/footer/header)
 * flows through automatically.
 */
export const DEFAULT_TEMPLATES: Record<MailProduct, MailTemplate> = {
  // W1 Piece 1 — Thank-You + ACRB survey, Direction A "Faithful Letter"
  // (PSG-219 §4, locked A/A → PSG-308). 1:1 productization of the real PS682 /
  // PS105 US-Letter pieces: warm owner-voice thanks, the PS105 warranty
  // paragraph as a `{{#if program.hasWarranty}}` variant block, the ACRB survey
  // ask as a P.S. with the recipient's security code + survey ID, hand signature,
  // tri-part footer. (The prior 4x6 postcard was a first-cut invention; the real
  // piece is a letter — see the design-system doc §0 source reconciliation.)
  thank_you: {
    product: "thank_you",
    pieceType: "letter",
    color: true,
    bodyHtml: masterLetterDoc(
      MASTER_MASTHEAD +
        MASTER_DATE_ADDRESS +
        `<p class="salutation">Dear {{customer.firstName}},</p>` +
        `<!-- block:body -->` +
        `<div class="body">` +
        `<p>Please accept my personal thanks for choosing {{company.name}} to handle the repair of ` +
        `your {{customer.vehicle}}. We realize that you have options, and we are especially grateful ` +
        `that you have chosen us. When it comes to collision repair, we understand the level of trust ` +
        `it takes to earn your business, and we never take that for granted.</p>` +
        `<p>Should you have the slightest question or concern with any aspect of the repair of your ` +
        `{{customer.vehicleShort}}, please notify us immediately. You and your family&rsquo;s safety ` +
        `and peace of mind are more important to us than anything else we do here.</p>` +
        // block:warranty — PS105 variant; renders only when the shop offers a written warranty.
        `{{#if program.hasWarranty}}<!-- block:warranty --><p>All our repairs carry a written ` +
        `workmanship warranty designed to deliver total satisfaction and protection for you. Enclosed you will find ` +
        `your completed warranty. Review it carefully and, as with any important document, please retain ` +
        `it in a safe place. If you have any questions regarding your warranty, call at any time.</p>` +
        `<!-- /block:warranty -->{{/if}}` +
        `<p>Thank you again for your business and confidence.</p>` +
        `</div>` +
        `<!-- /block:body -->` +
        masterSignature("Sincerely,") +
        `<!-- block:survey-cta -->` +
        `<p class="ps">P.S. You will soon receive a satisfaction survey from the Automotive Customer ` +
        `Relations Bureau about your experience here. Your feedback helps us improve our service, so ` +
        `please let them know how you feel. To respond right away, go to ` +
        `<span class="field">{{program.surveyUrl}}</span> and enter your ` +
        `<span class="field">Online Security Code:</span> <span class="val">{{customer.surveySecurityCode}}</span> ` +
        `and your <span class="field">Survey ID:</span> <span class="val">{{customer.surveyId}}</span>. ` +
        `Thank you. {{program.ownerFirstName}}</p>` +
        `<!-- /block:survey-cta -->` +
        MASTER_FOOTER
    ),
  },
  warranty: {
    product: "warranty",
    pieceType: "letter",
    color: true,
    bodyHtml: masterLetterDoc(
      MASTER_MASTHEAD +
        MASTER_DATE_ADDRESS +
        `<p class="salutation">Dear {{customer.firstName}},</p>` +
        `<!-- block:headline -->` +
        `<div class="headline">Your workmanship warranty</div>` +
        `<!-- /block:headline -->` +
        `<!-- block:body -->` +
        `<div class="body">` +
        `<p>Thank you again for trusting {{company.name}} with your {{customer.vehicle}}. This letter confirms ` +
        `the written workmanship warranty on that repair.</p>` +
        `<p>Your {{customer.vehicle}}, repaired on {{customer.serviceDate}}, is covered by our written ` +
        `workmanship warranty. We guarantee the quality of the repairs performed ` +
        `{{program.warrantyTerm}}.</p>` +
        `<p>If you notice any issue related to our work, contact us at {{company.phone}} and we will ` +
        `schedule an inspection at no charge to you.</p>` +
        `</div>` +
        `<!-- /block:body -->` +
        masterSignature("Sincerely,") +
        masterFooter("PS105")
    ),
  },
  envelope: {
    product: "envelope",
    pieceType: "letter",
    color: true,
    bodyHtml: masterLetterDoc(
      MASTER_MASTHEAD +
        MASTER_DATE_ADDRESS +
        `<p class="salutation">Dear {{customer.firstName}},</p>` +
        `<!-- block:body -->` +
        `<div class="body">` +
        `<p>Thank you again for choosing {{company.name}}. We appreciate the trust you placed in us ` +
        `to care for your {{customer.vehicle}}.</p>` +
        `{{#if program.hasWarranty}}<p>Your repair warranty is enclosed.</p>{{/if}}` +
        `</div>` +
        `<!-- /block:body -->` +
        masterSignature("Sincerely,") +
        MASTER_FOOTER
    ),
  },
  self_mailer: {
    product: "self_mailer",
    pieceType: "self_mailer",
    size: SELF_MAILER_DEFAULT_SIZE,
    color: true,
    insideHtml: selfMailerDoc(
      `<section class="panel">` +
        `<div class="eyebrow">Thank you</div>` +
        `<div class="headline">We appreciate your trust.</div>` +
        `<p>Thank you for choosing {{company.name}} for your {{customer.vehicle}}.</p>` +
        `<p>Your feedback helps us keep improving the repair experience for every customer.</p>` +
        `</section>` +
        `<section class="panel">` +
        `<div class="eyebrow">Questions</div>` +
        `<div class="headline">Call us directly.</div>` +
        `<p>If anything about your repair needs attention, call {{company.phone}} and we will help right away.</p>` +
        `<p class="signature">{{program.ownerName}}<br />{{program.ownerTitle}}</p>` +
        `</section>` +
        `<section class="panel">` +
        `<div class="eyebrow">Survey</div>` +
        `<div class="headline">Tell us how we did.</div>` +
        `<p>Visit <span class="cta">{{program.surveyUrl}}</span> and enter security code ` +
        `<strong>{{customer.surveySecurityCode}}</strong> and survey ID <strong>{{customer.surveyId}}</strong>.</p>` +
        `</section>`
    ),
    outsideHtml: selfMailerDoc(
      `<section class="panel">` +
        `<div class="masthead">{{company.name}}</div>` +
        `<p class="return">{{program.addressLine1}}<br />{{program.addressLine2}}</p>` +
        `<p>{{company.phone}}</p>` +
        `</section>` +
        `<section class="panel">` +
        `<div class="address-clear-zone"></div>` +
        `<p class="address-note">Address and postage clear zone</p>` +
        `</section>` +
        `<section class="panel">` +
        `<div class="headline">A note from your repair team</div>` +
        `<p>Open for a short follow-up from {{company.name}} about your recent repair.</p>` +
        `</section>`
    ),
  },
  // W1 Piece 2 — Owner service-recovery, Direction A "The Owner's Direct Line"
  // (PSG-219 §5, locked A/A → PSG-308). The highest-stakes letter PSG mails:
  // triggered by an ACRB "Hot Spot / Unresolved" survey alert, its one job is to
  // get the customer to call the owner directly so the shop can make it right.
  // Austere/sincere — zero marketing gloss: acknowledge → apologize → commit,
  // reaffirm the guarantee (variant block), hand-signed by the owner with a
  // direct line. Productized from the closest library sources (#10 ACRB Report
  // Card + #15 owner check-in); re-anchored 1:1 if PSG supplies the original.
  service_recovery: {
    product: "service_recovery",
    pieceType: "letter",
    color: true,
    bodyHtml: masterLetterDoc(
      MASTER_MASTHEAD +
        MASTER_DATE_ADDRESS +
        `<p class="salutation">Dear {{customer.firstName}},</p>` +
        `<!-- block:headline -->` +
        `<div class="headline">A personal note from the owner</div>` +
        `<!-- /block:headline -->` +
        `<!-- block:body -->` +
        `<div class="body">` +
        `<p>I am writing to you personally. I understand that your recent experience with the repair ` +
        `of your {{customer.vehicle}} did not fully meet your expectations, and for that I am sorry. ` +
        `That is not the standard we hold ourselves to, and it is not the experience I want for anyone ` +
        `who trusts us with their vehicle.</p>` +
        `<p>Your satisfaction &mdash; and your family&rsquo;s safety and peace of mind &mdash; matter ` +
        `more to me than anything else we do here. I would like the chance to understand exactly what ` +
        `happened and to make it right.</p>` +
        // block:warranty — reaffirm the guarantee when the shop offers a written warranty.
        // Honest-claims C1 (PSG-331): the duration is tokenized as `{{program.warrantyTerm}}`
        // (PSG-316's per-shop term clause, authored "for …") so a finite-term shop never
        // prints a lifetime claim. Fail-closed: hasWarranty true + term unset → missing token
        // → proof gate blocks. Renders byte-identical when warrantyTerm is the lifetime clause.
        `{{#if program.hasWarranty}}<!-- block:warranty --><p>Every repair we perform is backed by our ` +
        `written workmanship warranty {{program.warrantyTerm}}. That guarantee still stands, ` +
        `and I stand behind it personally.</p><!-- /block:warranty -->{{/if}}` +
        `<p>Please call me directly at {{program.ownerDirectLine}}. If I am not in when you call, leave ` +
        `a message and I will personally call you back. There is no concern too small to bring to my ` +
        `attention.</p>` +
        `</div>` +
        `<!-- /block:body -->` +
        masterSignature(
          "Personally,",
          `<div class="sig-contact">Direct line: {{program.ownerDirectLine}}</div>`
        ) +
        MASTER_FOOTER
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
