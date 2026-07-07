// PSG-668 / PSG-611 — one-time delivery template registry + deal-won selector.
//
// The problem this solves: today the deal-won webhook ALWAYS builds the new-client
// onboarding board (`provisionOnboardingBoard`). PSG now has a library of net-new
// one-time templates (PSG-611) — the first is New Website Build (PSG-650) — and a won
// deal should build the board that matches the product that was SOLD.
//
// This module is the "shared build-once selector" CTO Ada flagged on PSG-661: a small
// registry of one-time templates, a `selectTemplate(deal, products)` that maps a won
// deal to one of them by the SKU/name on its line items, and `provisionForDeal(...)` —
// the drop-in the webhook calls instead of `provisionOnboardingBoard`.
//
// CONSERVATIVE FALLBACK IS THE CONTRACT (AC-1, no regression): any deal we cannot map
// *confidently* to a net-new template — zero products, an unmapped product, OR an
// ambiguous match (two different templates match) — falls back to today's onboarding
// board. We never build the wrong specialised board on a guess.
//
// Scope: this governs ONLY the one-time deal-won path (PSG-606). Recurring boards stay
// on the recurrence engine (PSG-607) and are untouched here.

import type { OnboardingPhase, OnboardingRole } from "./onboarding-template";
import { WHM_ONBOARDING_TEMPLATE } from "./onboarding-template";
import { NEW_WEBSITE_BUILD_TEMPLATE } from "./web-build-template";
import {
  provisionOnboardingBoard,
  deliveryProjectTitle,
  type PipedriveProjectsClient,
  type WonDeal,
  type DealProduct,
  type ProvisionResult,
} from "./projects";

/**
 * A one-time delivery template the deal-won path can build. `matchSkus`/`matchNames`
 * are how a won deal's line items map to this template; `boardIdEnv`/`phaseIdEnv` name
 * the env vars holding the Pipedrive board + kanban phase to drop the project into
 * (each optional at runtime — if unset the onboarding board/phase is reused, exactly
 * like the recurring board falls back to the onboarding board today, PSG-606).
 */
export interface OneTimeTemplateDef {
  /** Stable id (used in logs / provisioning evidence). */
  readonly id: string;
  /** Human template-family label (also the project-title prefix source). */
  readonly family: string;
  /** Project-title prefix, e.g. `Onboarding` or `New Website Build`. */
  readonly titlePrefix: string;
  /** Product SKUs that map a deal to this template (case-insensitive exact match). */
  readonly matchSkus: readonly string[];
  /** Optional product-NAME patterns (fallback when the SKU is absent on the line item). */
  readonly matchNames?: readonly RegExp[];
  /** The phase → task graph to build (same shape onboarding uses). */
  readonly phases: readonly OnboardingPhase[];
  /** Env var naming the Pipedrive board id for this template. */
  readonly boardIdEnv: string;
  /** Env var naming the Pipedrive kanban phase id for this template. */
  readonly phaseIdEnv: string;
}

/**
 * The DEFAULT template — today's WHM new-client onboarding board. It is the fallback
 * (`selectTemplate` never returns it; a null selection resolves to this), so it carries
 * no product match keys. Board/phase come from the existing onboarding env vars.
 */
export const ONBOARDING_TEMPLATE_DEF: OneTimeTemplateDef = {
  id: "onboarding",
  family: "New-client Onboarding",
  titlePrefix: "Onboarding",
  matchSkus: [],
  phases: WHM_ONBOARDING_TEMPLATE,
  boardIdEnv: "PIPEDRIVE_ONBOARDING_BOARD_ID",
  phaseIdEnv: "PIPEDRIVE_ONBOARDING_PHASE_ID",
};

/**
 * New Website Build (PSG-650). Anchor SKU `PSG_P_026` = "Website Design & Build"
 * (PSG-521). Name fallback matches the "website … design/build" phrasing so a deal that
 * sold a build without a clean SKU still maps. Its own board/phase env vars fall back to
 * the onboarding board when unset (no new Vercel config required to ship).
 */
