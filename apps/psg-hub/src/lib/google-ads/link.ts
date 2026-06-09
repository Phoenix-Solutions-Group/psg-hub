import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Persist (upsert) a linked Google Ads account. The refresh token is supplied
 * already encrypted, in Postgres `\x<hex>` bytea text form (the 10-01 finding:
 * a raw Buffer JSON-serializes wrong over PostgREST). Upsert on
 * (shop_id, customer_id) allows reconnect after revoke.
 */
export async function persistLinkedAccount(input: {
  shopId: string;
  customerId: string;
  loginCustomerId: string | null;
  encryptedTokenHex: string; // "\\x...."
  keyVersion: number;
  scope: string;
  linkedBy: string;
}): Promise<{ error: string | null }> {
  const service = createServiceClient();
  const { error } = await service.from("google_ads_accounts").upsert(
    {
      shop_id: input.shopId,
      customer_id: input.customerId,
      login_customer_id: input.loginCustomerId,
      encrypted_refresh_token: input.encryptedTokenHex,
      key_version: input.keyVersion,
      scope: input.scope,
      status: "linked",
      linked_by: input.linkedBy,
      linked_at: new Date().toISOString(),
      revoked_at: null,
      last_error: null,
    },
    { onConflict: "shop_id,customer_id" }
  );
  return { error: error ? error.message : null };
}
