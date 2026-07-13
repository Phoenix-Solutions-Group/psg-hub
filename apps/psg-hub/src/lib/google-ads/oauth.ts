import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { getGoogleAdsOAuthCredentials } from "./credentials";

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

  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("GOOGLE_ADS_OAUTH_REDIRECT_URI missing");
  }
  const { clientId } = getGoogleAdsOAuthCredentials();

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

/**
 * Verify a state token's signature/expiry and confirm the row exists and is not
 * yet consumed — WITHOUT consuming it. Used at the top of the callback so the
 * multi-account picker can leave the state open for `/select` to consume.
 */
export async function peekState(
  stateToken: string
): Promise<{ userId: string; shopId: string }> {
  verify(stateToken);

  const service = createServiceClient();
  const { data, error } = await service
    .from("google_ads_oauth_states")
    .select("user_id, shop_id, consumed_at")
    .eq("state_token", stateToken)
    .maybeSingle();

  if (error) throw new Error(`state read failed: ${error.message}`);
  if (!data) throw new StateError("not_found");
  if (data.consumed_at) throw new StateError("replayed");
  return { userId: data.user_id, shopId: data.shop_id };
}

/** A selectable account offered to the user in the picker. */
export type PendingAccount = { id: string; name: string };

/** Transient link state carried from `callback` to `/select`. */
export type PendingSelection = {
  encryptedTokenHex: string; // Postgres `\x<hex>` bytea text form
  keyVersion: number;
  scope: string;
  loginCustomerId: string | null;
  customers: PendingAccount[];
};

/**
 * Stash the encrypted refresh token + enumerated account list on an UNCONSUMED
 * state row, so the user can pick an account in a second request. Throws
 * `replayed` if the row is missing or already consumed.
 */
export async function stashPendingSelection(
  stateToken: string,
  p: PendingSelection
): Promise<void> {
  verify(stateToken);

  const service = createServiceClient();
  const { data, error } = await service
    .from("google_ads_oauth_states")
    .update({
      pending_encrypted_token: p.encryptedTokenHex,
      pending_key_version: p.keyVersion,
      pending_scope: p.scope,
      pending_login_customer_id: p.loginCustomerId,
      pending_customers: p.customers,
    })
    .eq("state_token", stateToken)
    .is("consumed_at", null)
    .select("state_token")
    .maybeSingle();

  if (error) throw new Error(`stash failed: ${error.message}`);
  if (!data) throw new StateError("replayed");
}

/**
 * Atomically consume a state row that carries a stashed pending selection,
 * returning the binding (userId/shopId) and the pending payload. Mirrors
 * `verifyAndConsumeState`'s replay protection. Throws `malformed` if no pending
 * selection was stashed on the row.
 */
export async function consumePendingSelection(stateToken: string): Promise<{
  userId: string;
  shopId: string;
  pending: PendingSelection;
}> {
  verify(stateToken);

  const service = createServiceClient();
  const { data: updated, error } = await service
    .from("google_ads_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_token", stateToken)
    .is("consumed_at", null)
    .select(
      "user_id, shop_id, pending_encrypted_token, pending_key_version, pending_scope, pending_login_customer_id, pending_customers"
    )
    .maybeSingle();

  if (error) throw new Error(`pending consume failed: ${error.message}`);
  if (!updated) {
    const { data: existing } = await service
      .from("google_ads_oauth_states")
      .select("consumed_at")
      .eq("state_token", stateToken)
      .maybeSingle();
    if (!existing) throw new StateError("not_found");
    throw new StateError("replayed");
  }
  if (!updated.pending_encrypted_token || updated.pending_key_version == null) {
    throw new StateError("malformed");
  }

  return {
    userId: updated.user_id,
    shopId: updated.shop_id,
    pending: {
      encryptedTokenHex: updated.pending_encrypted_token,
      keyVersion: updated.pending_key_version,
      scope: updated.pending_scope ?? "",
      loginCustomerId: updated.pending_login_customer_id ?? null,
      customers: (updated.pending_customers as PendingAccount[] | null) ?? [],
    },
  };
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}> {
  const redirectUri = process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("GOOGLE_ADS_OAUTH_REDIRECT_URI missing");
  }
  const { clientId, clientSecret } = getGoogleAdsOAuthCredentials();

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