export const WEB_BUILD_TEMPLATE_DEF: OneTimeTemplateDef = {
  id: "new-website-build",
  family: "Web — New Website Build",
  titlePrefix: "New Website Build",
  matchSkus: ["PSG_P_026"],
  matchNames: [/\bwebsite\b[^.]*\b(design|build)\b/i],
  phases: NEW_WEBSITE_BUILD_TEMPLATE,
  boardIdEnv: "PIPEDRIVE_WEBBUILD_BOARD_ID",
  phaseIdEnv: "PIPEDRIVE_WEBBUILD_PHASE_ID",
};

/**
 * The product-matched one-time templates, in priority order. Onboarding is NOT here — it
 * is the implicit default (a null selection). New net-new templates (Redesign, Landing
 * Page, …) are added to this array as they are authored + signed off under PSG-611.
 */
export const ONE_TIME_TEMPLATE_REGISTRY: readonly OneTimeTemplateDef[] = [
  WEB_BUILD_TEMPLATE_DEF,
];

/** True when a def's SKU/name keys match at least one of the deal's line items. */
function defMatchesProducts(
  def: OneTimeTemplateDef,
  products: readonly DealProduct[],
): boolean {
  const skus = new Set(def.matchSkus.map((s) => s.trim().toUpperCase()));
  for (const p of products) {
    const sku = (p.sku ?? "").trim().toUpperCase();
    if (sku !== "" && skus.has(sku)) return true;
    const name = (p.name ?? "").trim();
    if (name !== "" && def.matchNames?.some((re) => re.test(name))) return true;
  }
  return false;
}

/**
 * Map a won deal (via its line items) to the DISTINCT one-time delivery templates it
 * sold (PSG-678). Returns the deduped list of matched registry templates, in registry
 * priority order — one entry per distinct template even when several line items match the
 * same one. An empty array means "no delivery template sold" (zero products, add-ons /
 * consulting only, or unmapped products); the caller (`provisionForDeal`) turns an empty
 * result into today's onboarding board so the deal-won path never builds nothing.
 *
 * This replaces the old single-template rule: previously two or more DIFFERENT matches
 * were treated as ambiguous → onboarding fallback. Per PSG-677 the correct behaviour is
 * to build ONE project per distinct delivery template, so a deal selling e.g. Website
 * Build + a second one-time template now builds both delivery boards.
 */
export function selectTemplates(
  _deal: WonDeal,
  products: readonly DealProduct[],
  registry: readonly OneTimeTemplateDef[] = ONE_TIME_TEMPLATE_REGISTRY,
): OneTimeTemplateDef[] {
  if (!products || products.length === 0) return [];
  const matches: OneTimeTemplateDef[] = [];
  for (const def of registry) {
    if (defMatchesProducts(def, products) && !matches.some((m) => m.id === def.id)) {
      matches.push(def);
    }
  }
  return matches;
}

/**
 * Back-compat single-result shim: the FIRST distinct matched template (registry priority
 * order), or `null` when the deal sold no delivery template. Prefer `selectTemplates`,
 * which returns every distinct match; this shim is retained for callers that only care
 * about "did a delivery template sell, and which is primary".
 */
export function selectTemplate(
  deal: WonDeal,
  products: readonly DealProduct[],
): OneTimeTemplateDef | null {
  return selectTemplates(deal, products)[0] ?? null;
}

