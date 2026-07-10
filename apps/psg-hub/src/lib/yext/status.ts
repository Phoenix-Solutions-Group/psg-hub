import "server-only";

type QueryResult =
  | { data: unknown; error: { message: string } | null }
  | PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type ReadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => QueryResult;
        order: (
          column: string,
          options: { ascending: boolean }
        ) => { limit: (count: number) => { maybeSingle: () => QueryResult } };
      };
    };
  };
};

export async function fetchYextStatus(client: ReadClient, shopId: string) {
  const [account, listings, reviews] = await Promise.all([
    client
      .from("yext_accounts")
      .select(
        "shop_id, yext_account_id, yext_entity_id, status, last_sync_at, last_sync_status"
      )
      .eq("shop_id", shopId)
      .maybeSingle(),
    client
      .from("yext_listings_cache")
      .select("payload_jsonb, summary_jsonb, cached_at, ttl_at")
      .eq("shop_id", shopId)
      .order("cached_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("yext_reviews_cache")
      .select("payload_jsonb, summary_jsonb, cached_at, ttl_at")
      .eq("shop_id", shopId)
      .order("cached_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const result of [account, listings, reviews]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    account: account.data ?? null,
    listings: listings.data ?? null,
    reviews: reviews.data ?? null,
  };
}
