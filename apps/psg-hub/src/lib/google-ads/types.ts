import "server-only";

export type GoogleAdsAccountStatus = "linked" | "revoked" | "error";
export type GoogleAdsCampaignStatus = "paused" | "enabled" | "removed";
export type AdsApiMethod = "GET" | "MUTATE" | "SEARCH" | "REVOKE";
export type AdsApiCallResult =
  | "success"
  | "error"
  | "timeout"
  | "rate_limited"
  | "auth_failed";

export type GoogleAdsAccountRow = {
  id: string;
  shop_id: string;
  customer_id: string;
  login_customer_id: string | null;
  encrypted_refresh_token: Buffer;
  key_version: number;
  scope: string;
  status: GoogleAdsAccountStatus;
  linked_by: string | null;
  linked_at: string;
  revoked_at: string | null;
  last_error: string | null;
};

export type GoogleAdsCampaignRow = {
  id: string;
  shop_id: string;
  account_id: string;
  external_resource_name: string;
  external_id: string;
  name: string;
  template_id: string | null;
  campaign_type: string;
  status: GoogleAdsCampaignStatus;
  daily_budget_micros: number;
  metrics: Record<string, unknown>;
  metrics_synced_at: string | null;
};

export type AdsErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "bad_request"
  | "upstream"
  | "timeout"
  | "tier_required"
  | "budget_exceeded"
  | "shop_preflight_failed";

export class AdsApiError extends Error {
  constructor(
    public code: AdsErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "AdsApiError";
  }
}
