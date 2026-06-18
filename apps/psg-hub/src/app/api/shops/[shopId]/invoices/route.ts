import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PSG-59 — customer-facing invoice list for a shop. Mirrors the reports download
// membership gate: session → explicit shop_users tenancy check (distinct 403, not a
// silent RLS-empty) → RLS-clamped read. No service-role bypass needed for a read of
// the customer's own data; RLS on `invoices` (shop_id IN user_shop_ids()) is a second
// clamp behind the explicit gate. runtime=nodejs for parity with the auth'd routes.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

// Columns safe to expose to the customer — financial record only, no payer identity.
const INVOICE_COLS =
  "stripe_invoice_id, number, status, amount_due, amount_paid, currency, " +
  "hosted_invoice_url, invoice_pdf, period_start, period_end, created, " +
  "stripe_subscription_id";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopId: string }> }
): Promise<Response> {
  const { shopId } = await params;
  if (!UUID_RE.test(shopId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Explicit tenancy check — do not rely on RLS returning empty to signal 403.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_COLS)
    .eq("shop_id", shopId)
    .order("created", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json(
    { invoices: data ?? [] },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
