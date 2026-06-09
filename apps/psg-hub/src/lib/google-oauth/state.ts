import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

// Phase 11 / 11-01 — parameterized OAuth state machine for the combined GA4 + GSC
// link. A faithful clone of src/lib/google-ads/oauth.ts with the two ads couplings
// GENERALIZED: the scope and the redirect URI are passed in per flow (the ads
// version hardcodes SCOPE='.../adwords' and reads GOOGLE_ADS_OAUTH_REDIRECT_URI).
// Everything else is reused verbatim: HMAC sign/verify (sha256 over base64url,
// timingSafeEqual), STATE_TTL, atomic anti-replay consume (`.is('consumed_at',
// null)`), lazy expiry GC. Backed by the NEW google_oauth_pending_states table;
// the HMAC secret is the shared ADS_STATE_SECRET (cross-flow replay is blocked by
// table isolation — a token signed for one flow can't consume a row in the other).

const STATE_TTL_MS = 10 * 60 * 1000;
const TABLE = "google_oauth_pending_states";

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
  // Reuse the Ads state secret — no new prod secret. Table isolation prevents
  // cross-flow replay regardless of a shared signing key.
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

/**
 * Build the Google authorization URL for a per-flow scope + redirect URI, and
 * persist the signed state row. `scope` is space-joined (combined GA4 + GSC for
 * Phase 11); `redirectUri` MUST match the one passed to exchangeCodeForTokens or
 * Google rejects the code exchange (RESEARCH: the load-bearing clone slip).
 */
export async function buildAuthorizeUrl(input: {
  scope: string;
  redirectUri: string;
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
  const { error } = await service.from(TABLE).insert({
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
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID missing");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: input.scope,
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

  // Lazy GC: opportunistically clean expired states.
  await service.from(TABLE).delete().lt("expires_at", new Date().toISOString());

  // Atomic consume: only succeeds if consumed_at IS NULL.
  const { data: updated, error } = await service
    .from(TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_token", stateToken)
    .is("consumed_at", null)
    .select("user_id, shop_id")
    .maybeSingle();

  if (error) {
    throw new Error(`state consume failed: ${error.message}`);
  }
  if (!updated) {
    const { data: existing } = await service
      .from(TABLE)
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
 * picker can leave the state open for `/select` to consume.
 */
export async function peekState(
  stateToken: string
): Promise<{ userId: string; shopId: string }> {
  verify(stateToken);

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
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

/** Both enumerated source lists carried from callback to /select. */
export type PendingAccounts = {
  ga4: PendingAccount[];
  gsc: PendingAccount[];
};

/** Transient link state carried from `callback` to `/select`. One refresh token,
 *  both source lists. No login_customer_id (no MCC concept for GA4/GSC). */
export type PendingSelection = {
  encryptedTokenHex: string; // Postgres `\x<hex>` bytea text form
  keyVersion: number;
  scope: string;
  accounts: PendingAccounts;
};

/**
 * Stash the encrypted refresh token + both enumerated account lists on an
 * UNCONSUMED state row, so the user can pick a GA4 property + a GSC site in a
 * second request. Throws `replayed` if the row is missing or already consumed.
 */
export async function stashPendingSelection(
  stateToken: string,
  p: PendingSelection
): Promise<void> {
  verify(stateToken);

  const service = createServiceClient();
  const { data, error } = await service
    .from(TABLE)
    .update({
      pending_encrypted_token: p.encryptedTokenHex,
      pending_key_version: p.keyVersion,
      pending_scope: p.scope,
      pending_accounts: p.accounts,
    })
    .eq("state_token", stateToken)
    .is("consumed_at", null)
    .select("state_token")
    .maybeSingle();

  if (error) throw new Error(`stash failed: ${error.message}`);
  if (!data) throw new StateError("replayed");
}

/**
 * Atomically consume a state row carrying a stashed pending selection, returning
 * the binding (userId/shopId) and the pending payload. Mirrors
 * verifyAndConsumeState's replay protection. Throws `malformed` if no pending
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
    .from(TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_token", stateToken)
    .is("consumed_at", null)
    .select(
      "user_id, shop_id, pending_encrypted_token, pending_key_version, pending_scope, pending_accounts"
    )
    .maybeSingle();

  if (error) throw new Error(`pending consume failed: ${error.message}`);
  if (!updated) {
    const { data: existing } = await service
      .from(TABLE)
      .select("consumed_at")
      .eq("state_token", stateToken)
      .maybeSingle();
    if (!existing) throw new StateError("not_found");
    throw new StateError("replayed");
  }
  if (!updated.pending_encrypted_token || updated.pending_key_version == null) {
    throw new StateError("malformed");
  }

  const rawAccounts = (updated.pending_accounts ?? {}) as Partial<PendingAccounts>;
  return {
    userId: updated.user_id,
    shopId: updated.shop_id,
    pending: {
      encryptedTokenHex: updated.pending_encrypted_token,
      keyVersion: updated.pending_key_version,
      scope: updated.pending_scope ?? "",
      accounts: {
        ga4: Array.isArray(rawAccounts.ga4) ? rawAccounts.ga4 : [],
        gsc: Array.isArray(rawAccounts.gsc) ? rawAccounts.gsc : [],
      },
    },
  };
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  // redirectUri is a REQUIRED arg (NOT read from an env fallback) — it must be
  // byte-identical to the one used at authorize time or Google 400s the exchange.
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
    throw new Error(
      `token exchange failed: ${res.status} ${text.slice(0, 200)}`
    );
  }

  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
    expires_in: number;
  };
}
