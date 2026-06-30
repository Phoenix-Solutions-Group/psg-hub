// PSG-499 — Inbound lead-capture: server-only Pipedrive deal-create path.
//
// This is the TypeScript port of `crm-build/scripts/create_deal.py` (Part A, PSG-490)
// — the ONE controlled path for creating an attributed Pipedrive deal from an inbound
// web lead, so every lead carries a Lead Source (Channel) + raw UTMs (no blank source).
//
// Field contract (verified live 2026-06-30, PSG-483/488 QA-verified; do NOT re-derive):
//   Lead Source (Channel) -> 30fee675e3066eb580760b81e9d49bbea5bf5f8b  (enum, field 12529) REQUIRED
//   utm_source            -> 2f270d8d73359ff64971ccaaa0f9d475942f3700  (varchar, 12522)
//   utm_medium            -> 27ab28a465a6ad9acc1ba8d6dc6bc25e1914ce28  (varchar, 12523)
//   utm_campaign          -> f1dbf42beaa970814f8a30055aebf1495405ceb4  (varchar, 12524)
//   utm_content           -> ef5e51246f92f77548960717d056490609b63fb1  (varchar, 12525)
//
// SECURITY: the write-capable admin token is read from `process.env.PIPEDRIVE_API_KEY`
// (server only — never `NEXT_PUBLIC_*`). It is passed in the query string for classic
// personal-token auth and is NEVER logged, returned, or embedded in an error message
// (errors deliberately omit the URL — same rule as the read client in ../pipedrive/client).
//
// NOTE on token naming: the read-only sync path (../pipedrive/client.ts) uses a separate
// read-only `PIPEDRIVE_API_TOKEN`. This write path uses the admin `PIPEDRIVE_API_KEY`
// (the same admin token crm-build tooling uses). They are two different credentials.

import { PipedriveError, pipedriveBaseUrl } from "../pipedrive/client";

// ── field contract ────────────────────────────────────────────────────────────────
export const CHANNEL_KEY = "30fee675e3066eb580760b81e9d49bbea5bf5f8b";
export const UTM_KEYS = {
  utm_source: "2f270d8d73359ff64971ccaaa0f9d475942f3700",
  utm_medium: "27ab28a465a6ad9acc1ba8d6dc6bc25e1914ce28",
  utm_campaign: "f1dbf42beaa970814f8a30055aebf1495405ceb4",
  utm_content: "ef5e51246f92f77548960717d056490609b63fb1",
} as const;

// Greenfield default placement (PSG-481): PSG Sales pipeline / New Lead stage.
export const DEFAULT_PIPELINE_ID = 8;
export const DEFAULT_STAGE_ID = 56;

// Default analyst bucket for a web-form lead with no derivable ad channel.
// Confirmed live as an enum option (contract doc, PSG-483 enum migration / PSG-488 QA).
export const DEFAULT_CHANNEL_LABEL = "Web Form (Direct)";

/** Raised when a resolved Channel label is not in the live enum (never write junk). */
export class ChannelOptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelOptionError";
  }
}

// ── channel bucketing (the `resolve_channel` analogue, extended for web UTMs) ───────
//
// Spec (PSG-499 / inbound-web-capture-spec §2): map the ad channel -> enum bucket where
// derivable — `utm_medium=cpc` (+ a search-engine source) -> `Paid Search`; paid social
// -> `Paid Social`; otherwise default to `Web Form (Direct)`. Never blank.

const SEARCH_SOURCES = new Set([
  "google",
  "bing",
  "microsoft",
  "msft",
  "ms",
  "yahoo",
  "duckduckgo",
  "ecosia",
  "baidu",
  "yandex",
]);
const SOCIAL_SOURCES = new Set([
  "facebook",
  "fb",
  "meta",
  "instagram",
  "ig",
  "linkedin",
  "tiktok",
  "twitter",
  "x",
  "pinterest",
  "snapchat",
  "reddit",
  "youtube",
]);

