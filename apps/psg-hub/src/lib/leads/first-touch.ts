// PSG-500 — First-touch attribution capture for the public inbound lead form.
//
// "First-touch" means: the FIRST time a visitor lands on the capture page with
// attribution params in the URL, we snapshot them and never overwrite. A later
// visit (e.g. they come back via a branded/organic link) must NOT clobber the
// original paid touch — otherwise we under-credit the channel that actually
// sourced the lead. This module is the pure, framework-free core so it can be
// unit-tested in the node env; the React form is a thin glue layer on top.
//
// Field names map 1:1 to the POST /api/leads/inbound contract (PSG-499):
// camelCase utmSource/utmMedium/utmCampaign/utmContent. gclid/fbclid are carried
// through for future use (the endpoint tolerates extra keys and ignores them).

/** localStorage / cookie key the form persists the first-touch snapshot under. */
export const FIRST_TOUCH_KEY = "psg_first_touch";

/** Attribution params we read from the landing URL, in stable order. */
export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  gclid?: string;
  fbclid?: string;
}

/** URL param -> Attribution key. Order is stable for deterministic output. */
const PARAM_MAP: ReadonlyArray<readonly [string, keyof Attribution]> = [
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_content", "utmContent"],
  ["gclid", "gclid"],
  ["fbclid", "fbclid"],
];

function clean(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Read attribution params from a URL query string or URLSearchParams.
 * Only non-empty params are included; absent params are omitted entirely.
 */
export function extractAttribution(
  search: string | URLSearchParams,
): Attribution {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const out: Attribution = {};
  for (const [param, key] of PARAM_MAP) {
    const v = clean(params.get(param));
    if (v != null) out[key] = v;
  }
  return out;
}

/** True when at least one attribution field is present. */
export function hasAttribution(a: Attribution | null | undefined): boolean {
  return a != null && Object.values(a).some((v) => clean(v ?? null) != null);
}

/**
 * First-touch merge: a previously-stored snapshot WINS. We only adopt the
 * incoming attribution when there is no usable stored snapshot. This is the
 * single rule that guarantees we never overwrite the original touch.
 */
export function mergeFirstTouch(
  stored: Attribution | null | undefined,
  incoming: Attribution | null | undefined,
): Attribution {
  if (hasAttribution(stored)) return stored as Attribution;
  if (hasAttribution(incoming)) return incoming as Attribution;
  return {};
}

/** Tolerant parse of a persisted snapshot (bad JSON -> null, never throws). */
export function parseStoredAttribution(raw: string | null): Attribution | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return extractAttribution(
      new URLSearchParams(
        // Re-normalize through the same allowlist so junk keys can't ride along.
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [snakeFromCamel(k), v as string]),
      ),
    );
  } catch {
    return null;
  }
}

/** camelCase Attribution key -> the url param it came from (for re-normalize). */
function snakeFromCamel(key: string): string {
  const found = PARAM_MAP.find(([, k]) => k === key);
  return found ? found[0] : key;
}

/** The visible + hidden fields the public form collects. */
export interface LeadFormFields {
  shopName: string;
  contactName: string;
  email: string;
  phone: string;
  message: string;
  /** Honeypot — must stay empty for real humans. */
  company_website: string;
}

/**
 * Build the POST /api/leads/inbound body: trimmed form fields + first-touch
 * attribution, spread last so attribution rides alongside the contact fields.
 * leadSourceChannel is intentionally omitted — the endpoint buckets the channel
 * from the UTMs (defaulting to "Web Form (Direct)"), so the browser never has to
 * know the enum.
 */
export function buildInboundPayload(
  fields: LeadFormFields,
  attribution: Attribution,
): Record<string, string> {
  const body: Record<string, string> = {
    shopName: fields.shopName.trim(),
    contactName: fields.contactName.trim(),
    email: fields.email.trim(),
    phone: fields.phone.trim(),
    message: fields.message.trim(),
    // Honeypot is always sent (empty for humans); the server treats a non-empty
    // value as a bot and returns a decoy success without creating anything.
    company_website: fields.company_website,
  };
  for (const [, key] of PARAM_MAP) {
    const v = attribution[key];
    if (v != null && v.trim() !== "") body[key] = v.trim();
  }
  return body;
}
