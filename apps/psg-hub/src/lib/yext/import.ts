import "server-only";
import { z } from "zod";

const LISTING_TTL_DAYS = 30;

const yextListingSchema = z.object({
  publisher: z.string().trim().min(1),
  listing_id: z.string().trim().min(1).nullish(),
  status: z.string().trim().min(1),
  accuracy: z.number().min(0).max(100).nullish(),
  url: z.string().url().nullish(),
  last_updated_at: z.string().datetime().nullish(),
  issues: z.array(z.string().trim().min(1)).default([]),
});

const yextReviewSchema = z
  .object({
    average_rating: z.number().min(0).max(5).nullish(),
    review_count: z.number().int().min(0).nullish(),
    response_rate: z.number().min(0).max(100).nullish(),
    unanswered_count: z.number().int().min(0).nullish(),
    latest_review_at: z.string().datetime().nullish(),
    status: z.string().trim().min(1).nullish(),
  })
  .default({});

const yextShopSchema = z.object({
  shop_id: z.string().uuid(),
  yext_account_id: z.string().trim().min(1).nullish(),
  yext_entity_id: z.string().trim().min(1),
  listings: z.array(yextListingSchema).default([]),
  reviews: yextReviewSchema,
});

export const yextImportPayloadSchema = z.object({
  source: z.literal("yext_export").default("yext_export"),
  synced_at: z.string().datetime().nullish(),
  shops: z.array(yextShopSchema).min(1),
});

export type YextImportPayload = z.infer<typeof yextImportPayloadSchema>;
export type YextImportInput = z.input<typeof yextImportPayloadSchema>;

export type YextImportRows = {
  accounts: Array<Record<string, unknown>>;
  listings: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  summary: {
    shopCount: number;
    listingCount: number;
    reviewStatusCount: number;
    syncedAt: string;
    ttlAt: string;
  };
};

export function buildYextImportRows(input: YextImportInput | unknown): YextImportRows {
  const payload = yextImportPayloadSchema.parse(input);
  const syncedAt = payload.synced_at ?? new Date().toISOString();
  const ttlAt = new Date(
    new Date(syncedAt).getTime() + LISTING_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const accounts = payload.shops.map((shop) => ({
    shop_id: shop.shop_id,
    yext_account_id: shop.yext_account_id ?? null,
    yext_entity_id: shop.yext_entity_id,
    status: "active",
    api_key_ref: null,
    last_sync_at: syncedAt,
    last_sync_status: "imported",
    updated_at: syncedAt,
  }));

  const listings = payload.shops.map((shop) => {
    const normalizedListings = shop.listings.map((listing) => ({
      ...listing,
      listing_id: listing.listing_id ?? null,
      accuracy: listing.accuracy ?? null,
      url: listing.url ?? null,
      last_updated_at: listing.last_updated_at ?? null,
      status_key: normalizeStatus(listing.status),
    }));

    return {
      shop_id: shop.shop_id,
      yext_entity_id: shop.yext_entity_id,
      payload_jsonb: { listings: normalizedListings },
      summary_jsonb: summarizeListings(normalizedListings),
      cached_at: syncedAt,
      ttl_at: ttlAt,
      updated_at: syncedAt,
    };
  });

  const reviews = payload.shops.map((shop) => ({
    shop_id: shop.shop_id,
    yext_entity_id: shop.yext_entity_id,
    payload_jsonb: shop.reviews,
    summary_jsonb: summarizeReviews(shop.reviews),
    cached_at: syncedAt,
    ttl_at: ttlAt,
    updated_at: syncedAt,
  }));

  return {
    accounts,
    listings,
    reviews,
    summary: {
      shopCount: payload.shops.length,
      listingCount: payload.shops.reduce(
        (count, shop) => count + shop.listings.length,
        0
      ),
      reviewStatusCount: payload.shops.filter(
        (shop) => Object.keys(shop.reviews).length > 0
      ).length,
      syncedAt,
      ttlAt,
    },
  };
}

export type UpsertClient = {
  from: (table: string) => {
    upsert: (
      rows: Array<Record<string, unknown>>,
      options: { onConflict: string }
    ) =>
      | { error: { message: string } | null }
      | PromiseLike<{ error: { message: string } | null }>;
  };
};

export async function importYextSnapshot(
  client: UpsertClient,
  rawPayload: unknown
): Promise<YextImportRows["summary"]> {
  const rows = buildYextImportRows(rawPayload);

  await upsertOrThrow(client, "yext_accounts", rows.accounts, "shop_id");
  await upsertOrThrow(client, "yext_listings_cache", rows.listings, "shop_id");
  await upsertOrThrow(client, "yext_reviews_cache", rows.reviews, "shop_id");

  return rows.summary;
}

async function upsertOrThrow(
  client: UpsertClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string
): Promise<void> {
  const result = await client.from(table).upsert(rows, { onConflict });
  if (result.error) {
    throw new Error(`${table}: ${result.error.message}`);
  }
}

function normalizeStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function summarizeListings(
  listings: Array<{ status_key: string; accuracy: number | null; issues: string[] }>
): Record<string, unknown> {
  const byStatus = listings.reduce<Record<string, number>>((acc, listing) => {
    acc[listing.status_key] = (acc[listing.status_key] ?? 0) + 1;
    return acc;
  }, {});
  const accuracyValues = listings
    .map((listing) => listing.accuracy)
    .filter((value): value is number => typeof value === "number");
  const issueCount = listings.reduce(
    (count, listing) => count + listing.issues.length,
    0
  );

  return {
    total: listings.length,
    by_status: byStatus,
    average_accuracy:
      accuracyValues.length === 0
        ? null
        : Math.round(
            accuracyValues.reduce((sum, value) => sum + value, 0) /
              accuracyValues.length
          ),
    issue_count: issueCount,
  };
}

function summarizeReviews(
  reviews: YextImportPayload["shops"][number]["reviews"]
): Record<string, unknown> {
  return {
    average_rating: reviews.average_rating ?? null,
    review_count: reviews.review_count ?? null,
    response_rate: reviews.response_rate ?? null,
    unanswered_count: reviews.unanswered_count ?? null,
    latest_review_at: reviews.latest_review_at ?? null,
    status: reviews.status ?? null,
  };
}
