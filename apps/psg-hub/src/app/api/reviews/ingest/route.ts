import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type IngestBody = { shop_id?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shop_id = body.shop_id;
  if (!shop_id) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Review ingest (sources + reviews) is deferred to its own milestone; those backing
  // tables are not yet provisioned. Guard the route so it returns a clear "not
  // configured" response BEFORE any phantom-table query, instead of a 500.
  return NextResponse.json(
    { error: "Review sync not configured yet" },
    { status: 501 }
  );
}
