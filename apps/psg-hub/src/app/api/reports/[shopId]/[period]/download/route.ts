import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { REPORTS_BUCKET, pdfKey } from "@/lib/report/storage";

// 12-03: customer report download. Clones the reviews/draft-response membership
// gate EXACTLY: session -> explicit shop_users membership check -> service-client
// fetch of the private object -> streamed bytes. It re-auths on EVERY hit and never
// mints or returns a raw signed URL, so the URL is un-shareable (a signed URL would
// leak the object to anyone with the link). runtime=nodejs for the service client.
export const runtime = "nodejs";

const PERIOD_RE = /^\d{4}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopId: string; period: string }> }
): Promise<Response> {
  const { shopId, period } = await params;

  if (!UUID_RE.test(shopId) || !PERIOD_RE.test(period)) {
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

  // Fetch the private object with the service client (RLS-bypass) AFTER the gate.
  const service = createServiceClient();
  const { data, error } = await service.storage
    .from(REPORTS_BUCKET)
    .download(pdfKey(shopId, period));

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-${period}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
