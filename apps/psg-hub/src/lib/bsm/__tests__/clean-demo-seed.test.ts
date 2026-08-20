import { describe, expect, it } from "vitest";

import {
  assertNoRealRiversideCollision,
  assertNoSupabaseError,
  assertRequiredRiversideSeedTablesExist,
  buildAggregateDerivedAnalyticsRows,
  buildAggregateDerivedDirectMailPrior,
  buildRiversideDemoInvoiceRows,
  buildRiversideOperationalReportRows,
  CLEAN_DEMO_SEED,
  deriveGoogleAdsBenchmarkMetrics,
  REQUIRED_RIVERSIDE_PRODUCTION_TABLES,
  demoCustomerContentItemRow,
  requiredDemoEnvNames,
  shouldSeedInternalRegressionUser,
} from "../../../../scripts/seed-superadmin-qa-env.mjs";

function riversideCollisionClient({
  clients = [],
  shops = [],
}: {
  clients?: Array<{ id: string; name: string; website_url: string | null }>;
  shops?: Array<{ id: string; name: string; slug: string; url: string | null }>;
}) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: table === "clients" ? clients : [], error: null });
            },
            or() {
              return Promise.resolve({ data: table === "shops" ? shops : [], error: null });
            },
          };
        },
      };
    },
  };
}

