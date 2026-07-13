import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDirectMailMetrics } from "@/lib/analytics/direct-mail";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const DEFAULT_WINDOW_DAYS = 30;

export async function GET(
  request: Request,
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

  const url = new URL(request.url);
  const { from, to } = dateRangeFromUrl(url);

  try {
    const metrics = await getDirectMailMetrics({
      authorizedShopIds: [shopId],
      from,
      to,
    });
    return NextResponse.json(metrics, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[direct-mail/metrics] load failed:", (err as Error).message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function dateRangeFromUrl(url: URL): { from: string; to: string | null } {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(today.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));

  return {
    from: isIsoDate(fromParam) ? fromParam : defaultFrom.toISOString().slice(0, 10),
    to: isIsoDate(toParam) ? toParam : null,
  };
}

function isIsoDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}
