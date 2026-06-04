import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

const STATE_TTL_MS = 10 * 60 * 1000;
const SCOPE = "https://www.googleapis.com/auth/adwords";

export class StateError extends Error {
  constructor(
    public code:
      | "invalid_signature"
      | "expired"
      | "replayed"
      | "not_found"
      | "missing_secret"
      | "malformed"
  ) {
    super(`state ${code}`);
    this.name = "StateError";
  }
}

type StatePayload = {
  userId: string;
  shopId: string;
  nonce: string;
  exp: number;
};

function getSecret(): Buffer {
  const s = process.env.ADS_STATE_SECRET;
  if (!s) throw new StateError("missing_secret");
  return Buffer.from(s, "utf8");
}

function sign(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const mac = createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(stateToken: string): StatePayload {
  const parts = stateToken.split(".");
  if (parts.length !== 2) throw new StateError("malformed");
  const [body, mac] = parts;
  const expected = createHmac("sha256", getSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new StateError("invalid_signature");
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as StatePayload;
  } catch {
    throw new StateError("malformed");
  }
  if (!payload.userId || !payload.shopId || !payload.nonce || !payload.exp) {
    throw new StateError("malformed");
  }
  if (Date.now() > payload.exp) throw new StateError("expired");
  return payload;
}

export async function buildAuthorizeUrl(input: {
  userId: string;
  shopId: string;
}): Promise<{ url: string; stateToken: string }> {
  const nonce = randomBytes(16).toString("base64url");
  const payload: StatePayload = {
    userId: input.userId,
    shopId: input.shopId,
    nonce,
    exp: Date.now() + STATE_TTL_MS,
  };
  const stateToken = sign(payload);

  const service = createServiceClient();
  const { error } = await service.from("google_ads_oauth_states").insert({
    state_token: stateToken,
    user_id: input.userId,
    shop_id: input.shopId,
    nonce,
    expires_at: new Date(payload.exp).toISOString(),
  });
  if (error) {
    throw new Error(`state insert failed: ${error.message}`);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID or GOOGLE_ADS_OAUTH_REDIRECT_URI missing"
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: stateToken,
    include_granted_scopes: "true",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return { url, stateToken };
}

export async function verifyAndConsumeState(
  stateToken: string
): Promise<{ userId: string; shopId: string }> {
  verify(stateToken);

  const service = createServiceClient();

  // Lazy GC: opportunistically clean expired + old-consumed states.
  await service
    .from("google_ads_oauth_states")
    .delete()
    .lt("expires_at", new Date().toISOString());

  // Atomic consume: only succeeds if consumed_at IS NULL.
  const { data: updated, error } = await service
    .from("google_ads_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_token", stateToken)
    .is("consumed_at", null)
    .select("user_id, shop_id")
    .maybeSingle();

  if (error) {
    throw new Error(`state consume failed: ${error.message}`);
  }
  if (!updated) {
    // Row either never existed or was already consumed.
    const { data: existing } = await service
      .from("google_ads_oauth_states")
      .select("consumed_at")
      .eq("state_token", stateToken)
      .maybeSingle();
    if (!existing) throw new StateError("not_found");
    throw new StateError("replayed");
  }

  return { userId: updated.user_id, shopId: updated.shop_id };
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("OAuth env vars missing");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
    expires_in: number;
  };
}

export async function revokeAtGoogle(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
      { method: "POST" }
    );
    return res.ok;
  } catch {
    return false;
  }
}
