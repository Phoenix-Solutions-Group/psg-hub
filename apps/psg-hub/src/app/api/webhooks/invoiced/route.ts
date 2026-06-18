import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  verifyInvoicedSignature,
  extractInvoiceObject,
  mapInvoicedInvoice,
  DEFAULT_INVOICED_SIGNATURE_HEADER,
} from "@/lib/invoiced/webhook";

/**
 * Invoiced.com webhook — mirrors the in-repo Stripe + SendGrid webhooks:
 * raw body, signature verification BEFORE JSON parse, service-role write.
 * Idempotent via the invoiced_events.event_id PRIMARY KEY (ignoreDuplicates upsert):
 * a replayed event is recorded once and never re-applied (PLANNING.md: idempotency
 * on every webhook). Invoices are mirrored into public.invoices by external_id.
 *
 * Build-local until G3 (Invoiced vendor spend) + G1 (prod deploy): no live Invoiced
 * account is needed to author/verify this handler. INVOICED_WEBHOOK_SECRET and the
 * customer->shop map land at activation. See PSG-24.
 */
export async function POST(request: Request) {
  const secret = process.env.INVOICED_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed on misconfiguration rather than accept unverifiable events.
    console.error("[invoiced-webhook] INVOICED_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const headerName =
    process.env.INVOICED_WEBHOOK_HEADER || DEFAULT_INVOICED_SIGNATURE_HEADER;
  const body = await request.text();
  const signature = request.headers.get(headerName);

  if (!verifyInvoicedSignature(body, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envelope = parsed as any;
  const eventId =
    envelope?.id != null ? String(envelope.id) : null;
  if (!eventId) {
    // No event id => can't dedupe. Accept (200) so Invoiced doesn't retry forever,
    // but record nothing.
    return NextResponse.json({ received: true, skipped: "no_event_id" });
  }

  const supabase = createServiceClient();

  // Idempotency: claim the event id. ignoreDuplicates => a replay is a silent no-op.
  const inv = extractInvoiceObject(envelope);
  const { error: ledgerError } = await supabase
    .from("invoiced_events")
    .upsert(
      {
        event_id: eventId,
        event_type:
          typeof envelope?.type === "string" ? envelope.type : null,
        invoice_external_id: inv?.id != null ? String(inv.id) : null,
        payload: envelope,
      },
      { onConflict: "event_id", ignoreDuplicates: true }
    )
    .select("event_id");

  if (ledgerError) {
    console.error("[invoiced-webhook] ledger write failed:", ledgerError.message);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  // No invoice object on this event (e.g. a customer event) — ledger recorded, done.
  const mapped = inv ? mapInvoicedInvoice(inv) : null;
  if (!mapped) {
    return NextResponse.json({ received: true });
  }

  // Resolve shop_id: per-invoice metadata override first, else the customer->shop map.
  const metaShopId =
    inv?.metadata && typeof inv.metadata.shop_id === "string"
      ? (inv.metadata.shop_id as string)
      : null;

  let shopId = metaShopId;
  if (!shopId) {
    const customerId =
      inv.customer && typeof inv.customer === "object"
        ? inv.customer.id
        : inv.customer;
    if (customerId != null) {
      const { data: map } = await supabase
        .from("invoiced_customer_map")
        .select("shop_id")
        .eq("invoiced_customer_id", String(customerId))
        .maybeSingle();
      shopId = (map?.shop_id as string | undefined) ?? null;
    }
  }

  if (!shopId) {
    // Unmapped customer — the event is safely recorded for replay/backfill once the
    // mapping exists, but we cannot attribute the invoice to a shop yet. Accept (200).
    console.warn(
      `[invoiced-webhook] no shop mapping for invoice ${mapped.external_id}; recorded event only`
    );
    return NextResponse.json({ received: true, skipped: "unmapped_customer" });
  }

  // Mirror the invoice. onConflict(external_id) => updates land on the same row,
  // so out-of-order/duplicate invoice events converge to the latest state.
  const { error: upsertError } = await supabase
    .from("invoices")
    .upsert({ shop_id: shopId, ...mapped }, { onConflict: "external_id" });

  if (upsertError) {
    console.error("[invoiced-webhook] invoice upsert failed:", upsertError.message);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
