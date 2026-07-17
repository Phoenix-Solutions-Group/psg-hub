import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BsmCustomerReviewError, requestBsmContentRestore } from "@/lib/bsm/customer-content-review";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { versionId?: unknown; reason?: unknown } | null;
  try {
    const restoreRequest = await requestBsmContentRestore(supabase, id, user.id, body?.versionId, body?.reason);
    return NextResponse.json({ request: restoreRequest }, { status: 201 });
  } catch (error) {
    if (error instanceof BsmCustomerReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
