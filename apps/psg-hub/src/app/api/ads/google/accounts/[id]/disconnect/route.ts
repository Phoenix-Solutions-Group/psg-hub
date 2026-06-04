import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptRefreshToken } from "@/lib/google-ads/crypto";
import { revokeAtGoogle } from "@/lib/google-ads/oauth";
import { logAdsCall } from "@/lib/google-ads/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accountId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: account, error: acctErr } = await service
    .from("google_ads_accounts")
    .select(
      "id, shop_id, encrypted_refresh_token, key_version, status"
    )
    .eq("id", accountId)
    .maybeSingle();

  if (acctErr) {
    return NextResponse.json({ error: acctErr.message }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", account.shop_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (membership.role !== "owner") {
    return NextResponse.json(
      { error: "Only shop owners can disconnect ad accounts" },
      { status: 403 }
    );
  }

  // Best-effort revoke at Google
  let googleRevoked = false;
  if (account.status === "linked") {
    try {
      const ct =
        account.encrypted_refresh_token instanceof Buffer
          ? account.encrypted_refresh_token
          : Buffer.from(account.encrypted_refresh_token as ArrayBufferLike);
      const refreshToken = decryptRefreshToken(ct, account.key_version as number);
      googleRevoked = await revokeAtGoogle(refreshToken);
    } catch {
      googleRevoked = false;
    }
  }

  await logAdsCall({
    userId: user.id,
    shopId: account.shop_id,
    accountId: account.id,
    endpoint: "oauth2.revoke",
    method: "REVOKE",
    result: googleRevoked ? "success" : "error",
  });

  const { error: updErr } = await service
    .from("google_ads_accounts")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", accountId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    revoked_at: new Date().toISOString(),
    google_revoked: googleRevoked,
  });
}