describe("clean BSM demo seed", () => {
  it("requires only the two visible demo accounts by default", () => {
    const env = {
      NODE_ENV: "test" as const,
      DEMO_OPERATOR_EMAIL: "admin@example.test",
      DEMO_OPERATOR_PASSWORD: "password",
      DEMO_SHOP_EMAIL: "shop@example.test",
      DEMO_SHOP_PASSWORD: "password",
    };

    expect(shouldSeedInternalRegressionUser(env)).toBe(false);
    expect(requiredDemoEnvNames(env)).toEqual([
      "DEMO_OPERATOR_EMAIL",
      "DEMO_OPERATOR_PASSWORD",
      "DEMO_SHOP_EMAIL",
      "DEMO_SHOP_PASSWORD",
    ]);
  });

  it("adds the regression-only internal account only when explicitly requested", () => {
    const env = {
      NODE_ENV: "test" as const,
      DEMO_INCLUDE_INTERNAL_REGRESSION_USER: "1",
    };

    expect(shouldSeedInternalRegressionUser(env)).toBe(true);
    expect(requiredDemoEnvNames(env)).toContain("DEMO_INTERNAL_EMAIL");
    expect(requiredDemoEnvNames(env)).toContain("DEMO_INTERNAL_PASSWORD");
  });

  it("uses board-demo names instead of older QA walkthrough names", () => {
    expect(CLEAN_DEMO_SEED.operatorDisplayName).toBe("BSM Demo Admin");
    expect(CLEAN_DEMO_SEED.shopUserDisplayName).toBe("BSM Demo User");
    expect(CLEAN_DEMO_SEED.shopName).toBe("Riverside Collision");
    expect(CLEAN_DEMO_SEED.packageTier).toBe("performance");
    expect(CLEAN_DEMO_SEED.directMail).toEqual({
      segmentKey: "demo-riverside-direct-mail",
    });
    expect(CLEAN_DEMO_SEED.googleAds).toMatchObject({
      accountCustomerId: "1234567890",
      searchCampaignExternalId: "demo-riverside-search",
      pmaxCampaignExternalId: "demo-riverside-pmax",
    });
    expect(CLEAN_DEMO_SEED.gtm.containerPublicId).toBe("GTM-BSMDEMO");
    expect(CLEAN_DEMO_SEED.yext.entityId).toBe("riverside-collision-san-francisco");
    expect(CLEAN_DEMO_SEED.customerContent.title).toBe("Riverside Collision July repair tips");
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.previousShopSlug);
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.legacyShopSlug);
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.previousPilotShopSlug);
    expect(CLEAN_DEMO_SEED.shopName).not.toBe(CLEAN_DEMO_SEED.previousPilotShopName);
  });

  it("builds predictable July and August Processing Recap demo rows", () => {
    const rows = buildRiversideOperationalReportRows({
      companyId: "riverside-company",
      customerId: "demo-customer",
    });
    const summarize = (month: string) => {
      const monthRows = rows.filter((row) => row.created_at.startsWith(month));
      return {
        opened: monthRows.length,
        closed: monthRows.filter((row) => row.status === "closed").length,
        processed:
          monthRows.reduce((total, row) => total + row.repair_amount_cents, 0) / 100,
      };
    };

    expect(summarize("2026-07")).toEqual({
      opened: 3,
      closed: 2,
      processed: 8_500,
    });
    expect(summarize("2026-08")).toEqual({
      opened: 2,
      closed: 1,
      processed: 4_750,
    });
    expect(rows.every((row) => row.company_id === "riverside-company")).toBe(true);
    expect(rows.every((row) => row.payload_jsonb.demoSeed === "psg-2975-operational-reports"))
      .toBe(true);
  });

  it("builds Riverside analytics rows from production aggregate snapshots", () => {
    const aggregateRows = [
      {
        shop_id: "source-shop-1",
        source: "semrush",
        date: "2026-08-01",
        metrics: {
          organic_traffic: 100,
          organic_keywords: 40,
          organic_traffic_cost: 500,
          backlinks: 90,
          authority_score: 30,
        },
      },
      {
        shop_id: "source-shop-2",
        source: "semrush",
        date: "2026-08-02",
        metrics: {
          organic_traffic: 200,
          organic_keywords: 60,
          organic_traffic_cost: 700,
          backlinks: 110,
          authority_score: 40,
        },
      },
      {
        shop_id: "source-shop-1",
        source: "google_ads",
        date: "2026-08-01",
        metrics: { spend: 100, clicks: 20, impressions: 1000, conversions: 2, cpl: 50, cost_micros: 100_000_000 },
      },
      {
        shop_id: "source-shop-2",
        source: "google_ads",
        date: "2026-08-02",
        metrics: { spend: 200, clicks: 40, impressions: 3000, conversions: 4, cpl: 50, cost_micros: 200_000_000 },
      },
      {
        shop_id: "source-shop-1",
        source: "ga4",
        date: "2026-08-01",
        metrics: {
          sessions: 80,
          total_users: 60,
          active_users: 58,
          new_users: 20,
          engaged_sessions: 50,
          key_events: 5,
          engagement_rate: 0.7,
        },
      },
      {
        shop_id: "source-shop-1",
        source: "gsc",
        date: "2026-08-01",
        metrics: { clicks: 30, impressions: 1500, ctr: 0.02, position: 8 },
      },
      {
        shop_id: "source-shop-1",
        source: "gbp",
        date: "2026-08-01",
        metrics: {
          impressions_desktop_maps: 10,
          impressions_desktop_search: 20,
          impressions_mobile_maps: 30,
          impressions_mobile_search: 40,
          impressions_total: 100,
          website_clicks: 6,
          call_clicks: 4,
          direction_requests: 3,
          conversations: 1,
        },
      },
    ];

    const rows = buildAggregateDerivedAnalyticsRows({
      shopId: "riverside-shop",
      aggregateRows,
      dates: ["2026-08-17", "2026-08-18"],
    });

    expect(rows).toHaveLength(10);
    expect(rows.find((row) => row.source === "semrush")).toMatchObject({
      shop_id: "riverside-shop",
      date: "2026-08-17",
      period: "daily",
      metrics: {
        organic_traffic: 150,
        organic_keywords: 50,
        derived_from: "production_analytics_snapshots_aggregate",
        source_row_count: 2,
        source_shop_count: 2,
        latest_source_date: "2026-08-02",
      },
    });
    expect(deriveGoogleAdsBenchmarkMetrics(aggregateRows)).toMatchObject({
      clicks: 30,
      impressions: 2000,
      conversions: 3,
      cost_micros: 150_000_000,
      derived_from: "production_analytics_snapshots_google_ads_aggregate",
    });
  });

  it("keeps Riverside analytics seeding alive when aggregate snapshots are empty", () => {
    const rows = buildAggregateDerivedAnalyticsRows({
      shopId: "riverside-shop",
      aggregateRows: [],
      dates: ["2026-08-18"],
    });

    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.shop_id === "riverside-shop")).toBe(true);
    expect(rows.every((row) => row.metrics.empty_aggregate_fallback === true)).toBe(true);
    expect(rows.every((row) => row.metrics.source_row_count === 0)).toBe(true);
    expect(rows.every((row) => row.metrics.source_shop_count === 0)).toBe(true);
    expect(deriveGoogleAdsBenchmarkMetrics([])).toMatchObject({
      clicks: 0,
      impressions: 0,
      conversions: 0,
      cost_micros: 0,
      empty_aggregate_fallback: true,
    });
  });

  it("builds representative, non-payable invoices for the approved demo shop", () => {
    const rows = buildRiversideDemoInvoiceRows("12345678-demo-shop");

    expect(rows.map((row) => row.status)).toEqual(["open", "paid", "void"]);
    expect(rows.map((row) => row.amount_due)).toEqual([125000, 250000, 75000]);
    expect(rows.every((row) => row.shop_id === "12345678-demo-shop")).toBe(true);
    expect(rows.every((row) => row.hosted_invoice_url === null)).toBe(true);
    expect(rows.every((row) => row.invoice_pdf === null)).toBe(true);
    expect(rows.every((row) => row.raw.testOnly === true)).toBe(true);
  });

  it("builds Riverside direct-mail priors from aggregate rows instead of invented counts", () => {
    const row = buildAggregateDerivedDirectMailPrior({
      company: { id: "riverside-company" },
      aggregateRows: [
        { company_id: "company-1", n_sent: 100, n_outcome: 10 },
        { company_id: "company-2", n_sent: 300, n_outcome: 60 },
      ],
    });

    expect(row).toMatchObject({
      company_id: "riverside-company",
      shop_name: "Riverside Collision",
      segment_key: "demo-riverside-direct-mail",
      n_sent: 200,
      n_outcome: 35,
      outcome_rate: 70 / 400,
      method_ref: "seed-superadmin-qa-env:riverside-aggregate-derived",
    });
  });

  it("fails preflight before writes when a required production table is missing", async () => {
    const missingTable = "mail_send_priors";
    const client = {
      from(table: string) {
        return {
          select() {
            return {
              limit() {
                return Promise.resolve(
                  table === missingTable
                    ? { error: { message: "relation does not exist" } }
                    : { error: null }
                );
              },
            };
          },
        };
      },
    };

    await expect(assertRequiredRiversideSeedTablesExist(client)).rejects.toThrow(
      `Required production table ${missingTable} is unavailable`
    );
    expect(REQUIRED_RIVERSIDE_PRODUCTION_TABLES).toContain("survey_responses");
    expect(REQUIRED_RIVERSIDE_PRODUCTION_TABLES).toContain("repair_orders");
    expect(REQUIRED_RIVERSIDE_PRODUCTION_TABLES).toContain("invoices");
  });

  it("allows existing Riverside records that are clearly marked as .example demos", async () => {
    const client = riversideCollisionClient({
      clients: [
        {
          id: "demo-client",
          name: CLEAN_DEMO_SEED.clientName,
          website_url: "https://riversidecollision.example",
        },
      ],
      shops: [
        {
          id: "demo-shop",
          name: CLEAN_DEMO_SEED.shopName,
          slug: CLEAN_DEMO_SEED.shopSlug,
          url: "https://riversidecollision.example",
        },
      ],
    });

    await expect(assertNoRealRiversideCollision(client)).resolves.toBeUndefined();
  });

  it("stops before writing when a real client already uses the Riverside name", async () => {
    const client = riversideCollisionClient({
      clients: [
        {
          id: "real-client",
          name: CLEAN_DEMO_SEED.clientName,
          website_url: "https://riversidecollision.com",
        },
      ],
    });

    await expect(assertNoRealRiversideCollision(client)).rejects.toThrow(
      "Riverside demo seed stopped before writing: client Riverside Collision (real-client) already exists and does not look like the demo .example record."
    );
  });

  it("stops before writing when a real shop uses the Riverside name or slug", async () => {
    const client = riversideCollisionClient({
      shops: [
        {
          id: "real-shop",
          name: CLEAN_DEMO_SEED.shopName,
          slug: CLEAN_DEMO_SEED.shopSlug,
          url: "https://riversidecollision.com",
        },
      ],
    });

    await expect(assertNoRealRiversideCollision(client)).rejects.toThrow(
      "Riverside demo seed stopped before writing: shop Riverside Collision / riverside-collision (real-shop) already exists and does not look like the demo .example record."
    );
  });

  it("seeds a customer-visible Riverside content item for the dashboard content route", () => {
    const row = demoCustomerContentItemRow({
      shopId: "shop-riverside",
      locationId: "location-riverside",
    });

    expect(row).toMatchObject({
      shop_id: "shop-riverside",
      location_id: "location-riverside",
      type: "blog_post",
      title: "Riverside Collision July repair tips",
      status: "pending_review",
    });
    expect(row.body).toContain("PSG prepared this customer-facing article");
  });

  it("fails loudly when a Supabase cleanup call fails", () => {
    expect(() =>
      assertNoSupabaseError(
        { error: { message: "foreign key blocked delete" } },
        "Delete legacy demo rows"
      )
    ).toThrow("Delete legacy demo rows failed: foreign key blocked delete");
  });
});
