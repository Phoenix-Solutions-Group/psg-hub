import "server-only";
import {
  getGoogleAdsClient,
  logAdsCall,
  mapGoogleAdsError,
  markAccountAuthFailed,
  validateGaqlId,
  withAdsRateLimit,
} from "./client";
import { AdsApiError, type GoogleAdsCampaignStatus } from "./types";
import type { CampaignTemplate } from "./templates";

export type CreateCampaignInput = {
  shopId: string;
  userId: string;
  template: CampaignTemplate;
  campaignName: string;
  dailyBudgetMicros: number;
  finalUrl: string;
  geoTargeting: {
    address: string;
    city: string | null;
    state: string | null;
    radiusMiles: number;
  };
};

export type CreateCampaignResult = {
  externalId: string;
  externalResourceName: string;
  accountId: string;
};

/**
 * Minimal wrapper around google-ads-api campaign creation.
 * The actual mutate-call shape depends on library version; kept thin so
 * tests mock at this layer.
 */
export async function createCampaign(
  input: CreateCampaignInput
): Promise<CreateCampaignResult> {
  const started = Date.now();
  const { customer, account } = await getGoogleAdsClient(input.shopId);

  try {
    const result = await withAdsRateLimit(input.shopId, "MUTATE", async () => {
      // Minimal real call: create campaign budget + campaign.
      // google-ads-api v23 exposes resources under customer.campaigns/campaignBudgets.
      const budget = await customer.campaignBudgets.create([
        {
          name: `${input.campaignName} budget ${Date.now()}`,
          amount_micros: input.dailyBudgetMicros,
          delivery_method: 2, // STANDARD
        },
      ]);

      const budgetResource = (budget as unknown as {
        results: Array<{ resource_name: string }>;
      }).results?.[0]?.resource_name;

      if (!budgetResource) {
        throw new AdsApiError("upstream", "Campaign budget creation returned no resource");
      }

      const campaign = await customer.campaigns.create([
        {
          name: input.campaignName,
          status: 3, // PAUSED
          advertising_channel_type: 2, // SEARCH
          campaign_budget: budgetResource,
        },
      ]);

      const cres = (campaign as unknown as {
        results: Array<{ resource_name: string }>;
      }).results?.[0]?.resource_name;

      if (!cres) {
        throw new AdsApiError("upstream", "Campaign creation returned no resource");
      }

      return cres;
    });

    const externalResourceName = result;
    const externalId = externalResourceName.split("/").pop() ?? "";
    validateGaqlId(externalId);

    await logAdsCall({
      userId: input.userId,
      shopId: input.shopId,
      accountId: account.id,
      endpoint: "customer.campaigns.create",
      method: "MUTATE",
      resourceName: externalResourceName,
      latencyMs: Date.now() - started,
      result: "success",
    });

    return {
      externalId,
      externalResourceName,
      accountId: account.id,
    };
  } catch (err) {
    const mapped = err instanceof AdsApiError ? err : mapGoogleAdsError(err);
    await logAdsCall({
      userId: input.userId,
      shopId: input.shopId,
      accountId: account.id,
      endpoint: "customer.campaigns.create",
      method: "MUTATE",
      latencyMs: Date.now() - started,
      result: mapped.code === "rate_limited" ? "rate_limited" : "error",
      errorCode: mapped.code,
    });
    if (mapped.code === "auth_failed") {
      await markAccountAuthFailed(account.id, mapped.message);
    }
    throw mapped;
  }
}

export type UpdateCampaignInput = {
  shopId: string;
  userId: string;
  externalResourceName: string;
  status?: GoogleAdsCampaignStatus;
  dailyBudgetMicros?: number;
  budgetResourceName?: string | null;
};

export async function updateCampaign(
  input: UpdateCampaignInput
): Promise<void> {
  const started = Date.now();
  const { customer, account } = await getGoogleAdsClient(input.shopId);

  try {
    await withAdsRateLimit(input.shopId, "MUTATE", async () => {
      if (input.status) {
        const statusMap: Record<GoogleAdsCampaignStatus, number> = {
          paused: 3,
          enabled: 2,
          removed: 4,
        };
        await customer.campaigns.update([
          {
            resource_name: input.externalResourceName,
            status: statusMap[input.status],
          },
        ]);
      }
      if (
        typeof input.dailyBudgetMicros === "number" &&
        input.budgetResourceName
      ) {
        await customer.campaignBudgets.update([
          {
            resource_name: input.budgetResourceName,
            amount_micros: input.dailyBudgetMicros,
          },
        ]);
      }
    });

    await logAdsCall({
      userId: input.userId,
      shopId: input.shopId,
      accountId: account.id,
      endpoint: "customer.campaigns.update",
      method: "MUTATE",
      resourceName: input.externalResourceName,
      latencyMs: Date.now() - started,
      result: "success",
    });
  } catch (err) {
    const mapped = err instanceof AdsApiError ? err : mapGoogleAdsError(err);
    await logAdsCall({
      userId: input.userId,
      shopId: input.shopId,
      accountId: account.id,
      endpoint: "customer.campaigns.update",
      method: "MUTATE",
      resourceName: input.externalResourceName,
      latencyMs: Date.now() - started,
      result: mapped.code === "rate_limited" ? "rate_limited" : "error",
      errorCode: mapped.code,
    });
    if (mapped.code === "auth_failed") {
      await markAccountAuthFailed(account.id, mapped.message);
    }
    throw mapped;
  }
}

export type CampaignMetrics = {
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
};

export async function fetchCampaignMetrics(input: {
  shopId: string;
  userId: string;
  externalId: string;
}): Promise<CampaignMetrics> {
  validateGaqlId(input.externalId);

  const started = Date.now();
  const { customer, account } = await getGoogleAdsClient(input.shopId);

  try {
    const rows = await withAdsRateLimit(input.shopId, "SEARCH", async () => {
      return customer.query(`
        SELECT
          campaign.id,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM campaign
        WHERE campaign.id = ${input.externalId}
          AND segments.date DURING LAST_30_DAYS
      `);
    });

    const totals: CampaignMetrics = {
      impressions: 0,
      clicks: 0,
      cost_micros: 0,
      conversions: 0,
    };
    for (const r of rows as Array<{
      metrics?: {
        impressions?: number;
        clicks?: number;
        cost_micros?: number;
        conversions?: number;
      };
    }>) {
      totals.impressions += Number(r.metrics?.impressions ?? 0);
      totals.clicks += Number(r.metrics?.clicks ?? 0);
      totals.cost_micros += Number(r.metrics?.cost_micros ?? 0);
      totals.conversions += Number(r.metrics?.conversions ?? 0);
    }

    await logAdsCall({
      userId: input.userId,
      shopId: input.shopId,
      accountId: account.id,
      endpoint: "customer.query.campaign-metrics",
      method: "SEARCH",
      latencyMs: Date.now() - started,
      result: "success",
    });

    return totals;
  } catch (err) {
    const mapped = err instanceof AdsApiError ? err : mapGoogleAdsError(err);
    await logAdsCall({
      userId: input.userId,
      shopId: input.shopId,
      accountId: account.id,
      endpoint: "customer.query.campaign-metrics",
      method: "SEARCH",
      latencyMs: Date.now() - started,
      result: mapped.code === "rate_limited" ? "rate_limited" : "error",
      errorCode: mapped.code,
    });
    if (mapped.code === "auth_failed") {
      await markAccountAuthFailed(account.id, mapped.message);
    }
    throw mapped;
  }
}
