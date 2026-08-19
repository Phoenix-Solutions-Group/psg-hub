import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchYextStatus, type ReadClient } from "@/lib/yext/status";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

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

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const status = await fetchYextStatus(
      supabase as unknown as ReadClient,
      shopId
    );
    return NextResponse.json(status, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[yext/status] load failed:", (err as Error).message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
