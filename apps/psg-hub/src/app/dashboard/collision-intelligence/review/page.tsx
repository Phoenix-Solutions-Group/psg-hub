import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  excludeExistingInsurerNames,
  findInsurerNameMatches,
  groupRegistryMatches,
  includeFocusedAlias,
} from "./insurer-match";
import {
  buildForecastReadinessFallback,
  forecastEvaluationReadiness,
  isForecastArrivalFresh,
  isMissingReviewView,
  type ForecastPolicyRow,
  type ForecastReadinessRow,
  type ForecastRunRow,
} from "./source-health";
import {
  approvedPoliciesWithoutCustomerAudience,
  matchesVerifiedShopLocation,
  rankShopMatches,
  shopMemberCount,
  shopIdentityEvidence,
  type ShopDirectoryEntry,
} from "./shop-match";

type Props = {
  searchParams: Promise<{
    result?: string | string[];
    registry_search?: string | string[];
    search_source?: string | string[];
    shop_search?: string | string[];
    shop_source?: string | string[];
  }>;
};

type AliasCandidate = {
  source_label_normalized: string;
  source_label_name: string;
  review_status: "candidate" | "approved" | "rejected";
  canonical_insurer_name: string | null;
  source_shop_count: number;
  repair_orders: number;
  repair_value_cents: number;
  latest_arrival_date: string | null;
};

type ApprovedInsurer = {
  canonical_insurer_key: string | null;
  canonical_insurer_name: string | null;
};

type InsuranceCompany = {
  id: string;
  name: string;
};

type InsurerOption = {
  label: string;
  value: string;
};

type RegistrySuggestion = {
  source_label: string;
  source: string;
  record_type: "group" | "company";
  registry_id: string;
  display_name: string;
  group_code: string | null;
  company_code: string | null;
  state_of_domicile: string | null;
  match_score: number;
  source_release: string;
};

function searchValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function registryTarget(suggestion: RegistrySuggestion) {
  return `registry:${suggestion.source}:${suggestion.record_type}:${suggestion.registry_id}`;
}

type ShopCandidate = {
  source_shop_key: string;
  source_shop_name: string;
  repair_orders: number;
  first_arrival_date: string | null;
  repair_orders_2026: number;
  latest_arrival_date: string | null;
  insured_repair_orders: number;
  repair_value_cents: number;
  insurer_count: number;
  customer_zip_count: number;
  quality_flagged_rows: number;
};

type RepairSourceHealth = {
  row_count: number;
  accepted_count: number;
  rejected_count: number;
  arrival_max: string | null;
};

type RepairFeedHealth = {
  is_stale: boolean;
  latest_arrival_date: string | null;
};

type StormSourceHealth = {
  event_rows: number | null;
  is_reconciled: boolean;
};

type CrashSourceHealth = {
  min_source_year: number;
  max_source_year: number;
  imported_row_count: number;
  zip_matched_row_count: number;
  last_sync_status: string;
};

type ForecastHealth = ForecastReadinessRow;

type ForecastModelPolicy = {
  shop_id: string;
  forecast_horizon_weeks: number;
  model_key: string;
  promotion_status: "review" | "approved";
  seasonal_baseline_mae: number;
  model_mae: number;
  mae_improvement_pct: number;
  holdout_start: string;
  holdout_end: string;
  interval_half_width: number;
  interval_validation_coverage_pct: number;
  evaluation_scope: string;
  evaluated_at: string;
};

type ForecastModelWeekOne = Omit<
  ForecastModelPolicy,
  "forecast_horizon_weeks"
