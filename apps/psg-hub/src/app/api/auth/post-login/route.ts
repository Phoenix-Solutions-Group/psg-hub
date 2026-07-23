import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDashboardAccess, postLoginPathFor } from "@/lib/auth/shop-access";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getDashboardAccess(user.id);
  return NextResponse.json({ redirectTo: postLoginPathFor(access) });
}
