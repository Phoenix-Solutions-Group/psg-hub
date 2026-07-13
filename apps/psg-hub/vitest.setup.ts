// Stub "server-only" so modules that import it can be loaded in node tests.
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

// Deterministic test env for Google Ads + crypto modules.
process.env.ADS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
// CCC Secure Share (PSG-260). Deterministic 32-byte v1 key + rate-limit envs.
process.env.CCC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.CCC_MUTATE_LIMIT_PER_HOUR = "20";
process.env.CCC_READ_LIMIT_PER_HOUR = "500";
process.env.ADS_STATE_SECRET = "test-state-secret-do-not-use-in-prod";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.ADS_MUTATE_LIMIT_PER_HOUR = "20";
process.env.ADS_READ_LIMIT_PER_HOUR = "500";
process.env.ADS_MAX_DAILY_MICROS = "500000000";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_ADS_CLIENT_ID = "test-ads-client-id";
process.env.GOOGLE_ADS_CLIENT_SECRET = "test-ads-client-secret";
process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI =
  "https://test.example.com/api/ads/google/callback";
// Phase 11 (GA4 + GSC): the one new env this flow adds (the combined-consent
// redirect). Reuses GOOGLE_OAUTH_CLIENT_ID/SECRET + ADS_STATE_SECRET + ADS_ENCRYPTION_KEY.
process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI =
  "https://test.example.com/api/analytics/google/callback";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer-token";
process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "1234567890";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SHOP_ADS_TIER_OVERRIDE = "";

// SendGrid (Phase 3 — Plan 03-01). Deterministic dummy values for unit tests.
process.env.SENDGRID_API_KEY = "SG.test-sendgrid-key";
process.env.SENDGRID_FROM_EMAIL = "test-noreply@psgweb.me";
process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = "test-sendgrid-verification-key";

// Twilio (Phase 3 — Plan 03-02). Deterministic dummy values for unit tests.
process.env.TWILIO_ACCOUNT_SID = "ACtestaccountsid000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-auth-token";
process.env.TWILIO_MESSAGING_SERVICE_SID = "MGtestmessagingservice0000000000000";
process.env.TWILIO_WEBHOOK_BASE_URL = "https://test.psgweb.me";
