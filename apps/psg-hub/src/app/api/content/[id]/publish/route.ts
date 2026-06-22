import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// PSG-194 — approved -> published gate hook (route half of defense in depth; the
// DB trigger content_items_publish_gate is the second layer). Publishing is
// refused unless the item is already `approved` AND both trust verdicts are
// `ship`: the PSG-143 claim-integrity Check 3 (claim_integrity_verdict) and the
// PSG-173 8-check publish gate (gate_verdict). A non-ship draft can never reach
// `published`.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load content item for tenancy check + gate inputs.
  const { data: item, error: itemErr } = await supabase
    .from("content_items")
    .select("id, shop_id, status, claim_integrity_verdict, gate_verdict")
    .eq("id", id)
    .maybeSingle();

  if (itemErr) {
    console.error("[content/publish] item lookup failed:", itemErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Membership + role gate: publishing requires owner or manager on the shop.
  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", item.shop_id)
    .maybeSingle();

  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "manager")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Publish gate (defense in depth: also enforced by the DB trigger) ──────
  // 1. Status must be approved (the human review step already passed).
  if (item.status !== "approved") {
    return NextResponse.json(
      { error: "Not approved", reason: `status is '${item.status}', expected 'approved'` },
      { status: 409 }
    );
  }
  // 2. Claim-integrity Check 3 must have shipped (verified-facts trust gate).
  const claimVerdict =
    (item.claim_integrity_verdict as { verdict?: string } | null)?.verdict ?? null;
  // 3. PSG-173 8-check publish gate must have shipped.
  const gateVerdict =
    (item.gate_verdict as { verdict?: string } | null)?.verdict ?? null;

  if (claimVerdict !== "ship" || gateVerdict !== "ship") {
    return NextResponse.json(
      {
        error: "Gate not cleared",
        reason: "publish requires claim_integrity_verdict.verdict='ship' AND gate_verdict.verdict='ship'",
        claimIntegrityVerdict: claimVerdict,
        gateVerdict,
      },
      { status: 409 }
    );
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("content_items")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("shop_id", item.shop_id)
    // Optimistic guard: only transition a row still in `approved`, so a
    // concurrent publish/reject cannot double-apply.
    .eq("status", "approved")
    .select("id, status, published_at")
    .single();

  if (error) {
    console.error("[content/publish] update failed:", error.message);
    return NextResponse.json({ error: "Publish failed" }, { status: 400 });
  }

  return NextResponse.json(data);
}