> & {
  source_shop_key: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateTime = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const notices: Record<string, string> = {
  approved:
    "Insurer matched. Reports will now group this imported label under the selected standard name.",
  rejected:
    "Imported label left ungrouped. Reports will continue to show it separately.",
  conflict:
    "This label was reviewed by someone else. The queue has been refreshed.",
  error: "The review could not be saved. No alias decision was changed.",
  target_missing:
    "That standard insurer is no longer available. Choose another match.",
  mapping_approved:
    "Shop mapping approved. Its repair history is now available to authorized members of that PSG Hub shop.",
  mapping_conflict:
    "The source or target shop was mapped by someone else. The queue has been refreshed.",
  mapping_location_mismatch:
    "That Hub shop does not have the verified address for this imported location. No mapping was changed.",
  mapping_evidence_missing:
    "This imported location does not have governed address evidence yet. No mapping was changed.",
  mapping_error: "The shop mapping could not be saved. No mapping was changed.",
  forecast_model_approved:
    "All four forecast policies were approved. No forecast was generated or published; run the governed scorer separately after confirming source freshness.",
  forecast_model_rejected:
    "The staged forecast evidence was rejected and retired. No forecast was changed.",
  forecast_model_conflict:
    "That forecast review changed before this decision was saved. The queue has been refreshed.",
  forecast_model_gate_failed:
    "The staged evidence or shop audience no longer clears every promotion gate. No model was approved.",
  forecast_model_release_pending:
    "Forecast decisions are read-only until the reviewed database migration is applied.",
  forecast_model_error:
    "The forecast model decision could not be saved. No policy or forecast was changed.",
};

const forecastGateLabels: Record<string, string> = {
  model_not_approved: "Model approval required",
  not_generated: "Forecast not generated",
  model_mismatch: "Forecast model does not match approval",
  forecast_outdated: "Forecast is outdated",
  stale_source: "Repair arrivals are stale",
  insufficient_history: "Repair history is insufficient",
  published: "Published",
};

const forecastGateActions: Record<string, string> = {
  model_not_approved:
    "Evaluate each horizon against the seasonal baseline, review its interval coverage, then approve only the models that pass.",
  not_generated:
    "Run the governed weekly forecast after the shop mapping, source freshness, and model approvals are confirmed.",
  model_mismatch:
    "Rerun the forecast with the currently approved horizon model before publication.",
  forecast_outdated:
    "Generate the current Monday forecast; an older forecast must not drive this week's decisions.",
  stale_source:
    "Refresh and reconcile the mapped FileMaker repair feed, then rerun the weekly forecast. Publication stays paused until the latest repair arrival is 14 days old or less.",
  insufficient_history:
    "Load enough completed weekly repair history, then rerun the chronological model evaluation.",
};

export default async function CollisionDataReviewPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getDashboardAccess(user.id);
  if (access.role !== "psg_superadmin") redirect("/dashboard");

  const service = createServiceClient();
  const params = await searchParams;
  const searchSource = searchValue(params.search_source);
  const [
    aliasResult,
    focusedAliasResult,
    approvedInsurerResult,
    insuranceCompanyResult,
    shopResult,
    hubShopResult,
    customerRoleResult,
    mappedShopResult,
    repairSourceResult,
    repairFeedResult,
    stormSourceResult,
    crashSourceResult,
    forecastResult,
    modelWeekOneResult,
    modelHorizonResult,
  ] = await Promise.all([
    service
      .from("v_collision_insurer_alias_review_queue")
      .select(
        "source_label_normalized,source_label_name,review_status,canonical_insurer_name,source_shop_count,repair_orders,repair_value_cents,latest_arrival_date",
        { count: "exact" },
      )
      .eq("review_status", "candidate")
      .order("repair_orders", { ascending: false })
      .limit(20),
    searchSource
      ? service
          .from("v_collision_insurer_alias_review_queue")
          .select(
            "source_label_normalized,source_label_name,review_status,canonical_insurer_name,source_shop_count,repair_orders,repair_value_cents,latest_arrival_date",
          )
          .eq("source_label_normalized", searchSource)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service
      .from("collision_insurer_alias_reviews")
      .select("canonical_insurer_key,canonical_insurer_name")
      .eq("review_status", "approved")
      .order("canonical_insurer_name", { ascending: true }),
    service.from("insurance_companies").select("id,name").order("name"),
    service
      .from("v_collision_filemaker_shop_summary")
      .select(
        "source_shop_key,source_shop_name,repair_orders,first_arrival_date,repair_orders_2026,latest_arrival_date,insured_repair_orders,repair_value_cents,insurer_count,customer_zip_count,quality_flagged_rows",
      )
      .is("shop_id", null)
      .order("repair_orders_2026", { ascending: false })
      .order("latest_arrival_date", { ascending: false })
      .order("repair_orders", { ascending: false }),
    service
      .from("shops")
      .select(
        "id,name,slug,address_street,address_locality,address_region,address_postal_code,client:clients(name),members:shop_users(user_id)",
      )
      .order("name", { ascending: true }),
    service.from("app_user_roles").select("profile_id").eq("role", "customer"),
    service
      .from("collision_shop_mappings")
      .select("shop_id")
      .eq("mapping_status", "mapped"),
    service
      .from("collision_repair_sources")
      .select("row_count,accepted_count,rejected_count,arrival_max")
      .eq("status", "loaded")
      .order("imported_at", { ascending: false })
      .limit(1),
    service
      .from("v_collision_repair_feed_status")
      .select("is_stale,latest_arrival_date"),
    service
      .from("v_collision_storm_source_reconciliation")
      .select("event_rows,is_reconciled"),
    service
      .from("ksdot_crash_sources")
      .select(
        "min_source_year,max_source_year,imported_row_count,zip_matched_row_count,last_sync_status",
      )
      .order("imported_at", { ascending: false })
      .limit(1),
    service
      .from("v_collision_forecast_readiness")
      .select(
        "shop_id,forecast_horizon_weeks,approved_model_key,forecast_model_key,forecast_origin_week,forecast_week,source_latest_arrival_date,source_age_days,forecast_status,is_ready,readiness_status,generated_at",
      )
      .order("generated_at", { ascending: false, nullsFirst: false }),
    service
      .from("collision_forecast_model_registry")
      .select(
        "shop_id,source_shop_key,model_key,promotion_status,seasonal_baseline_mae,model_mae,mae_improvement_pct,holdout_start,holdout_end,interval_half_width,interval_validation_coverage_pct,evaluation_scope,evaluated_at",
      )
      .in("promotion_status", ["review", "approved"])
      .order("evaluated_at", { ascending: false }),
    service
      .from("collision_forecast_horizon_registry")
      .select(
        "shop_id,forecast_horizon_weeks,model_key,promotion_status,seasonal_baseline_mae,model_mae,mae_improvement_pct,holdout_start,holdout_end,interval_half_width,interval_validation_coverage_pct,evaluation_scope,evaluated_at",
      )
      .eq("promotion_status", "review")
      .order("forecast_horizon_weeks", { ascending: true }),
  ]);

  const stormHealthUnavailable = isMissingReviewView(
    stormSourceResult.error,
    "v_collision_storm_source_reconciliation",
  );
  const forecastHealthUnavailable = isMissingReviewView(
    forecastResult.error,
    "v_collision_forecast_readiness",
  );

  if (
    aliasResult.error ||
    focusedAliasResult.error ||
    approvedInsurerResult.error ||
    insuranceCompanyResult.error ||
    shopResult.error ||
    hubShopResult.error ||
    customerRoleResult.error ||
    mappedShopResult.error ||
    repairSourceResult.error ||
    repairFeedResult.error ||
    (stormSourceResult.error && !stormHealthUnavailable) ||
    crashSourceResult.error ||
    (forecastResult.error && !forecastHealthUnavailable) ||
    modelWeekOneResult.error ||
    modelHorizonResult.error
  ) {
    throw new Error(
      aliasResult.error?.message ??
        focusedAliasResult.error?.message ??
        approvedInsurerResult.error?.message ??
        insuranceCompanyResult.error?.message ??
        shopResult.error?.message ??
        hubShopResult.error?.message ??
        customerRoleResult.error?.message ??
        mappedShopResult.error?.message ??
        repairSourceResult.error?.message ??
        repairFeedResult.error?.message ??
        stormSourceResult.error?.message ??
        crashSourceResult.error?.message ??
        forecastResult.error?.message ??
        modelWeekOneResult.error?.message ??
        modelHorizonResult.error?.message ??
        "Review queue failed",
    );
  }

  let forecastRows = (forecastResult.data ?? []).map((row) => ({
    ...row,
    status_reason: null,
  })) as ForecastHealth[];

  if (forecastHealthUnavailable) {
    const mappedShopIds = (mappedShopResult.data ?? []).map(
      (row) => row.shop_id as string,
    );

    if (mappedShopIds.length) {
      // ponytail: temporary 500-row fallback while the readiness view release is pending.
      const [weekOnePolicies, horizonPolicies, forecastRuns] =
        await Promise.all([
          service
            .from("collision_forecast_model_registry")
            .select("shop_id,model_key,promotion_status")
            .in("shop_id", mappedShopIds),
          service
            .from("collision_forecast_horizon_registry")
            .select("shop_id,forecast_horizon_weeks,model_key,promotion_status")
            .in("shop_id", mappedShopIds),
          service
            .from("collision_demand_forecasts")
            .select(
              "shop_id,forecast_horizon_weeks,model_key,forecast_origin_week,forecast_week,source_latest_arrival_date,source_age_days,status,status_reason,generated_at",
            )
            .in("shop_id", mappedShopIds)
            .order("forecast_origin_week", { ascending: false })
            .order("generated_at", { ascending: false })
            .limit(500),
        ]);
      const fallbackError =
        weekOnePolicies.error ?? horizonPolicies.error ?? forecastRuns.error;

      if (fallbackError)
        throw new Error(
          `Forecast readiness fallback failed: ${fallbackError.message}`,
        );

      forecastRows = buildForecastReadinessFallback(
        mappedShopIds,
        (weekOnePolicies.data ?? []) as ForecastPolicyRow[],
        (horizonPolicies.data ?? []) as ForecastPolicyRow[],
        (forecastRuns.data ?? []) as ForecastRunRow[],
      );
    }
  }

  const rankedAliases = (aliasResult.data ?? []) as AliasCandidate[];
  const focusedAlias = (focusedAliasResult.data ??
    null) as AliasCandidate | null;
  const aliases = rankedAliases;
  const reviewAliases = includeFocusedAlias(rankedAliases, focusedAlias);
  const requestedSearchAlias = reviewAliases.find(
    (alias) => alias.source_label_normalized === searchSource,
  );
  const registrySearch = requestedSearchAlias
    ? searchValue(params.registry_search).slice(0, 80)
    : "";
  const registryResult = reviewAliases.length
    ? await service.rpc("collision_insurer_registry_matches", {
        source_labels: reviewAliases.map((alias) => alias.source_label_name),
        match_limit: 3,
      })
    : { data: [], error: null };
  const registryUnavailable =
    registryResult.error?.code === "PGRST202" &&
    registryResult.error.message?.includes(
      "collision_insurer_registry_matches",
    );
  if (registryResult.error && !registryUnavailable) {
    throw new Error(registryResult.error.message);
  }
  const directorySearchResult = registrySearch
    ? await service.rpc("collision_insurer_registry_matches", {
        source_labels: [registrySearch],
        match_limit: 5,
      })
    : { data: [], error: null };
  const directorySearchUnavailable = Boolean(directorySearchResult.error);
  if (directorySearchResult.error) {
    console.error(
      "[collision-data-review] insurer directory search failed:",
      directorySearchResult.error.message,
    );
  }
  const directorySearchSuggestions = (directorySearchResult.data ??
    []) as RegistrySuggestion[];
  const registrySuggestionsByLabel = new Map<string, RegistrySuggestion[]>();
  for (const suggestion of (registryResult.data ??
    []) as RegistrySuggestion[]) {
    const suggestions =
      registrySuggestionsByLabel.get(suggestion.source_label) ?? [];
    suggestions.push(suggestion);
    registrySuggestionsByLabel.set(suggestion.source_label, suggestions);
  }
  const insurerOptionsByName = new Map<string, InsurerOption>();
  for (const insurer of (insuranceCompanyResult.data ??
    []) as InsuranceCompany[]) {
    insurerOptionsByName.set(insurer.name.trim().toLocaleLowerCase(), {
      label: insurer.name.trim(),
      value: `master:${insurer.id}`,
    });
  }
  for (const insurer of (approvedInsurerResult.data ??
    []) as ApprovedInsurer[]) {
    const key = insurer.canonical_insurer_key?.trim();
    const name = insurer.canonical_insurer_name?.trim();
    if (!key || !name) continue;
    const normalizedName = name.toLocaleLowerCase();
    if (!insurerOptionsByName.has(normalizedName)) {
      insurerOptionsByName.set(normalizedName, {
        label: name,
        value: `approved:${key}`,
      });
    }
  }
  const insurerOptions = [...insurerOptionsByName.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const masterInsurerOptions = insurerOptions.filter(({ value }) =>
    value.startsWith("master:"),
  );
  const approvedInsurerOptions = insurerOptions.filter(({ value }) =>
    value.startsWith("approved:"),
  );
  const aliasReviewItems = reviewAliases.map((alias) => {
    const automaticSuggestions =
      registrySuggestionsByLabel.get(alias.source_label_name) ?? [];
    const isSearchedAlias =
      alias.source_label_normalized ===
      requestedSearchAlias?.source_label_normalized;
    const matchQuery =
      isSearchedAlias && registrySearch
        ? registrySearch
        : alias.source_label_name;
    const current = alias.canonical_insurer_name
      ? (insurerOptionsByName.get(
          alias.canonical_insurer_name.trim().toLocaleLowerCase(),
        ) ?? null)
      : null;
    const master = findInsurerNameMatches(
      masterInsurerOptions,
      matchQuery,
    ).filter((option) => option.value !== current?.value);
    const approved = findInsurerNameMatches(
      approvedInsurerOptions,
      matchQuery,
    ).filter((option) => option.value !== current?.value);
    const currentMatches = Boolean(
      current && findInsurerNameMatches([current], matchQuery).length,
    );
    const registrySuggestions = excludeExistingInsurerNames(
      isSearchedAlias ? directorySearchSuggestions : automaticSuggestions,
      [...(current ? [current] : []), ...master, ...approved],
    );
    const { strong, possible } = groupRegistryMatches(registrySuggestions);
    return {
      alias,
      strong,
      possible,
      matches: {
        count:
          strong.length +
          possible.length +
          master.length +
          approved.length +
          Number(currentMatches),
        current,
        currentMatches,
        master,
        approved,
      },
    };
  });
  const activeAliasReviewItem = searchSource
    ? aliasReviewItems.find(
        ({ alias }) => alias.source_label_normalized === searchSource,
      )
    : aliasReviewItems[0];
  const shownAliasItems = activeAliasReviewItem ? [activeAliasReviewItem] : [];
  const aliasReviewCount = aliasResult.count ?? rankedAliases.length;
  const shops = (shopResult.data ?? []) as ShopCandidate[];
  const featuredShops = shops.slice(0, 8).map((shop) => ({
    ...shop,
    hasFreshArrivals: isForecastArrivalFresh(shop.latest_arrival_date),
  }));
  const mappedShopIds = new Set(
    (mappedShopResult.data ?? []).map((row) => row.shop_id as string),
  );
  const hubShops = (hubShopResult.data ??
    []) as unknown as ShopDirectoryEntry[];
  const customerProfileIds = new Set(
    (customerRoleResult.data ?? []).map((row) => row.profile_id as string),
  );
  const availableHubShops = hubShops.filter(
    (shop) => !mappedShopIds.has(shop.id),
  );
  const modelHorizonReviews = (modelHorizonResult.data ??
    []) as ForecastModelPolicy[];
  const modelWeekOnePolicies = (modelWeekOneResult.data ??
    []) as ForecastModelWeekOne[];
  const approvedAudienceGaps = approvedPoliciesWithoutCustomerAudience(
    modelWeekOnePolicies,
    hubShops,
    customerProfileIds,
  ).map((policy) => {
    const shop = hubShops.find((candidate) => candidate.id === policy.shop_id);

    return {
      shopId: policy.shop_id,
      shopName: shop?.name ?? shop?.slug ?? policy.shop_id,
      sourceShopKey: policy.source_shop_key,
      modelKey: policy.model_key,
      memberCount: shop ? shopMemberCount(shop, customerProfileIds) : 0,
    };
  });
  const modelReviews = modelWeekOnePolicies
    .filter((policy) => policy.promotion_status === "review")
    .map((weekOne) => {
      const policies = [
        { ...weekOne, forecast_horizon_weeks: 1 },
        ...modelHorizonReviews.filter(
          (policy) => policy.shop_id === weekOne.shop_id,
        ),
      ].sort((a, b) => a.forecast_horizon_weeks - b.forecast_horizon_weeks);
      const shop = hubShops.find(
        (candidate) => candidate.id === weekOne.shop_id,
      );
      const memberCount = shop ? shopMemberCount(shop, customerProfileIds) : 0;

      return {
        shopId: weekOne.shop_id,
        shopName: shop?.name ?? shop?.slug ?? weekOne.shop_id,
        sourceShopKey: weekOne.source_shop_key,
        memberCount,
        audienceReady: memberCount > 0,
        policies,
        complete:
          policies.length === 4 &&
          policies.every(
            (policy, index) => policy.forecast_horizon_weeks === index + 1,
          ),
      };
    });
  const requestedShopKey = searchValue(params.shop_source).toUpperCase();
  const selectedShop =
    shops.find((shop) => shop.source_shop_key === requestedShopKey) ??
    featuredShops[0] ??
    null;
  const selectedShopEvidence = selectedShop
    ? shopIdentityEvidence[selectedShop.source_shop_key]
    : null;
  const selectedForecastReadiness = selectedShop
    ? forecastEvaluationReadiness(
        selectedShop.first_arrival_date,
        selectedShop.latest_arrival_date,
      )
    : null;
  const selectedInsuredShare =
    selectedShop && selectedShop.repair_orders
      ? (selectedShop.insured_repair_orders / selectedShop.repair_orders) * 100
      : 0;
  const shopSearch = selectedShop
    ? searchValue(params.shop_search).slice(0, 80)
    : "";
  const shopMatches = selectedShop
    ? rankShopMatches(
        selectedShop.source_shop_name,
        availableHubShops,
        shopSearch,
      ).map((match) => ({
        ...match,
        locationVerified: matchesVerifiedShopLocation(
          selectedShop.source_shop_key,
          match.shop,
        ),
      }))
    : [];
  const selectableShopMatches = shopMatches.filter(
    (match) => match.locationVerified,
  );
  const repairSource = (repairSourceResult.data?.[0] ??
    null) as RepairSourceHealth | null;
  const repairFeeds = (repairFeedResult.data ?? []) as RepairFeedHealth[];
  const stormSources = (stormSourceResult.data ?? []) as StormSourceHealth[];
  const crashSource = (crashSourceResult.data?.[0] ??
    null) as CrashSourceHealth | null;
  const forecasts = forecastRows;
  const staleRepairFeeds = repairFeeds.filter((feed) => feed.is_stale).length;
  const staleShopArrivals = repairFeeds.filter(
    (feed) => !isForecastArrivalFresh(feed.latest_arrival_date),
  ).length;
  const unreconciledStormSources = stormSources.filter(
    (source) => !source.is_reconciled,
  ).length;
  const stormEvents = stormSources.reduce(
    (total, source) => total + (source.event_rows ?? 0),
    0,
  );
  const readyForecasts = forecasts.filter(
    (forecast) => forecast.is_ready,
  ).length;
  const forecastsReady = Boolean(
    forecasts.length && readyForecasts === forecasts.length,
  );
  const forecastGateStates = [
    ...new Set(
      forecasts
        .filter((forecast) => !forecast.is_ready)
        .map(
          (forecast) =>
            forecastGateLabels[forecast.readiness_status] ??
            forecast.readiness_status.replaceAll("_", " "),
        ),
    ),
  ].join(", ");
  const latestForecast = forecasts.find((forecast) => forecast.generated_at);
  const blockingForecast = forecasts.find((forecast) => !forecast.is_ready);
  const approvedForecastPolicies = forecasts.filter(
    (forecast) => forecast.approved_model_key,
  ).length;
  const mappedSourceShopCount = mappedShopIds.size;
  const totalSourceShopCount = mappedSourceShopCount + shops.length;
  const forecastNextAction = forecastsReady
    ? "All mapped shop horizons have a current published forecast. Continue monitoring actual arrivals and interval coverage."
    : (forecastGateActions[blockingForecast?.readiness_status ?? ""] ??
      "Map an exact Hub shop before evaluating and publishing its forecasts.");
  const crashZipMatchPct =
    crashSource && crashSource.imported_row_count
      ? (crashSource.zip_matched_row_count / crashSource.imported_row_count) *
        100
      : null;
  const result = searchValue(params.result);
  const notice = result ? notices[result] : null;

  return (
    <div className="space-y-6">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight">
          Match imported collision data
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Review one imported value at a time before it is used in PSG Hub
          reports. Match insurer names, connect shops, and review forecast
          evidence. Nothing changes until you confirm it, and every saved
          decision is audited.
        </p>
        <div className="mt-4 rounded-lg bg-secondary/50 p-4 text-sm leading-6">
          <p className="font-heading font-semibold">What changes here</p>
          <p className="mt-1 text-muted-foreground">
            Insurer matches change how carrier-tagged repair orders are grouped
            in reports. Shop matches change which authorized users can see the
            imported repair history. These are repair records—not insurer claim
            counts.
          </p>
        </div>
        <nav
          aria-label="Data review sections"
          className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-y border-border py-3 text-sm"
        >
          <Link
            href="#alias-review-heading"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Insurer names · {aliasReviewCount} pending
          </Link>
          <Link
            href="#shop-review-heading"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Shop connections · {shops.length} pending
          </Link>
          <Link
            href="#forecast-model-review"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Forecast models · {modelReviews.length} pending
          </Link>
          <Link
            href="#source-health-heading"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Data feed status
          </Link>
        </nav>
      </div>

      {notice ? (
        <div
          role="status"
          className="rounded-md border border-border bg-secondary/40 p-3 text-sm"
        >
          {notice}
        </div>
      ) : null}

      <section aria-labelledby="source-health-heading" className="space-y-3">
        <div>
          <h2 id="source-health-heading" className="text-lg font-semibold">
            Data feed status
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only checks showing whether repair, crash, weather, and
            forecast data are current and traceable.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SourceHealthCard
            title="Repair source"
            status={
              !repairSource
                ? "Not loaded"
                : !repairFeeds.length
                  ? "No mapped feed"
                  : staleRepairFeeds
                    ? "Source stale"
                    : staleShopArrivals
                      ? "Shop arrivals stale"
                      : "Current"
            }
            healthy={Boolean(
              repairSource &&
              repairFeeds.length &&
              !staleRepairFeeds &&
              !staleShopArrivals,
            )}
          >
            <ReviewMetric
              label="Accepted / source rows"
              value={
                repairSource
                  ? `${repairSource.accepted_count.toLocaleString()} / ${repairSource.row_count.toLocaleString()}`
                  : "—"
              }
            />
            <ReviewMetric
              label="Rejected"
              value={repairSource?.rejected_count.toLocaleString() ?? "—"}
            />
            <ReviewMetric
              label="Latest source arrival"
              value={repairSource?.arrival_max ?? "—"}
            />
            <ReviewMetric
              label="Forecast-current mapped shops"
              value={
                repairFeeds.length
                  ? `${repairFeeds.length - staleShopArrivals} / ${repairFeeds.length}`
                  : "—"
              }
            />
          </SourceHealthCard>

          <SourceHealthCard
            title="Storm provenance"
            status={
              stormHealthUnavailable
                ? "Release pending"
                : !stormSources.length
                  ? "No batches"
                  : unreconciledStormSources
                    ? "Unreconciled"
                    : "Reconciled"
            }
            healthy={Boolean(stormSources.length && !unreconciledStormSources)}
          >
            <ReviewMetric
              label="Event rows"
              value={
                stormHealthUnavailable ? "—" : stormEvents.toLocaleString()
              }
            />
            <ReviewMetric
              label="Source batches"
              value={
                stormHealthUnavailable
                  ? "—"
                  : stormSources.length.toLocaleString()
              }
            />
            <ReviewMetric
              label="Unreconciled"
              value={
                stormHealthUnavailable
                  ? "—"
                  : unreconciledStormSources.toLocaleString()
              }
            />
          </SourceHealthCard>

          <SourceHealthCard
            title="KDOT crashes"
            status={crashSource?.last_sync_status ?? "Not loaded"}
            healthy={crashSource?.last_sync_status === "loaded"}
          >
            <ReviewMetric
              label="Imported rows"
              value={crashSource?.imported_row_count.toLocaleString() ?? "—"}
            />
            <ReviewMetric
              label="ZIP matched"
              value={
                crashZipMatchPct === null
                  ? "—"
                  : `${crashZipMatchPct.toFixed(2)}%`
              }
            />
            <ReviewMetric
              label="Coverage"
              value={
                crashSource
                  ? `${crashSource.min_source_year}–${crashSource.max_source_year}`
                  : "—"
              }
            />
          </SourceHealthCard>

          <SourceHealthCard
            title="Forecast readiness"
            status={
              !forecasts.length
                ? "No mapped shops"
                : forecastsReady
                  ? "Ready"
                  : "Gated"
            }
            healthy={forecastsReady}
          >
            <ReviewMetric
              label="Shop / horizon policies"
              value={forecasts.length.toLocaleString()}
            />
            <ReviewMetric
              label="Ready"
              value={readyForecasts.toLocaleString()}
            />
            <ReviewMetric
              label="Gate states"
              value={forecastGateStates || "None"}
            />
            <ReviewMetric
              label="Last generated"
              value={
                latestForecast?.generated_at
                  ? dateTime.format(new Date(latestForecast.generated_at))
                  : "—"
              }
            />
          </SourceHealthCard>
        </div>

        <div
          role="note"
          className={
            forecastsReady
              ? "rounded-lg border border-success/40 bg-success/10 p-4"
              : "rounded-lg border border-warning/50 bg-warning/10 p-4"
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-heading font-semibold">
                Forecast publishing gate
              </h3>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-foreground/75">
                {forecastNextAction}
              </p>
            </div>
            <Badge variant={forecastsReady ? "success" : "warning"}>
              {forecastsReady ? "Publication ready" : "Publication blocked"}
            </Badge>
          </div>
          <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <ReviewMetric
              label="Mapped FileMaker shops"
              value={`${mappedSourceShopCount} / ${totalSourceShopCount}`}
            />
            <ReviewMetric
              label="Approved horizon models"
              value={`${approvedForecastPolicies} / ${forecasts.length || 4 * mappedSourceShopCount}`}
            />
            <ReviewMetric
              label="Current published forecasts"
              value={`${readyForecasts} / ${forecasts.length || 4 * mappedSourceShopCount}`}
            />
            <ReviewMetric
              label="Blocking source arrival"
              value={
                blockingForecast?.source_latest_arrival_date
                  ? `${blockingForecast.source_latest_arrival_date} · ${blockingForecast.source_age_days ?? "?"} days old`
                  : "—"
              }
            />
          </div>
          {blockingForecast?.status_reason ? (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              System reason: {blockingForecast.status_reason}
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {forecastHealthUnavailable
              ? "Readiness is computed from the live mapping, model-registry, and forecast tables while the consolidated readiness view awaits release."
              : "Readiness comes from the governed consolidated forecast view."}{" "}
            Mapping another shop remains a separately audited identity decision;
            never connect locations from name similarity alone.
          </p>
        </div>
      </section>

      <section
        id="forecast-model-review"
        aria-labelledby="forecast-model-review-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="forecast-model-review-heading"
              className="text-lg font-semibold"
            >
              Review forecast models
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Decide only after all four weekly horizons beat the shop&apos;s
              52-week seasonal MAE and clear the held-out interval-coverage
              gate. Approval registers model policy; it does not score or
              publish a forecast.
            </p>
          </div>
          <Badge variant={modelReviews.length ? "warning" : "secondary"}>
            {modelReviews.length} pending
          </Badge>
        </div>

        {approvedAudienceGaps.length ? (
          <aside
            aria-labelledby="approved-forecast-audience-heading"
            className="space-y-3 rounded-lg border border-warning/50 bg-warning/10 p-4"
          >
            <div>
              <h3
                id="approved-forecast-audience-heading"
                className="font-heading font-semibold"
              >
                {approvedAudienceGaps.length === 1
                  ? "Approved forecast policy has no customer audience"
                  : `${approvedAudienceGaps.length} approved forecast policies have no customer audience`}
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6">
                {approvedAudienceGaps.length === 1
                  ? "This policy was approved before customer-audience enforcement. Keep forecast publication paused until the shop has at least one global customer-role user. PSG staff access does not count."
                  : "These policies were approved before customer-audience enforcement. Keep forecast publication paused until each shop has at least one global customer-role user. PSG staff access does not count."}
              </p>
            </div>
            <ul className="space-y-2">
              {approvedAudienceGaps.map((policy) => (
                <li
                  key={policy.shopId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background/70 px-3 py-2 text-sm"
                >
                  <span>
                    <strong>{policy.shopName}</strong>
                    <span className="ml-2 text-muted-foreground">
                      {policy.modelKey.replaceAll("_", " ")} · FileMaker source{" "}
                      {policy.sourceShopKey}
                    </span>
                  </span>
                  <Link
                    href={`/ops/admin/users?shop_id=${encodeURIComponent(policy.shopId)}`}
                    className="font-medium underline underline-offset-2"
                  >
                    Manage shop members
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        {modelReviews.length ? (
          <div className="space-y-4">
            {modelReviews.map((review) => (
              <Card key={review.shopId}>
                <CardHeader className="border-b border-border pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{review.shopName}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        FileMaker source {review.sourceShopKey} · staged for
                        manual review
                      </p>
                    </div>
                    <Badge
                      variant={
                        review.complete && review.audienceReady
                          ? "warning"
                          : "destructive"
                      }
                    >
                      {!review.complete
                        ? "Evidence incomplete"
                        : review.audienceReady
                          ? "4 horizons ready"
                          : "Shop audience missing"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-6">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {review.policies.map((policy) => (
                      <div
                        key={policy.forecast_horizon_weeks}
                        className="rounded-lg border border-border p-4"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Forecast week {policy.forecast_horizon_weeks}
                        </p>
                        <p className="mt-1 font-heading font-semibold capitalize">
                          {policy.model_key.replaceAll("_", " ")}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          MAE {policy.model_mae.toFixed(2)} vs seasonal{" "}
                          {policy.seasonal_baseline_mae.toFixed(2)} ·{" "}
                          {policy.mae_improvement_pct.toFixed(1)}% lower
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          80% range ±{policy.interval_half_width.toFixed(0)}
                          repairs ·{" "}
                          {policy.interval_validation_coverage_pct.toFixed(1)}%
                          held-out coverage
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Holdout {policy.holdout_start}–{policy.holdout_end}
                        </p>
                      </div>
                    ))}
                  </div>

                  <details className="rounded-md border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
                    <summary className="cursor-pointer font-heading font-semibold text-foreground">
                      Evaluation scope
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {review.policies.map((policy) => (
                        <li key={policy.forecast_horizon_weeks}>
                          Week {policy.forecast_horizon_weeks}:{" "}
                          {policy.evaluation_scope}
                        </li>
                      ))}
                    </ul>
                  </details>

                  {!review.audienceReady ? (
                    <p
                      role="status"
                      className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm leading-6"
                    >
                      This shop has {review.memberCount} customer members.
                      Assign at least one intended customer user before
                      approving its forecast policy. You may still reject the
                      staged evidence.{" "}
                      <Link
                        href={`/ops/admin/users?shop_id=${encodeURIComponent(review.shopId)}`}
                        className="font-medium underline underline-offset-2"
                      >
                        Manage {review.shopName} members
                      </Link>
                      .
                    </p>
                  ) : null}

                  {review.complete ? (
                    <form
                      action="/api/collision-intelligence/forecast-model-review"
                      method="post"
                      className="space-y-4 rounded-lg border border-border p-4"
                    >
                      <input
                        type="hidden"
                        name="shop_id"
                        value={review.shopId}
                      />
                      <label className="block text-sm font-medium">
                        Review notes
                        <textarea
                          name="review_notes"
                          required
                          minLength={20}
                          maxLength={1000}
                          rows={3}
                          placeholder="Record the evidence reviewed and why these four policies should be approved or rejected."
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                        />
                      </label>
                      <label className="flex items-start gap-2 text-sm leading-6">
                        <input
                          type="checkbox"
                          name="evidence_confirmed"
                          value="confirmed"
                          required
                          className="mt-1"
                        />
                        <span>
                          I reviewed all four horizons and verified the seasonal
                          MAE improvement, holdout window, and at least 80%
                          held-out interval coverage.
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                        <button
                          type="submit"
                          name="decision"
                          value="approve"
                          disabled={!review.audienceReady}
                          className="rounded-md bg-primary px-4 py-2 font-heading text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Approve four models
                        </button>
                        <button
                          type="submit"
                          name="decision"
                          value="reject"
                          className="rounded-md border border-destructive/40 px-4 py-2 font-heading text-sm font-medium text-destructive"
                        >
                          Reject staged evidence
                        </button>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Both decisions are atomic and audited. Approval still
                        requires a separate current forecast run; stale repair
                        arrivals remain blocked.
                      </p>
                    </form>
                  ) : (
                    <p
                      role="status"
                      className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
                    >
                      Restage one complete set of weeks 1–4 before making a
                      decision. No partial approval is allowed.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No four-horizon model evidence is waiting for review. Mapping,
              evaluation, and staging remain separate audited steps.
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="alias-review-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="alias-review-heading" className="text-lg font-semibold">
              Match insurer names
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Review one FileMaker name at a time. Search first, compare the
              results, then save one reporting name. Existing PSG names appear
              before official NAIC legal records, and nothing is saved
              automatically.
            </p>
          </div>
          <Badge variant="warning">
            {aliasReviewCount} {aliasReviewCount === 1 ? "name" : "names"} need
            review
          </Badge>
        </div>

        {registryUnavailable ? (
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-5 text-muted-foreground">
            Official registry suggestions are temporarily unavailable. Existing
            PSG names remain available.
          </p>
        ) : null}

        {!masterInsurerOptions.length ? (
          <div
            role="note"
            className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm leading-6"
          >
            <p className="font-heading font-semibold">
              The PSG insurer master list is empty
            </p>
            <p className="mt-1 text-foreground/75">
              Searches can still return names approved in earlier reviews and
              official NAIC legal entities. Common reporting names such as “USAA
              Insurance Company” will not appear until PSG adds and verifies
              them in the{" "}
              <Link
                href="/ops/sys-config/insurance-companies"
                className="font-medium text-primary underline underline-offset-4"
              >
                insurer master list
              </Link>
              .
            </p>
          </div>
        ) : null}

        {aliasReviewCount ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            {searchSource && !activeAliasReviewItem ? (
              <div
                role="status"
                className="rounded-md border border-border bg-secondary/40 p-3 text-sm leading-6"
              >
                {focusedAlias?.review_status === "approved"
                  ? `“${focusedAlias.source_label_name}” is already grouped under “${focusedAlias.canonical_insurer_name}”. Choose another name from the queue.`
                  : focusedAlias?.review_status === "rejected"
                    ? `“${focusedAlias.source_label_name}” was reviewed and left ungrouped. Choose another name from the queue.`
                    : "That imported name is not in the current review queue. Choose another name below."}
              </div>
            ) : null}
            {shownAliasItems.map(({ alias, strong, possible, matches }) => (
              <Card
                key={alias.source_label_normalized}
                id={`insurer-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                className="border-primary"
              >
                <CardHeader className="border-b border-border pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CardTitle className="text-lg">
                      Imported name: {alias.source_label_name}
                    </CardTitle>
                    <Badge
                      variant={
                        alias.review_status === "approved"
                          ? "success"
                          : alias.review_status === "candidate"
                            ? "warning"
                            : "outline"
                      }
                    >
                      {alias.review_status === "approved"
                        ? "Saved match"
                        : alias.review_status === "candidate"
                          ? "Needs review"
                          : "Left ungrouped"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    FileMaker sent this exact value. Your saved choice only
                    controls how it appears in PSG reports; the imported source
                    stays unchanged.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {alias.review_status === "rejected" ? (
                    <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm">
                      This label is currently kept separate in reports.
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <ReviewMetric
                      label="Repair orders"
                      value={alias.repair_orders.toLocaleString()}
                    />
                    <ReviewMetric
                      label="Repair value"
                      value={currency.format(alias.repair_value_cents / 100)}
                    />
                    <ReviewMetric
                      label="Source shops"
                      value={alias.source_shop_count.toLocaleString()}
                    />
                    <ReviewMetric
                      label="Latest arrival"
                      value={alias.latest_arrival_date ?? "Unknown"}
                    />
                  </div>

                  <form
                    action={`/dashboard/collision-intelligence/review#insurer-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                    method="get"
                    className="rounded-lg border border-border bg-secondary/40 p-4"
                  >
                    <input
                      type="hidden"
                      name="search_source"
                      value={alias.source_label_normalized}
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={`registry-search-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                        className="block font-heading text-sm font-semibold"
                      >
                        Search PSG names and NAIC records
                      </label>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        Enter the common name, brand, or abbreviation you
                        expect. Spaces and punctuation are ignored, so “U S A A”
                        can find “USAA.”
                      </p>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input
                          id={`registry-search-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                          type="search"
                          name="registry_search"
                          required
                          maxLength={80}
                          defaultValue={
                            alias.source_label_normalized === searchSource
                              ? registrySearch || alias.source_label_name
                              : alias.source_label_name
                          }
                          placeholder="Company name or abbreviation"
                          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <button
                          type="submit"
                          className="min-h-10 rounded-md bg-primary px-4 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          Find matches
                        </button>
                      </div>
                      {alias.source_label_normalized === searchSource &&
                      registrySearch ? (
                        <p
                          role="status"
                          className="mt-3 rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted-foreground"
                        >
                          {directorySearchUnavailable
                            ? "The official NAIC directory is unavailable. You can still choose a PSG reporting name below or keep the source label separate."
                            : matches.count
                              ? `Search complete for “${registrySearch}”: ${matches.master.length + matches.approved.length + Number(matches.currentMatches)} PSG reporting ${matches.master.length + matches.approved.length + Number(matches.currentMatches) === 1 ? "name" : "names"} and ${strong.length + possible.length} official NAIC ${strong.length + possible.length === 1 ? "record" : "records"}. Choose one below.`
                              : `No matches found for “${registrySearch}”. Try the full legal name, search a shorter term, or keep the source label separate.`}
                        </p>
                      ) : null}
                    </div>
                  </form>

                  <form
                    action="/api/collision-intelligence/insurer-alias-review"
                    method="post"
                    className="space-y-3"
                  >
                    <input
                      type="hidden"
                      name="source_label_normalized"
                      value={alias.source_label_normalized}
                    />
                    <input
                      type="hidden"
                      name="expected_status"
                      value={alias.review_status}
                    />
                    <fieldset
                      aria-describedby={`insurer-match-help-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                      className="space-y-3"
                    >
                      <legend className="font-heading text-sm font-semibold">
                        Choose what PSG reports should show
                      </legend>
                      <p
                        id={`insurer-match-help-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                        className="text-xs leading-5 text-muted-foreground"
                      >
                        Prefer an existing PSG reporting name when it represents
                        the same insurer. NAIC results are licensed legal
                        entities; choose one only when that exact company
                        appears on the repair order.
                      </p>
                      {matches.current ? (
                        <div className="space-y-2">
                          <div>
                            <p className="font-heading text-sm font-semibold">
                              Current saved choice
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              This is selected now. Search results below are
                              alternatives.
                            </p>
                          </div>
                          <InsurerMatchChoice
                            value={matches.current.value}
                            label={matches.current.label}
                            source="Currently shown in PSG reports"
                            defaultChecked
                          />
                        </div>
                      ) : null}
                      {matches.master.length || matches.approved.length ? (
                        <div className="space-y-2">
                          <div>
                            <p className="font-heading text-sm font-semibold">
                              Existing PSG reporting names
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              Use these common names to keep insurer reporting
                              consistent.
                            </p>
                          </div>
                          {matches.master.map((insurer, index) => (
                            <InsurerMatchChoice
                              key={insurer.value}
                              value={insurer.value}
                              label={insurer.label}
                              source={
                                index === 0 && !matches.currentMatches
                                  ? "Best PSG name match · Insurer master list"
                                  : "PSG insurer master list"
                              }
                            />
                          ))}
                          {matches.approved.map((insurer, index) => (
                            <InsurerMatchChoice
                              key={insurer.value}
                              value={insurer.value}
                              label={insurer.label}
                              source={
                                index === 0 &&
                                !matches.currentMatches &&
                                !matches.master.length
                                  ? "Best PSG name match · Already used in reports"
                                  : "Reporting name already in use"
                              }
                            />
                          ))}
                        </div>
                      ) : null}
                      {strong.length || possible.length ? (
                        <div className="space-y-2 border-t border-border pt-3">
                          <div>
                            <p className="font-heading text-sm font-semibold">
                              Official NAIC legal records
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              These are licensed company or group names, not
                              common brand suggestions.
                            </p>
                          </div>
                          {strong.map((suggestion) => (
                            <InsurerMatchChoice
                              key={`${suggestion.source}:${suggestion.record_type}:${suggestion.registry_id}`}
                              value={registryTarget(suggestion)}
                              label={suggestion.display_name}
                              source="Official NAIC record"
                              detail={`Name similarity ${suggestion.match_score}% (not identity confidence) · ${suggestion.record_type === "group" ? `group ${suggestion.group_code}` : `company ${suggestion.company_code}`}`}
                            />
                          ))}
                          {possible.map((suggestion) => (
                            <InsurerMatchChoice
                              key={`${suggestion.source}:${suggestion.record_type}:${suggestion.registry_id}`}
                              value={registryTarget(suggestion)}
                              label={suggestion.display_name}
                              source="Possible NAIC record — verify carefully"
                              detail={`Name similarity ${suggestion.match_score}% (not identity confidence) · ${suggestion.record_type === "group" ? `group ${suggestion.group_code}` : `company ${suggestion.company_code}`}`}
                            />
                          ))}
                        </div>
                      ) : null}
                      {!matches.current && !matches.count ? (
                        <div
                          role="status"
                          className="rounded-md border border-border bg-secondary/40 p-3 text-sm leading-6 text-muted-foreground"
                        >
                          No likely match is available yet. Search another name
                          or keep the source label separate.
                        </div>
                      ) : null}
                    </fieldset>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Can’t find the common name you need? Verify and add it to
                      the{" "}
                      <Link
                        href="/ops/sys-config/insurance-companies"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        insurer master list
                      </Link>{" "}
                      before saving. Do not substitute a similar legal entity;
                      keep the imported name separate instead.
                    </p>
                    <label className="block text-sm font-medium">
                      Verification note{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                      <textarea
                        name="review_notes"
                        maxLength={1000}
                        rows={2}
                        placeholder="Example: Exact legal name confirmed on the repair order."
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="font-heading text-sm font-semibold">
                          Save this reporting decision
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {alias.review_status === "candidate"
                            ? `The selected name will replace “${alias.source_label_name}” in reports across all source shops.`
                            : `Saving updates how “${alias.source_label_name}” appears in reports across all source shops.`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          name="action"
                          value="approve"
                          className="rounded-md bg-primary px-3 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          {alias.review_status === "candidate"
                            ? "Save reporting match"
                            : "Save updated match"}
                        </button>
                        <button
                          type="submit"
                          name="action"
                          value="reject"
                          formNoValidate
                          className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium hover:bg-accent"
                        >
                          Keep “{alias.source_label_name}” as-is
                        </button>
                      </div>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ))}

            <aside
              aria-labelledby="insurer-queue-heading"
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              <div className="border-b border-border p-4">
                <h3
                  id="insurer-queue-heading"
                  className="font-heading font-semibold"
                >
                  Review queue
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Showing {aliases.length} of {aliasReviewCount}, highest repair
                  volume first.
                </p>
              </div>
              <nav aria-label="Insurer names awaiting review">
                <ul className="max-h-[36rem] divide-y divide-border overflow-y-auto">
                  {aliases.map((alias) => {
                    const isActive =
                      alias.source_label_normalized ===
                      activeAliasReviewItem?.alias.source_label_normalized;
                    return (
                      <li key={alias.source_label_normalized}>
                        <Link
                          href={`?search_source=${encodeURIComponent(alias.source_label_normalized)}#insurer-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                          aria-current={isActive ? "true" : undefined}
                          className={`block px-4 py-3 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isActive ? "bg-accent" : ""}`}
                        >
                          <span className="block font-heading text-sm font-medium">
                            {alias.source_label_name}
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {alias.repair_orders.toLocaleString()} repair orders
                            · {alias.source_shop_count.toLocaleString()} shops
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </aside>
          </div>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground">
              Every imported insurer label has a saved decision.
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="shop-review-heading" className="space-y-3">
        <div>
          <h2 id="shop-review-heading" className="text-lg font-semibold">
            Connect imported shops
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Match a FileMaker shop to its existing PSG Hub account. The eight
            highest-current-volume candidates are shown below; every unmatched
            shop remains available in the selector. Confirm the exact legal and
            operating identity before connecting repair history.
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            “Fresh arrivals” means the latest repair arrived within the 14-day
            forecast gate. Connecting a shop makes its data eligible for model
            evaluation; a separately approved model is still required before
            forecasts are published.
          </p>
        </div>
        <Card>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-3 pr-4">
                      Source shop
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      Repair orders
                    </th>
                    <th scope="col" className="pb-3 pr-4">
                      2026 repairs
                    </th>
                    <th scope="col" className="pb-3">
                      Latest arrival
                    </th>
                    <th scope="col" className="pb-3 pl-4">
                      Forecast input
                    </th>
                    <th scope="col" className="pb-3 pl-4">
                      Match
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {featuredShops.map((shop) => (
                    <tr key={shop.source_shop_key}>
                      <td className="py-3 pr-4">
                        <p className="font-medium">{shop.source_shop_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {shop.source_shop_key}
                        </p>
                      </td>
                      <td className="py-3 pr-4">
                        {shop.repair_orders.toLocaleString()}
                      </td>
                      <td className="py-3 pr-4">
                        {shop.repair_orders_2026.toLocaleString()}
                      </td>
                      <td className="py-3">
                        {shop.latest_arrival_date ?? "Unknown"}
                      </td>
                      <td className="py-3 pl-4">
                        <Badge
                          variant={
                            shop.hasFreshArrivals ? "success" : "warning"
                          }
                        >
                          {shop.hasFreshArrivals
                            ? "Fresh arrivals"
                            : "Stale or missing"}
                        </Badge>
                      </td>
                      <td className="py-3 pl-4">
                        <Link
                          href={`?shop_source=${encodeURIComponent(shop.source_shop_key)}#shop-match`}
                          className="font-medium text-primary underline underline-offset-4"
                        >
                          Review matches
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              id="shop-match"
              className="mt-6 scroll-mt-6 space-y-5 border-t border-border pt-5"
            >
              <div>
                <h3 className="font-heading font-semibold">
                  Find the exact Hub shop
                </h3>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Pick the imported location first. We rank close names from the
                  live PSG Hub directory; search by shop name, parent account,
                  city, state, or ZIP when the first suggestions are ambiguous.
                  Only a Hub shop whose stored address exactly matches governed
                  source evidence can be connected. Nothing is saved without
                  explicit superadmin confirmation.
                </p>
              </div>

              <form
                action="/dashboard/collision-intelligence/review"
                method="get"
                className="grid gap-4 rounded-lg bg-secondary/40 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
              >
                <label className="text-sm font-medium">
                  1. Imported FileMaker location
                  <select
                    name="shop_source"
                    required
                    defaultValue={selectedShop?.source_shop_key ?? ""}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                  >
                    <option value="" disabled>
                      Select an imported location
                    </option>
                    {shops.map((shop) => (
                      <option
                        key={shop.source_shop_key}
                        value={shop.source_shop_key}
                      >
                        {shop.source_shop_name} ({shop.source_shop_key})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  2. Search the Hub directory
                  <input
                    type="search"
                    name="shop_search"
                    defaultValue={shopSearch}
                    list="hub-shop-directory"
                    maxLength={80}
                    placeholder="Name, parent account, city, state, or ZIP"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md border border-border bg-background px-3 py-2 font-heading text-sm font-medium hover:bg-accent"
                >
                  Search Hub shops
                </button>
                <datalist id="hub-shop-directory">
                  {availableHubShops.map((shop) => (
                    <option
                      key={shop.id}
                      value={[
                        shop.name ?? shop.slug ?? shop.id,
                        shop.address_street,
                        shop.address_locality,
                        shop.address_region,
                        shop.address_postal_code,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  ))}
                </datalist>
              </form>

              {selectedShop ? (
                <div className="rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Imported location under review
                      </p>
                      <p className="mt-1 font-heading text-lg font-semibold">
                        {selectedShop.source_shop_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {selectedShop.source_shop_key} ·{" "}
                        {selectedShop.repair_orders_2026.toLocaleString()}{" "}
                        repair orders in 2026 · latest arrival{" "}
                        {selectedShop.latest_arrival_date ?? "unknown"}
                      </p>
                    </div>
                    <Badge
                      variant={
                        isForecastArrivalFresh(selectedShop.latest_arrival_date)
                          ? "success"
                          : "warning"
                      }
                    >
                      {isForecastArrivalFresh(selectedShop.latest_arrival_date)
                        ? "Forecast-current"
                        : "Stale or missing"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5">
                    <ReviewMetric
                      label="Insured repairs"
                      value={`${selectedShop.insured_repair_orders.toLocaleString()} (${selectedInsuredShare.toFixed(1)}%)`}
                    />
                    <ReviewMetric
                      label="Repair value"
                      value={currency.format(
                        selectedShop.repair_value_cents / 100,
                      )}
                    />
                    <ReviewMetric
                      label="Customer ZIPs"
                      value={selectedShop.customer_zip_count.toLocaleString()}
                    />
                    <ReviewMetric
                      label="Insurer labels"
                      value={selectedShop.insurer_count.toLocaleString()}
                    />
                    <ReviewMetric
                      label="Quality flags"
                      value={selectedShop.quality_flagged_rows.toLocaleString()}
                    />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Coverage {selectedShop.first_arrival_date ?? "unknown"} to{" "}
                    {selectedShop.latest_arrival_date ?? "unknown"}. These are
                    privacy-safe repair-order aggregates—not insurer claim
                    counts. Insurer labels remain subject to the review above.
                  </p>
                </div>
              ) : null}

              {selectedShopEvidence ? (
                <div
                  role="note"
                  className="rounded-lg border border-primary/30 bg-primary/5 p-4"
                >
                  <p className="font-heading font-semibold">
                    Public location evidence
                  </p>
                  <p className="mt-1 text-sm text-foreground/75">
                    {selectedShopEvidence.street},{" "}
                    {selectedShopEvidence.locality},{" "}
                    {selectedShopEvidence.region}{" "}
                    {selectedShopEvidence.postalCode}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Checked {selectedShopEvidence.checkedAt}. Sources:{" "}
                    {selectedShopEvidence.sources.map(([label, url], index) => (
                      <span key={url}>
                        {index ? " · " : ""}
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary underline underline-offset-4"
                        >
                          {label}
                        </a>
                      </span>
                    ))}
                    . Use this to distinguish North from South, then confirm the
                    PSG agreement and exact Hub location before saving.
                  </p>
                </div>
              ) : selectedShop ? (
                <div
                  role="status"
                  className="rounded-lg border border-warning/50 bg-warning/10 p-4"
                >
                  <p className="font-heading font-semibold">
                    Governed address evidence required
                  </p>
                  <p className="mt-1 text-sm leading-6 text-foreground/75">
                    This imported location is not eligible for connection yet.
                    Record an authoritative source plus the expected street,
                    city, state, and ZIP before a Hub shop can be selected.
                  </p>
                </div>
              ) : null}

              {selectedForecastReadiness ? (
                <div
                  role="note"
                  className={
                    selectedForecastReadiness.ready
                      ? "rounded-lg border border-success/40 bg-success/10 p-4"
                      : "rounded-lg border border-warning/50 bg-warning/10 p-4"
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-heading font-semibold">
                      Forecast evaluation readiness
                    </p>
                    <Badge
                      variant={
                        selectedForecastReadiness.ready ? "success" : "warning"
                      }
                    >
                      {selectedForecastReadiness.ready
                        ? "Ready to evaluate"
                        : !selectedForecastReadiness.historyReady
                          ? "More history required"
                          : "Refresh arrivals first"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-foreground/75">
                    This source spans approximately{" "}
                    {selectedForecastReadiness.coverageWeeks.toLocaleString()}{" "}
                    calendar weeks; its latest arrival is{" "}
                    {selectedForecastReadiness.arrivalsFresh
                      ? "within"
                      : "outside"}{" "}
                    the 14-day publication gate.{" "}
                    {selectedForecastReadiness.ready
                      ? "Run the read-only four-horizon evaluator before making a mapping or model decision."
                      : !selectedForecastReadiness.historyReady
                        ? "At least 156 calendar weeks are needed for the seasonal lag, calibration, and holdout windows."
                        : "Refresh and reconcile repair arrivals before evaluating an operating forecast."}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    This is an input-readiness check, not model evidence. The
                    governed evaluator still excludes long coverage gaps and
                    requires every horizon to beat the 52-week seasonal baseline
                    with at least 80% held-out-shop interval coverage. A
                    confirmed mapping is required only before staging manual
                    model review; nothing here approves or publishes a forecast.
                  </p>
                </div>
              ) : null}

              {selectedShopEvidence &&
              shopMatches.some((match) => !match.locationVerified) ? (
                <div
                  role="note"
                  className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm leading-6"
                >
                  Name-only matches with a missing or different street address
                  are excluded. Update or create the exact Hub location before
                  connecting these repair records.
                </div>
              ) : null}

              {selectedShopEvidence && selectableShopMatches.length ? (
                <form
                  action="/api/collision-intelligence/shop-mapping-review"
                  method="post"
                  className="space-y-5"
                >
                  <input
                    type="hidden"
                    name="source_shop_key"
                    value={selectedShop.source_shop_key}
                  />
                  <label className="block font-heading font-semibold">
                    3. Choose only the verified location
                    <select
                      name="shop_id"
                      required
                      defaultValue={
                        selectableShopMatches.length === 1
                          ? selectableShopMatches[0].shop.id
                          : ""
                      }
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-sans font-normal"
                    >
                      <option value="" disabled>
                        Select a candidate after verifying its identity
                      </option>
                      {selectableShopMatches.map((match) => {
                        const memberCount = shopMemberCount(
                          match.shop,
                          customerProfileIds,
                        );
                        const location = [
                          match.shop.address_street,
                          match.shop.address_locality,
                          match.shop.address_region,
                          match.shop.address_postal_code,
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <option key={match.shop.id} value={match.shop.id}>
                            {match.shop.name ??
                              match.shop.slug ??
                              match.shop.id}{" "}
                            — exact address match · {match.score}/100 name match
                            · {location || "location not stored"} · parent{" "}
                            {match.shop.client?.name ?? "unknown"} ·{" "}
                            {memberCount.toLocaleString()} shop{" "}
                            {memberCount === 1 ? "member" : "members"}
                          </option>
                        );
                      })}
                    </select>
                    <span className="mt-2 block font-sans text-xs font-normal leading-5 text-muted-foreground">
                      The list is ranked, not approved. Compare the parent
                      account and physical location before selecting one. The
                      member count shows how many customer users can currently
                      open the dashboard for that shop; staff access is
                      separate.
                    </span>
                  </label>

                  {selectableShopMatches.length > 0 &&
                  selectableShopMatches.every(
                    (match) =>
                      shopMemberCount(match.shop, customerProfileIds) === 0,
                  ) ? (
                    <div
                      role="note"
                      className="rounded-md border border-warning/50 bg-warning/10 p-3"
                    >
                      <p className="font-heading text-sm font-semibold">
                        Shop audience not ready
                      </p>
                      <p className="mt-1 text-sm leading-6 text-foreground/75">
                        No customer users are assigned to this Hub shop yet.
                        Confirm or add the intended members before treating this
                        as an operational shop dashboard. PSG staff access is
                        unchanged.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3 text-sm">
                        {selectableShopMatches
                          .filter(
                            (match) =>
                              shopMemberCount(
                                match.shop,
                                customerProfileIds,
                              ) === 0,
                          )
                          .map((match) => (
                            <Link
                              key={match.shop.id}
                              href={`/ops/admin/users?shop_id=${encodeURIComponent(match.shop.id)}`}
                              className="font-medium underline underline-offset-2"
                            >
                              Manage{" "}
                              {match.shop.name ?? match.shop.slug ?? "shop"}{" "}
                              members
                            </Link>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  {selectableShopMatches.some(
                    (match) => match.locationWarning,
                  ) ? (
                    <div
                      role="note"
                      className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm leading-6"
                    >
                      A similar company name is not enough. Do not connect a
                      North or South FileMaker location to a generic Hub shop
                      unless that Hub record represents the same physical
                      location. Create the missing Hub location first when
                      necessary.
                    </div>
                  ) : null}

                  <label className="block text-sm font-medium">
                    4. Identity evidence
                    <textarea
                      name="review_notes"
                      required
                      minLength={20}
                      maxLength={1000}
                      rows={3}
                      placeholder="Example: Confirmed the street address and PSG customer agreement for this exact location."
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                    />
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="identity_confirmed"
                      value="confirmed"
                      required
                      className="mt-1"
                    />
                    <span>
                      I confirmed that these records belong to this exact
                      physical shop—not only a name-similar company or another
                      location in the same group.
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-primary px-3 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Confirm shop connection
                  </button>
                </form>
              ) : selectedShop ? (
                <div
                  role="status"
                  className="rounded-md border border-border bg-secondary/40 p-4 text-sm leading-6 text-muted-foreground"
                >
                  {!selectedShopEvidence
                    ? "This source cannot be connected until governed address evidence is recorded. Name similarity alone is not accepted."
                    : shopMatches.length
                      ? "No available Hub shop has the verified street address for this imported location. Create or update the exact Hub location first."
                      : shopSearch
                        ? `No available Hub shops matched “${shopSearch}”. Try a shorter name, city, state, or ZIP.`
                        : "No plausible name match was found. Search the Hub directory before creating a new location."}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No unmatched FileMaker shops are available for review.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function InsurerMatchChoice({
  value,
  label,
  source,
  detail,
  defaultChecked = false,
}: {
  value: string;
  label: string;
  source: string;
  detail?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-3 transition-colors hover:bg-accent focus-within:outline-none focus-within:ring-2 focus-within:ring-ring has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input
        type="radio"
        name="canonical_target"
        value={value}
        required
        defaultChecked={defaultChecked}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="font-heading text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {source}
          {detail ? ` · ${detail}` : ""}
        </span>
      </span>
    </label>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-heading font-semibold">{value}</p>
    </div>
  );
}

function SourceHealthCard({
  title,
  status,
  healthy,
  children,
}: {
  title: string;
  status: string;
  healthy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle>{title}</CardTitle>
        <Badge variant={healthy ? "success" : "warning"}>{status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