/** A paid medium signals a *purchased* click/impression (vs organic/email/referral). */
function isPaidMedium(medium: string): boolean {
  return /(^|[^a-z])(cpc|ppc|sem|cpm|cpv|ppe|paid|paidsearch|paid_search|paid-search|paidsocial|paid_social|paid-social|display|banner|retargeting|remarketing)([^a-z]|$)/.test(
    medium,
  );
}

/**
 * Resolve the analyst-facing Lead Source (Channel) label from raw UTMs.
 * Returns one of the live enum labels; defaults to `Web Form (Direct)` (never blank).
 */
export function bucketChannel(
  utmSource?: string | null,
  utmMedium?: string | null,
): string {
  const s = (utmSource ?? "").trim().toLowerCase();
  const m = (utmMedium ?? "").trim().toLowerCase();

  if (!isPaidMedium(m)) return DEFAULT_CHANNEL_LABEL;

  // Paid + a social network (by medium keyword or known social source) -> Paid Social.
  // (Meta/TikTok ads commonly use medium `cpc`/`paid`, so the source disambiguates.)
  if (/social/.test(m) || SOCIAL_SOURCES.has(s)) return "Paid Social";

  // Paid + a search engine, or an unambiguous search medium -> Paid Search.
  if (SEARCH_SOURCES.has(s) || /(^|[^a-z])(cpc|ppc|sem|paidsearch|paid_search|paid-search|search)([^a-z]|$)/.test(m)) {
    return "Paid Search";
  }

  // Paid but the channel is ambiguous (unknown source, generic `paid`/`display`).
  // Stay conservative rather than mis-attribute — the raw UTMs are still stamped.
  return DEFAULT_CHANNEL_LABEL;
}

export interface ChannelOption {
  id: number;
  label: string;
}

/**
 * Resolve a Channel label (or a numeric option id) to a live enum option id.
 * Mirrors `resolve_channel` in create_deal.py: anything not in the live enum is
 * rejected (ChannelOptionError) so we never write a blank or junk Channel.
 */
export function resolveChannelId(
  value: string | number,
  options: ChannelOption[],
): number {
  const labels = options.map((o) => o.label);
  // Numeric / numeric-string -> must be a real option id.
  const asNum =
    typeof value === "number"
      ? value
      : /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;
  if (asNum != null) {
    if (options.some((o) => o.id === asNum)) return asNum;
    throw new ChannelOptionError(
      `lead_source_channel id ${asNum} is not a valid option. Options: ${labels.join(", ")}`,
    );
  }
  const want = String(value).trim().toLowerCase();
  const hit = options.find((o) => o.label.trim().toLowerCase() === want);
  if (hit) return hit.id;
  throw new ChannelOptionError(
    `lead_source_channel ${JSON.stringify(value)} is not a valid Lead Source (Channel) option. Valid labels: ${labels.join(", ")}`,
  );
}

// ── intake client seam (injectable; mocked in unit tests) ───────────────────────────

export interface PipedriveIntakeClient {
  /** Live options for the Lead Source (Channel) enum field. */
  getChannelOptions(): Promise<ChannelOption[]>;
  /** Existing non-deleted deal with this exact title in the pipeline, else null. */
  findDealByTitle(title: string, pipelineId: number): Promise<{ id: number } | null>;
  findOrganizationByName(name: string): Promise<{ id: number } | null>;
  createOrganization(name: string): Promise<{ id: number }>;
  /** Match a Person by an exact term (email or phone), else null. */
  findPerson(term: string): Promise<{ id: number } | null>;
  createPerson(input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    orgId?: number | null;
  }): Promise<{ id: number }>;
  createDeal(body: Record<string, unknown>): Promise<{ id: number }>;
}

export interface InboundLeadInput {
  shopName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Explicit Channel override (label or option id). When absent, derived from UTMs. */
  leadSourceChannel?: string | number | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
}

export interface CaptureResult {
  dealId: number;
  /** True when an existing deal was returned instead of creating a duplicate. */
  idempotent: boolean;
  /** The resolved Channel label that was stamped. */
  channel: string;
}

