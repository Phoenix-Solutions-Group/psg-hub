// Stub "server-only" so modules that import it can be loaded in node tests.
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

// Deterministic test env for Google Ads + crypto modules.
process.env.ADS_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
process.env.ADS_STATE_SECRET = "test-state-secret-do-not-use-in-prod";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.ADS_MUTATE_LIMIT_PER_HOUR = "20";
process.env.ADS_READ_LIMIT_PER_HOUR = "500";
process.env.ADS_MAX_DAILY_MICROS = "500000000";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI =
  "https://test.example.com/api/ads/google/callback";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-developer-token";
process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "1234567890";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SHOP_ADS_TIER_OVERRIDE = "";
