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
 * Map a won deal (via its line items) to a one-time template, or `null` when it cannot
 * be confidently mapped. `null` covers all three fall-back-to-onboarding cases:
 *   • zero products, or no registry template matches → unmapped;
 *   • two or more DIFFERENT registry templates match → ambiguous.
 * The caller (`provisionForDeal`) turns `null` into the onboarding board.
 */
export function selectTemplate(
  _deal: WonDeal,
  products: readonly DealProduct[],
): OneTimeTemplateDef | null {
  if (!products || products.length === 0) return null;
  const matches: OneTimeTemplateDef[] = [];
  for (const def of ONE_TIME_TEMPLATE_REGISTRY) {
    if (defMatchesProducts(def, products) && !matches.some((m) => m.id === def.id)) {
      matches.push(def);
    }
  }
  // Confident mapping requires exactly one distinct template. Ambiguous ⇒ onboarding.
  return matches.length === 1 ? matches[0]! : null;
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
}

export interface ProvisionForDealResult extends ProvisionResult {
  /** The template id that was built (`onboarding` when it fell back). */
  templateId: string;
  templateFamily: string;
  /** True when a net-new template was confidently matched (false ⇒ onboarding fallback). */
  matchedTemplate: boolean;
}

/**
 * Build the RIGHT one-time board for a won deal. Selects a template from the deal's line
 * items and dispatches its `phases` + board/phase into the existing
 * `provisionOnboardingBoard` (idempotent, per-deal title-scoped). Falls back to the
 * onboarding board whenever the deal cannot be confidently mapped OR the product read
 * fails — the deal-won path must never regress into building nothing.
 */
export async function provisionForDeal(
  opts: ProvisionForDealOptions,
): Promise<ProvisionForDealResult> {
  const { client, deal, defaultBoardId, defaultPhaseId } = opts;
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

  const selected = selectTemplate(deal, products);
  const def = selected ?? ONBOARDING_TEMPLATE_DEF;

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
    projectTitle: deliveryProjectTitle(def.titlePrefix, deal),
  });

  return {
    ...result,
    templateId: def.id,
    templateFamily: def.family,
    matchedTemplate: selected != null,
  };
}