/** Parse an env var to a finite integer id, or `null` if unset/malformed. */
function envInt(env: Record<string, string | undefined>, name: string): number | null {
  const raw = env[name];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

export interface ProvisionForDealOptions {
  client: PipedriveProjectsClient;
  deal: WonDeal;
  /** Onboarding board/phase (the webhook's resolved env) — the fallback for every template. */
  defaultBoardId: number;
  defaultPhaseId: number;
  roleUserMap?: Partial<Record<OnboardingRole, number>>;
  /**
   * Pre-fetched line items. When omitted, `provisionForDeal` reads them via
   * `client.listDealProducts(deal.id)`; a read error is swallowed → onboarding fallback.
   */
  products?: readonly DealProduct[];
  /** Env source (injectable for tests). Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Template registry to select from (injectable for tests). Defaults to the module registry. */
  registry?: readonly OneTimeTemplateDef[];
}

export interface ProvisionForDealResult extends ProvisionResult {
  /** The template id that was built (`onboarding` when it fell back). */
  templateId: string;
  templateFamily: string;
  /** True when a net-new template was confidently matched (false ⇒ onboarding fallback). */
  matchedTemplate: boolean;
}

/**
 * Summary of everything a single won deal built. A deal that sold N distinct delivery
 * templates yields N projects (one per template); a deal that sold none yields exactly
 * one onboarding-fallback project. `projects` is never empty — the deal-won path never
 * builds nothing.
 */
export interface ProvisionForDealSummary {
  /** One result per project built, in registry priority order (fallback ⇒ a single onboarding entry). */
  projects: ProvisionForDealResult[];
  /** Convenience list of the template ids built (parallel to `projects`). */
  templateIds: string[];
  /** True when ≥1 net-new delivery template matched (false ⇒ pure onboarding fallback). */
  matchedTemplates: boolean;
}

/**
 * Build one project for a single resolved template def. Resolves the per-template
 * board/phase override (unset ⇒ reuse the onboarding board/phase) and dispatches the
 * def's `phases` into the existing idempotent, per-deal-title `provisionOnboardingBoard`.
 */
async function provisionOneTemplate(
  def: OneTimeTemplateDef,
  matched: boolean,
  opts: ProvisionForDealOptions,
  env: Record<string, string | undefined>,
): Promise<ProvisionForDealResult> {
  const { client, deal, defaultBoardId, defaultPhaseId } = opts;
  // Per-template board/phase override; unset ⇒ reuse the onboarding board/phase.
  const boardId = envInt(env, def.boardIdEnv) ?? defaultBoardId;
  const phaseId = envInt(env, def.phaseIdEnv) ?? defaultPhaseId;

  const result = await provisionOnboardingBoard({
    client,
    deal,
    boardId,
    phaseId,
    template: def.phases,
    roleUserMap: opts.roleUserMap,
    // Per-template title prefix ⇒ distinct deterministic title ⇒ its own idempotency
    // guard (findProjectByTitle). Two templates on one deal never collide.
    projectTitle: deliveryProjectTitle(def.titlePrefix, deal),
  });

  return {
    ...result,
    templateId: def.id,
    templateFamily: def.family,
    matchedTemplate: matched,
  };
}

/**
 * Build the RIGHT one-time board(s) for a won deal (PSG-678). Selects the DISTINCT
 * delivery templates the deal sold and builds one project per template. Falls back to a
 * single onboarding project whenever the deal sold no delivery template OR the product
 * read fails — the deal-won path must never regress into building nothing.
 *
 * Idempotency is preserved per project: each template's title carries its own prefix, so
 * a re-fired won-webhook is a per-project no-op (each guarded by `findProjectByTitle`).
 * Projects are built sequentially to keep Pipedrive write ordering deterministic and
 * bounded (a deal sells only a handful of delivery templates).
 */
export async function provisionForDeal(
  opts: ProvisionForDealOptions,
): Promise<ProvisionForDealSummary> {
  const { client, deal } = opts;
  const env = opts.env ?? process.env;

  // Resolve the deal's line items. A read failure is non-fatal: fall back to onboarding
  // (conservative-fallback contract) rather than failing the whole provision.
  let products: readonly DealProduct[] = opts.products ?? [];
  if (opts.products === undefined && typeof client.listDealProducts === "function") {
    try {
      products = await client.listDealProducts(deal.id);
    } catch {
      products = [];
    }
  }

  const selected = selectTemplates(deal, products, opts.registry);
  // Zero delivery-template matches ⇒ single onboarding fallback (never build nothing).
  const defs = selected.length > 0 ? selected : [ONBOARDING_TEMPLATE_DEF];
  const matched = selected.length > 0;

  const projects: ProvisionForDealResult[] = [];
  for (const def of defs) {
    projects.push(await provisionOneTemplate(def, matched, opts, env));
  }

  return {
    projects,
    templateIds: projects.map((p) => p.templateId),
    matchedTemplates: matched,
  };
}
