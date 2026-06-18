import "server-only";
import crypto from "node:crypto";

/**
 * Invoiced.com webhook helpers — signature verification + payload → invoices-row mapping.
 *
 * Verification mirrors the Stripe/SendGrid webhooks already in this repo: verify a signature
 * over the RAW request body BEFORE parsing JSON, using a shared signing secret. Invoiced signs
 * the raw payload with HMAC-SHA256 and sends the hex digest in a header. The exact header name is
 * confirmed at activation (G3); INVOICED_WEBHOOK_HEADER overrides the default below so we never
 * have to redeploy code to match it. Build-local until then (no live Invoiced account is required
 * to author/verify this logic — see PSG-24).
 */

export const DEFAULT_INVOICED_SIGNATURE_HEADER = "x-invoiced-signature";

/** Timing-safe compare of two hex strings (lengths may differ → false, no throw). */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify an Invoiced webhook signature over the raw body.
 * Accepts either a bare hex digest or a "sha256=<hex>" prefixed form.
 */
export function verifyInvoicedSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqualHex(provided, expected);
}

/** A normalized row ready to upsert into public.invoices (minus shop_id, resolved by the route). */
export interface MappedInvoice {
  external_id: string;
  number: string | null;
  customer_name: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  raw: unknown;
  updated_at: string;
}

const STATUSES = new Set([
  "draft",
  "open",
  "paid",
  "past_due",
  "void",
  "uncollectible",
]);

/**
 * Map Invoiced's `status` + paid flag onto our invoices.status CHECK domain.
 * Invoiced uses: not_sent/draft, sent/viewed/open (unpaid), paid, past_due, voided, bad_debt.
 */
export function mapInvoicedStatus(raw: {
  status?: unknown;
  paid?: unknown;
  closed?: unknown;
}): string {
  if (raw.paid === true) return "paid";
  const s = typeof raw.status === "string" ? raw.status.toLowerCase() : "";
  if (STATUSES.has(s)) return s;
  switch (s) {
    case "not_sent":
    case "draft":
      return "draft";
    case "voided":
      return "void";
    case "bad_debt":
      return "uncollectible";
    case "sent":
    case "viewed":
    case "partial":
      return "open";
    default:
      return raw.closed === true ? "void" : "open";
  }
}

/** Pull the invoice object out of an Invoiced webhook envelope (`{ event, object }`) or a bare invoice. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractInvoiceObject(parsed: any): any | null {
  if (!parsed || typeof parsed !== "object") return null;
  // Envelope shape: { id: "event_...", type: "invoice.created", object: { ...invoice } }
  if (parsed.object && typeof parsed.object === "object") return parsed.object;
  // Bare invoice (id + number/total) — accept it directly.
  if (parsed.id != null && (parsed.total != null || parsed.number != null)) {
    return parsed;
  }
  return null;
}

/** Dollars (Invoiced `total`) → integer cents, guarding against float drift. */
export function toCents(total: unknown): number {
  const n = typeof total === "number" ? total : Number(total);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Unix seconds → ISO string, or null. */
export function unixToIso(v: unknown): string | null {
  return typeof v === "number" && Number.isFinite(v)
    ? new Date(v * 1000).toISOString()
    : null;
}

/** Unix seconds → YYYY-MM-DD (date column), or null. */
export function unixToDate(v: unknown): string | null {
  const iso = unixToIso(v);
  return iso ? iso.slice(0, 10) : null;
}

/** Map an Invoiced invoice object to our invoices row (sans shop_id). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapInvoicedInvoice(inv: any): MappedInvoice | null {
  const externalId = inv?.id != null ? String(inv.id) : null;
  if (!externalId) return null;

  // Customer can arrive as an id, or an embedded object with name/email.
  let customerName: string | null = null;
  if (inv.customer && typeof inv.customer === "object") {
    customerName =
      typeof inv.customer.name === "string" ? inv.customer.name : null;
  } else if (typeof inv.name === "string") {
    customerName = inv.name;
  }

  return {
    external_id: externalId,
    number: typeof inv.number === "string" ? inv.number : null,
    customer_name: customerName,
    amount_cents: toCents(inv.total),
    currency:
      typeof inv.currency === "string" ? inv.currency.toLowerCase() : "usd",
    status: mapInvoicedStatus(inv),
    due_date: unixToDate(inv.due_date),
    paid_at: inv.paid === true ? unixToIso(inv.updated_at) : null,
    pdf_url: typeof inv.pdf_url === "string" ? inv.pdf_url : null,
    raw: inv,
    updated_at: new Date().toISOString(),
  };
}
