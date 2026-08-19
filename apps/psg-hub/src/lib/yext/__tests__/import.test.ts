import { describe, expect, it } from "vitest";
import { buildYextImportRows, importYextSnapshot } from "../import";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";

describe("Yext import normalization", () => {
  it("builds shop-scoped account, listings, and review cache rows", () => {
    const rows = buildYextImportRows({
      source: "yext_export",
      synced_at: "2026-07-10T19:30:00.000Z",
      shops: [
        {
          shop_id: SHOP_ID,
          yext_account_id: "acct-1",
          yext_entity_id: "entity-1",
          listings: [
            {
              publisher: "Google",
              listing_id: "g-1",
              status: "Live - Synced",
              accuracy: 92,
              url: "https://example.com/listing",
              issues: ["Phone mismatch"],
            },
            {
              publisher: "Apple Maps",
              status: "Needs Review",
              accuracy: 80,
            },
          ],
          reviews: {
            average_rating: 4.6,
            review_count: 128,
            response_rate: 87,
            unanswered_count: 3,
            latest_review_at: "2026-07-09T12:00:00.000Z",
            status: "healthy",
          },
        },
      ],
    });

    expect(rows.accounts).toMatchObject([
      {
        shop_id: SHOP_ID,
        yext_account_id: "acct-1",
        yext_entity_id: "entity-1",
        status: "active",
        api_key_ref: null,
      },
    ]);
    expect(rows.listings[0].summary_jsonb).toEqual({
      total: 2,
      by_status: { live_synced: 1, needs_review: 1 },
      average_accuracy: 86,
      issue_count: 1,
    });
    expect(rows.reviews[0].summary_jsonb).toMatchObject({
      average_rating: 4.6,
      review_count: 128,
      response_rate: 87,
      unanswered_count: 3,
    });
    expect(rows.summary).toMatchObject({
      shopCount: 1,
      listingCount: 2,
      reviewStatusCount: 1,
      syncedAt: "2026-07-10T19:30:00.000Z",
    });
  });

  it("upserts each Yext table with a shop-level idempotency key", async () => {
    const calls: Array<{ table: string; onConflict: string; rows: unknown[] }> =
      [];
    const client = {
      from(table: string) {
        return {
          upsert(
            rows: Array<Record<string, unknown>>,
            options: { onConflict: string }
          ) {
            calls.push({ table, onConflict: options.onConflict, rows });
            return { error: null };
          },
        };
      },
    };

    const summary = await importYextSnapshot(client, {
      source: "yext_export",
      synced_at: "2026-07-10T19:30:00.000Z",
      shops: [{ shop_id: SHOP_ID, yext_entity_id: "entity-1" }],
    });

    expect(summary.shopCount).toBe(1);
    expect(calls.map((call) => [call.table, call.onConflict])).toEqual([
      ["yext_accounts", "shop_id"],
      ["yext_listings_cache", "shop_id"],
      ["yext_reviews_cache", "shop_id"],
    ]);
  });
});
