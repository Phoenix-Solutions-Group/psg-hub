import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PSG-59 — single invoice + its payments, for the customer's invoice detail view.
// Same gate as the list route. The invoice id is the Stripe id ("in_..."), not a UUID.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const STRIPE_INVOICE_RE = /^in_[A-Za-z0-9]+$/;

const INVOICE_COLS =
  "stripe_invoice_id, number, status, amount_due, amount_paid, currency, " +
  "hosted_invoice_url, invoice_pdf, period_start, period_end, created, " +
  "stripe_subscription_id";

const PAYMENT_COLS =
  "stripe_payment_intent_id, status, amount, amount_received, currency, " +
  "payment_method_brand, payment_method_last4, created_at";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopId: string; id: string }> }
): Promise<Response> {
  const { shopId, id } = await params;
  if (!UUID_RE.test(shopId) || !STRIPE_INVOICE_RE.test(id)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLS)
    .eq("shop_id", shopId)
    .eq("stripe_invoice_id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: payments } = await supabase
    .from("payments")
    .select(PAYMENT_COLS)
    .eq("shop_id", shopId)
    .eq("stripe_invoice_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json(
    { invoice, payments: payments ?? [] },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
