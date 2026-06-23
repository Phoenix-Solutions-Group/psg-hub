import "server-only";

export type CccAccountStatus = "linked" | "revoked" | "error";

// Phase-0-abstract credential scheme discriminator. 'unconfirmed' is the scaffold
// state; PSG-251 lands the real scheme.
export type CccCredentialKind =
  | "unconfirmed"
  | "oauth_refresh_token"
  | "api_key"
  | "certificate";

// Mirror ads_api_call_log method/result vocabularies for ledger consistency.
export type CccApiMethod = "GET" | "MUTATE" | "SEARCH" | "REVOKE";
export type CccApiCallResult =
  | "success"
  | "error"
  | "timeout"
  | "rate_limited"
  | "auth_failed";

export type CccAccountRow = {
  id: string;
  shop_id: string;
  ccc_account_id: string;
  facility_id: string | null;
  credential_kind: CccCredentialKind;
  encrypted_credential: Buffer | null;
  key_version: number | null;
  status: CccAccountStatus;
  linked_by: string | null;
  linked_at: string;
  revoked_at: string | null;
  last_error: string | null;
};

export type CccErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "bad_request"
  | "upstream"
  | "timeout";

export class CccApiError extends Error {
  constructor(
    public code: CccErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "CccApiError";
  }
}

// Thrown by the auth seam until Phase 0 confirms the CCC Secure Share scheme.
export class NotImplementedError extends Error {
  constructor(message?: string) {
    super(message ?? "Not implemented");
    this.name = "NotImplementedError";
  }
}