/** UTC `YYYY-MM-DD` used in the dedupe-keyed deal title. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Capture an inbound web lead as an attributed Pipedrive deal.
 *
 * Idempotency: the deal title encodes (shop + day), and we dedupe on the exact title in
 * the pipeline (port of `find_existing_by_title`). A double-submit from the same shop on
 * the same day returns the existing deal rather than creating a duplicate. The submitter
 * identity (email/phone) rides on the matched Person record. (Caveat, per the Part A
 * contract: Pipedrive search is eventually consistent, so two creates fired within the
 * same few-second indexing window can still both succeed; the route's honeypot + input
 * validation are the first-line spam controls, dedupe catches the realistic retry case.)
 */
export async function captureInboundLead(
  client: PipedriveIntakeClient,
  input: InboundLeadInput,
  opts: { now?: Date } = {},
): Promise<CaptureResult> {
  const shopName = (input.shopName ?? "").trim();
  if (!shopName) throw new Error("shopName is required");

  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;

  // 1. Resolve the Channel against the live enum (REQUIRED, never blank).
  const options = await client.getChannelOptions();
  const wantLabel =
    input.leadSourceChannel != null && String(input.leadSourceChannel).trim() !== ""
      ? input.leadSourceChannel
      : bucketChannel(input.utmSource, input.utmMedium);

  let channelId: number;
  let channelLabel: string;
  try {
    channelId = resolveChannelId(wantLabel, options);
    channelLabel =
      options.find((o) => o.id === channelId)?.label ?? String(wantLabel);
  } catch (err) {
    // A derived bucket should always exist; if a future enum edit removed the default,
    // surface loudly (the route maps this to a 500 + an operator-facing log) rather
    // than writing a blank Channel. Explicit caller overrides that are invalid also land here.
    throw err instanceof ChannelOptionError ? err : new ChannelOptionError(String(err));
  }

  // 2. Dedupe by the (shop + day) title.
  const day = utcDay(opts.now ?? new Date());
  const title = `${shopName} — Inbound Web Lead — ${day}`;
  const existing = await client.findDealByTitle(title, DEFAULT_PIPELINE_ID);
  if (existing) {
    return { dealId: existing.id, idempotent: true, channel: channelLabel };
  }

  // 3. Create-or-match Org (shop) so attribution lives on a real record.
  const org =
    (await client.findOrganizationByName(shopName)) ??
    (await client.createOrganization(shopName));

  // 4. Create-or-match Person by email, then phone; create when no identity matches.
  let personId: number | null = null;
  if (email) personId = (await client.findPerson(email))?.id ?? null;
  if (personId == null && phone) personId = (await client.findPerson(phone))?.id ?? null;
  if (personId == null && (email || phone)) {
    const person = await client.createPerson({
      name: input.contactName?.trim() || shopName,
      email,
      phone,
      orgId: org.id,
    });
    personId = person.id;
  }

  // 5. Build the deal body with the verified field contract.
  const body: Record<string, unknown> = {
    title,
    pipeline_id: DEFAULT_PIPELINE_ID,
    stage_id: DEFAULT_STAGE_ID,
    [CHANNEL_KEY]: channelId,
    org_id: org.id,
  };
  if (personId != null) body.person_id = personId;

  const utms: Record<keyof typeof UTM_KEYS, string | null | undefined> = {
    utm_source: input.utmSource,
    utm_medium: input.utmMedium,
    utm_campaign: input.utmCampaign,
    utm_content: input.utmContent,
  };
  for (const name of Object.keys(UTM_KEYS) as (keyof typeof UTM_KEYS)[]) {
    const val = utms[name]?.trim();
    if (val) body[UTM_KEYS[name]] = val;
  }

  const deal = await client.createDeal(body);
  return { dealId: deal.id, idempotent: false, channel: channelLabel };
}

// ── default HTTP client (classic personal-token auth, v1 endpoints) ─────────────────

