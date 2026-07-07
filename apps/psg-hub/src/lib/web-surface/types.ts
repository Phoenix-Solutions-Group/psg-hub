// BSM Phase 1 / PSG-776 — Web-surface delivery contract.
//
// This is the shared seam that turns a PUBLISHED `service_page` content item
// (the system-of-record row in `content_items`, status='published') into a
// LIVE web page a shop's customers can see and click.
//
// It is INTENTIONALLY pure (no `server-only`, no React, no Supabase, no I/O) so
// it is node-testable and importable from three places that must agree on one
// contract:
//   1. the assembler          — `assembleServicePage()` (PSG-776, Ravi)
//   2. the public site route  — `app/(site)/s/[shopSlug]/[pageSlug]` (PSG-776, Nora)
//   3. the C2 conversion gate — `checkConversionStructure()` (PSG-773)
//
// Design decision of record (see docs/adr/psg-776-web-surface-delivery.md):
// delivery target = server-rendered Next.js pages on the existing Vercel prod
// pipeline (NOT an external CMS push). The artifact below is the intermediate
// representation both the renderer and the gate consume, so the gate can prove
// the "Call + Estimate" structure is present WITHOUT re-parsing final HTML.

/** A real tap-to-call action. `tel` is the dialable target (E.164 preferred). */
export type CallAction = {
  /** Dialable phone the `tel:` link points at, e.g. "+19143403604". */
  tel: string;
  /** Visible button/link label, e.g. "Call (914) 340-3604". */
  label: string;
  /**
   * Which section this action lives in. The C2 gate requires at least one
   * call action anchored in `"hero"` (reachable in the first screen).
   */
  placement: SectionKind;
};

/** The "get a free estimate" action (a form submit or an anchor to the form). */
export type EstimateAction = {
  /**
   * Where the estimate action goes. For the in-page form this is the anchor of
   * the form section (e.g. "#estimate"); the form itself POSTs to `leadEndpoint`.
   */
  href: string;
  /** Visible label, e.g. "Get a free estimate". */
  label: string;
  /**
   * The lead-capture endpoint the estimate form POSTs to (per-shop). The route
   * layer wires this; the assembler records it so the gate can assert the form
   * is actually connected to a delivery path, not a dead stub.
   */
  leadEndpoint: string;
  placement: SectionKind;
};

/** The conversion contract a live service page MUST satisfy (BSM standard C2). */
export type ConversionBlock = {
  /** Every tap-to-call action on the page. At least one must be in the hero. */
  callActions: CallAction[];
  /** Every estimate action on the page. At least one required. */
  estimateActions: EstimateAction[];
  /**
   * How many times the primary call-to-action is surfaced as the reader scrolls
   * (hero + at least one repeat further down). The gate flags a page whose
   * primary action appears only once.
   */
  primaryCtaOccurrences: number;
};

/** The kinds of section the assembler emits, top-to-bottom. */
export type SectionKind =
  | "hero"
  | "trust" // certifications / warranty / rating (honesty-gated, from verified facts)
  | "services"
  | "reviews"
  | "estimate" // the lead-capture form section
  | "cta" // a repeated call-to-action band
  | "footer";

/** One rendered section of the page. `html` is the section's markup fragment. */
export type Section = {
  kind: SectionKind;
  /** Rendered, escaped, self-contained HTML fragment for this section. */
  html: string;
  /** Optional in-page anchor id (e.g. "estimate") for CTA targeting. */
  anchor?: string;
};

/** Page-level metadata used for <head>, canonical URL, and social cards. */
export type WebSurfaceMeta = {
  title: string;
  description: string;
  /** Canonical public path this page is served at, e.g. "/s/tedesco/collision-repair". */
  canonicalPath: string;
  shopName: string;
};

/**
 * The assembled web-surface artifact — the single value the renderer serves and
 * the C2 gate inspects. `html` is the complete document body the browser gets;
 * `conversion` is the machine-checkable proof of the Call+Estimate structure.
 */
export type WebSurfaceArtifact = {
  meta: WebSurfaceMeta;
  sections: Section[];
  conversion: ConversionBlock;
  /** The complete rendered document (or body) string served to the browser. */
  html: string;
};

/**
 * Inputs to the assembler. The published content item is the source-of-record;
 * `shop` supplies the real dialable phone + slug + address; `facts` is the
 * verified-facts record that gates every honesty-sensitive claim on the page
 * (reused from `@/lib/claim-integrity` — the assembler must never surface a
 * fact absent from this record).
 */
export type AssembleInput = {
  item: PublishedServicePage;
  shop: WebSurfaceShop;
  /** Verified facts (import type from "@/lib/claim-integrity" at the call site). */
  facts: unknown;
};

/** The subset of a published `content_items` row the assembler reads. */
export type PublishedServicePage = {
  id: string;
  shopId: string;
  type: "service_page";
  status: "published";
  title: string;
  /** Body as stored: paragraph blocks (see agent-engine drafts) or markdown. */
  body: string | string[];
  publishedAt?: string | null;
};

/** The subset of a `shops` row the assembler + route read. */
export type WebSurfaceShop = {
  id: string;
  name: string;
  /** URL slug segment, e.g. "tedesco". Required to build the canonical path. */
  slug: string;
  /** Real dialable phone from the shops record — the tap-to-call source. */
  telephone: string | null;
  addressStreet?: string | null;
  addressLocality?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  googlePlaceId?: string | null;
};
