import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service client; the crypto is REAL (ADS_ENCRYPTION_KEY set in setup),
// so the `\x<hex>` round-trip is exercised end-to-end.
const fromMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: fromMock }),
}));

import { encryptRefreshToken } from "@/lib/google-ads/crypto";
import {
  getLinkedAccount,
  markAccountError,
} from "@/lib/google-oauth/accounts";
import { GoogleApiError } from "@/lib/google-oauth/client";

/** Build a `\x<hex>` bytea-text encoding of an encrypted refresh token. */
function encHex(token: string): { hex: string; keyVersion: number } {
  const { ciphertext, keyVersion } = encryptRefreshToken(token);
  return { hex: `\\x${ciphertext.toString("hex")}`, keyVersion };
}

/** Chainable select builder ending in maybeSingle; plus an update().eq() recorder. */
function makeService(opts: {
  row?: Record<string, unknown> | null;
  selectError?: { message: string };
}) {
  const updates: { patch: Record<string, unknown>; id: unknown }[] = [];
  const selectBuilder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) {
    selectBuilder[m] = () => selectBuilder;
  }
  selectBuilder.maybeSingle = async () =>
    opts.selectError
      ? { data: null, error: opts.selectError }
      : { data: opts.row ?? null, error: null };

  fromMock.mockImplementation(() => ({
    ...selectBuilder,
    update: (patch: Record<string, unknown>) => ({
      eq: async (_col: string, id: unknown) => {
        updates.push({ patch, id });
        return { error: null };
      },
    }),
  }));
  return { updates };
}

beforeEach(() => {
  fromMock.mockReset();
});

describe("getLinkedAccount", () => {
  it("decodes the `\\x<hex>` bytea token and returns the decrypted refresh token", async () => {
    const { hex, keyVersion } = encHex("ga4-refresh-token-xyz");
    makeService({
      row: {
        id: "acct-1",
        external_account_id: "properties/123456789",
        encrypted_refresh_token: hex,
        key_version: keyVersion,
      },
    });

    const out = await getLinkedAccount("shop-1", "ga4");
    expect(out).toEqual({
      accountId: "acct-1",
      externalAccountId: "properties/123456789",
      externalParentId: null, // ga4 has no parent account
      refreshToken: "ga4-refresh-token-xyz",
    });
  });

  it("returns externalParentId ('accounts/{id}') for a gbp row; null for ga4/gsc (13-03a)", async () => {
    const gbp = encHex("gbp-refresh-token");
    makeService({
      row: {
        id: "acct-gbp",
        external_account_id: "locations/987654321",
        external_parent_id: "accounts/111222333",
        encrypted_refresh_token: gbp.hex,
        key_version: gbp.keyVersion,
      },
    });
    const out = await getLinkedAccount("shop-1", "gbp");
    expect(out?.externalParentId).toBe("accounts/111222333");
    expect(out?.externalAccountId).toBe("locations/987654321");

    // a row whose external_parent_id is absent (ga4/gsc) -> externalParentId null
    const ga4 = encHex("ga4-token");
    makeService({
      row: {
        id: "acct-ga4",
        external_account_id: "properties/42",
        encrypted_refresh_token: ga4.hex,
        key_version: ga4.keyVersion,
      },
    });
    const out2 = await getLinkedAccount("shop-1", "ga4");
    expect(out2?.externalParentId).toBeNull();
  });

  it("returns null when no linked account exists", async () => {
    makeService({ row: null });
    const out = await getLinkedAccount("shop-1", "ga4");
    expect(out).toBeNull();
  });

  it("throws GoogleApiError('auth_failed') on a decrypt failure (corrupt token)", async () => {
    makeService({
      row: {
        id: "acct-1",
        external_account_id: "properties/1",
        encrypted_refresh_token: "\\xdeadbeef", // too short / not valid GCM
        key_version: 1,
      },
    });
    await expect(getLinkedAccount("shop-1", "ga4")).rejects.toBeInstanceOf(
      GoogleApiError
    );
    await expect(getLinkedAccount("shop-1", "ga4")).rejects.toMatchObject({
      code: "auth_failed",
    });
  });

  it("surfaces a select error as GoogleApiError('upstream')", async () => {
    makeService({ selectError: { message: "db down" } });
    await expect(getLinkedAccount("shop-1", "ga4")).rejects.toMatchObject({
      code: "upstream",
    });
  });
});

describe("markAccountError", () => {
  it("updates the account to status='error' with a sanitized last_error", async () => {
    const { updates } = makeService({ row: null });
    await markAccountError("acct-9", "invalid_grant: token revoked");
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("acct-9");
    expect(updates[0].patch.status).toBe("error");
    expect(typeof updates[0].patch.last_error).toBe("string");
  });
});