export interface PipedriveIntakeConfig {
  /** Admin write token. Defaults to `process.env.PIPEDRIVE_API_KEY`. */
  apiKey?: string;
  companyDomain?: string | null;
  /** Injectable fetch (defaults to global `fetch`) — the seam unit tests mock. */
  fetchImpl?: typeof fetch;
}

export function createPipedriveIntakeClient(
  config: PipedriveIntakeConfig = {},
): PipedriveIntakeClient {
  const apiKey = config.apiKey ?? process.env.PIPEDRIVE_API_KEY ?? "";
  if (!apiKey) {
    // Fail closed; message carries no token material.
    throw new PipedriveError("Missing PIPEDRIVE_API_KEY");
  }
  const base = pipedriveBaseUrl(config.companyDomain);
  const doFetch = config.fetchImpl ?? fetch;

  /** Build a v1 URL with the token in the query string (never logged). */
  function url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${base}/v1/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("api_token", apiKey);
    return u.toString();
  }

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string> = {},
    jsonBody?: Record<string, unknown>,
  ): Promise<T> {
    const res = await doFetch(url(path, params), {
      method,
      headers: jsonBody
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });
    if (!res.ok) {
      // NEVER include the URL (it carries the token) in the error.
      throw new PipedriveError(`Pipedrive /${path} returned HTTP ${res.status}`, res.status);
    }
    const payload = (await res.json()) as { success?: boolean; data?: unknown };
    if (payload.success === false) {
      throw new PipedriveError(`Pipedrive /${path} returned success=false`);
    }
    return payload.data as T;
  }

  return {
    async getChannelOptions() {
      const fields = await call<Array<Record<string, unknown>>>(
        "GET",
        "dealFields",
        { limit: "500" },
      );
      const field = (fields ?? []).find((f) => f.key === CHANNEL_KEY);
      const options = (field?.options as Array<Record<string, unknown>> | undefined) ?? [];
      return options
        .map((o) => ({ id: Number(o.id), label: String(o.label ?? "") }))
        .filter((o) => Number.isFinite(o.id) && o.label !== "");
    },

    async findDealByTitle(title, pipelineId) {
      const search = await call<{ items?: Array<{ item?: { id?: number } }> }>(
        "GET",
        "deals/search",
        { term: title, exact_match: "true", fields: "title" },
      );
      const items = search?.items ?? [];
      for (const it of items) {
        const id = it.item?.id;
        if (id == null) continue;
        const deal = await call<Record<string, unknown>>("GET", `deals/${id}`);
        if (
          deal?.title === title &&
          deal?.pipeline_id === pipelineId &&
          deal?.status !== "deleted"
        ) {
          return { id: Number(id) };
        }
      }
      return null;
    },

    async findOrganizationByName(name) {
      const search = await call<{ items?: Array<{ item?: { id?: number; name?: string } }> }>(
        "GET",
        "organizations/search",
        { term: name, exact_match: "true", fields: "name" },
      );
      const hit = (search?.items ?? []).find(
        (it) => it.item?.name?.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      return hit?.item?.id != null ? { id: Number(hit.item.id) } : null;
    },

    async createOrganization(name) {
      const org = await call<{ id: number }>("POST", "organizations", {}, { name });
      return { id: Number(org.id) };
    },

    async findPerson(term) {
      const search = await call<{ items?: Array<{ item?: { id?: number } }> }>(
        "GET",
        "persons/search",
        { term, exact_match: "true", fields: "email,phone" },
      );
      const id = (search?.items ?? [])[0]?.item?.id;
      return id != null ? { id: Number(id) } : null;
    },

    async createPerson(input) {
      const body: Record<string, unknown> = { name: input.name };
      if (input.email) body.email = [input.email];
      if (input.phone) body.phone = [input.phone];
      if (input.orgId != null) body.org_id = input.orgId;
      const person = await call<{ id: number }>("POST", "persons", {}, body);
      return { id: Number(person.id) };
    },

    async createDeal(body) {
      const deal = await call<{ id: number }>("POST", "deals", {}, body);
      return { id: Number(deal.id) };
    },
  };
}
