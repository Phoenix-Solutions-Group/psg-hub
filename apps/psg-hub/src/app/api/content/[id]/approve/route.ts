import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  // Load content item for tenancy check
  const { data: item, error: itemErr } = await supabase
    .from("content_items")
    .select("id, shop_id")
    .eq("id", id)
    .maybeSingle();

  if (itemErr) {
    return NextResponse.json({ error: itemErr.message }, { status: 500 });
  }
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Membership + role gate: approval requires owner or manager on the item's shop
  const { data: membership } = await supabase
    .from("shop_members")
    .select("role")
    .eq("profile_id", user.id)
    .eq("shop_id", item.shop_id)
    .maybeSingle();

  if (
    !membership ||
    (membership.role !== "owner" && membership.role !== "manager")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("content_items")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
