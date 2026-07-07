import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveShopContext } from "@/lib/shop/context";
import { validateShopSettings } from "@/lib/shop/settings-validation";

/**
 * POST /api/shop/settings — save the active shop's own details (PSG-779, B4).
 *
 * Auth pattern mirrors src/app/api/ads/google/campaigns/route.ts:
 *   - getUser() gates unauthenticated callers.
 *   - The target shop is derived SERVER-SIDE from getActiveShopContext(user.id)
 *     — we never trust a client-sent shopId. getActiveShopContext resolves the
 *     active shop only among the user's real memberships (service-role read of
 *     the RLS-locked shop_users table), so activeShopId is already authorized and
 *     carries the caller's role.
 *   - Only owner/manager may save.
 *   - Validation is server-authoritative; the client mirror is convenience only.
 *   - The UPDATE runs on the service client, scoped to the validated shopId.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { shops, activeShopId } = await getActiveShopContext(user.id);
  if (!activeShopId) {
    return NextResponse.json(
      { error: "No shop is linked to your account." },
      { status: 403 }
    );
  }

  // Role comes from the same authorized membership set resolved above.
  const active = shops.find((s) => s.id === activeShopId);
  if (!active) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (active.role !== "owner" && active.role !== "manager") {
    return NextResponse.json(
      { error: "Only owners or managers can update shop settings." },
      { status: 403 }
    );
  }

  const result = validateShopSettings(body);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Please fix the highlighted fields.",
        fieldErrors: result.fieldErrors,
      },
      { status: 400 }
    );
  }

  const v = result.values;
  const service = createServiceClient();
  // NB: `updated_at` is auto-maintained by the shops_updated_at BEFORE UPDATE
  // trigger — do NOT set it here. Optional fields collapse "" -> null.
  const { error: updErr } = await service
    .from("shops")
    .update({
      name: v.name,
      telephone: v.telephone,
      url: v.url,
      radius: v.radius,
      address_street: v.address_street,
      address_locality: v.address_locality || null,
      address_region: v.address_region || null,
      address_postal_code: v.address_postal_code || null,
      hours: v.hours || null,
    })
    .eq("id", activeShopId);

  if (updErr) {
    console.error("[shop/settings] update failed:", updErr.message);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
