import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardAccess } from "@/lib/auth/shop-access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isForecastArrivalFresh, isMissingReviewView } from "./source-health";
import { rankShopMatches, type ShopDirectoryEntry } from "./shop-match";

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
  repair_orders_2026: number;
  latest_arrival_date: string | null;
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

type ForecastHealth = {
  is_ready: boolean;
  readiness_status: string;
  generated_at: string | null;
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
  mapping_error: "The shop mapping could not be saved. No mapping was changed.",
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
  const [
    aliasResult,
    approvedInsurerResult,
    insuranceCompanyResult,
    shopResult,
    hubShopResult,
    mappedShopResult,
    repairSourceResult,
    repairFeedResult,
    stormSourceResult,
    crashSourceResult,
    forecastResult,
    params,
  ] = await Promise.all([
    service
      .from("v_collision_insurer_alias_review_queue")
      .select(
        "source_label_normalized,source_label_name,source_shop_count,repair_orders,repair_value_cents,latest_arrival_date",
      )
      .eq("review_status", "candidate")
      .order("repair_orders", { ascending: false })
      .limit(20),
    service
      .from("collision_insurer_alias_reviews")
      .select("canonical_insurer_key,canonical_insurer_name")
      .eq("review_status", "approved")
      .order("canonical_insurer_name", { ascending: true }),
    service.from("insurance_companies").select("id,name").order("name"),
    service
      .from("v_collision_filemaker_shop_summary")
      .select(
        "source_shop_key,source_shop_name,repair_orders,repair_orders_2026,latest_arrival_date",
      )
      .is("shop_id", null)
      .order("repair_orders_2026", { ascending: false })
      .order("latest_arrival_date", { ascending: false })
      .order("repair_orders", { ascending: false }),
    service
      .from("shops")
      .select(
        "id,name,slug,address_locality,address_region,address_postal_code,client:clients(name)",
      )
      .order("name", { ascending: true }),
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
      .select("is_ready,readiness_status,generated_at")
      .order("generated_at", { ascending: false, nullsFirst: false }),
    searchParams,
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
    approvedInsurerResult.error ||
    insuranceCompanyResult.error ||
    shopResult.error ||
    hubShopResult.error ||
    mappedShopResult.error ||
    repairSourceResult.error ||
    repairFeedResult.error ||
    (stormSourceResult.error && !stormHealthUnavailable) ||
    crashSourceResult.error ||
    (forecastResult.error && !forecastHealthUnavailable)
  ) {
    throw new Error(
      aliasResult.error?.message ??
        approvedInsurerResult.error?.message ??
        insuranceCompanyResult.error?.message ??
        shopResult.error?.message ??
        hubShopResult.error?.message ??
        mappedShopResult.error?.message ??
        repairSourceResult.error?.message ??
        repairFeedResult.error?.message ??
        stormSourceResult.error?.message ??
        crashSourceResult.error?.message ??
        forecastResult.error?.message ??
        "Review queue failed",
    );
  }

  const aliases = (aliasResult.data ?? []) as AliasCandidate[];
  const searchSource = searchValue(params.search_source);
  const requestedSearchAlias = aliases.find(
    (alias) => alias.source_label_normalized === searchSource,
  );
  const registrySearch = requestedSearchAlias
    ? searchValue(params.registry_search).slice(0, 80)
    : "";
  const registryResult = aliases.length
    ? await service.rpc("collision_insurer_registry_matches", {
        source_labels: aliases.map((alias) => alias.source_label_name),
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
  const aliasReviewItems = aliases.map((alias) => {
    const automaticSuggestions =
      registrySuggestionsByLabel.get(alias.source_label_name) ?? [];
    const registrySuggestions =
      alias.source_label_normalized ===
      requestedSearchAlias?.source_label_normalized
        ? directorySearchSuggestions
        : automaticSuggestions;
    return {
      alias,
      strong: registrySuggestions.filter(
        (suggestion) => suggestion.match_score >= 80,
      ),
      possible: registrySuggestions.filter(
        (suggestion) => suggestion.match_score < 80,
      ),
    };
  });
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
  const shops = (shopResult.data ?? []) as ShopCandidate[];
  const featuredShops = shops.slice(0, 8).map((shop) => ({
    ...shop,
    hasFreshArrivals: isForecastArrivalFresh(shop.latest_arrival_date),
  }));
  const mappedShopIds = new Set(
    (mappedShopResult.data ?? []).map((row) => row.shop_id as string),
  );
  const availableHubShops = (
    (hubShopResult.data ?? []) as unknown as ShopDirectoryEntry[]
  ).filter((shop) => !mappedShopIds.has(shop.id));
  const requestedShopKey = searchValue(params.shop_source).toUpperCase();
  const selectedShop =
    shops.find((shop) => shop.source_shop_key === requestedShopKey) ??
    featuredShops[0] ??
    null;
  const shopSearch = selectedShop
    ? searchValue(params.shop_search).slice(0, 80)
    : "";
  const shopMatches = selectedShop
    ? rankShopMatches(
        selectedShop.source_shop_name,
        availableHubShops,
        shopSearch,
      )
    : [];
  const repairSource = (repairSourceResult.data?.[0] ??
    null) as RepairSourceHealth | null;
  const repairFeeds = (repairFeedResult.data ?? []) as RepairFeedHealth[];
  const stormSources = (stormSourceResult.data ?? []) as StormSourceHealth[];
  const crashSource = (crashSourceResult.data?.[0] ??
    null) as CrashSourceHealth | null;
  const forecasts = (forecastResult.data ?? []) as ForecastHealth[];
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
  const forecastGateStates = [
    ...new Set(
      forecasts
        .filter((forecast) => !forecast.is_ready)
        .map((forecast) => forecast.readiness_status.replaceAll("_", " ")),
    ),
  ].join(", ");
  const latestForecast = forecasts.find((forecast) => forecast.generated_at);
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
          Data quality &amp; matching
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Prepare imported collision data before it appears in shop reports.
          Match FileMaker insurer labels to a standard insurer name, connect
          imported shops to PSG Hub, and check whether each data feed is ready.
          Nothing is merged automatically, and every saved decision is audited.
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
              forecastHealthUnavailable
                ? "Release pending"
                : !forecasts.length
                  ? "No mapped shops"
                  : readyForecasts === forecasts.length
                    ? "Ready"
                    : "Gated"
            }
            healthy={Boolean(
              forecasts.length && readyForecasts === forecasts.length,
            )}
          >
            <ReviewMetric
              label="Shop / horizon policies"
              value={
                forecastHealthUnavailable
                  ? "—"
                  : forecasts.length.toLocaleString()
              }
            />
            <ReviewMetric
              label="Ready"
              value={
                forecastHealthUnavailable
                  ? "—"
                  : readyForecasts.toLocaleString()
              }
            />
            <ReviewMetric
              label="Gate states"
              value={
                forecastHealthUnavailable
                  ? "Release migration not applied"
                  : forecastGateStates || "None"
              }
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
      </section>

      <section aria-labelledby="alias-review-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="alias-review-heading" className="text-lg font-semibold">
              Review imported insurer names
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              FileMaker labels stay unchanged. Choose how each label should
              appear and roll up in reports: search the official directory,
              confirm one insurer, then save the decision.
            </p>
          </div>
          <Badge variant="warning">
            {aliases.length} {aliases.length === 1 ? "name" : "names"} need
            review
          </Badge>
        </div>

        {registryUnavailable ? (
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs leading-5 text-muted-foreground">
            Official registry suggestions are temporarily unavailable. Existing
            PSG names remain available.
          </p>
        ) : null}

        {aliases.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {aliasReviewItems.map(({ alias, strong, possible }) => (
              <Card
                key={alias.source_label_normalized}
                id={`insurer-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                className={
                  alias.source_label_normalized === searchSource
                    ? "border-primary"
                    : undefined
                }
              >
                <CardHeader className="border-b border-border pb-4">
                  <CardTitle className="text-lg">
                    {alias.source_label_name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    This name was imported from FileMaker. Your decision changes
                    reporting only; the source repair orders stay unchanged.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
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
                    className="flex gap-3 rounded-md bg-secondary/60 p-3"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xs font-semibold text-primary-foreground"
                    >
                      1
                    </span>
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
                        Find the insurer
                      </label>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        Search the NAIC directory by legal name, brand, or
                        abbreviation. Existing PSG names appear in step 2.
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
                              ? registrySearch
                              : ""
                          }
                          placeholder="Example: USAA"
                          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-border bg-background px-3 py-2 font-heading text-sm font-medium hover:bg-accent"
                        >
                          Search official directory
                        </button>
                      </div>
                      {alias.source_label_normalized === searchSource &&
                      registrySearch ? (
                        <p
                          role="status"
                          className="mt-2 text-xs leading-5 text-muted-foreground"
                        >
                          {directorySearchUnavailable
                            ? "The official directory search is unavailable. Choose an existing PSG name below or leave this label ungrouped."
                            : directorySearchSuggestions.length
                              ? `Showing ${directorySearchSuggestions.length} official registry match${directorySearchSuggestions.length === 1 ? "" : "es"} for “${registrySearch}”.`
                              : `No official registry matches found for “${registrySearch}”. Try the full legal name or leave this label ungrouped.`}
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
                    <div className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xs font-semibold text-primary-foreground"
                      >
                        2
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div>
                          <label className="block font-heading text-sm font-semibold">
                            Confirm the reporting name
                            <select
                              name="canonical_target"
                              required
                              defaultValue=""
                              aria-describedby={`insurer-match-help-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                              className="mt-2 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 font-sans font-normal"
                            >
                              <option value="" disabled>
                                Select an official or existing PSG name
                              </option>
                              {strong.length ? (
                                <optgroup
                                  label={
                                    alias.source_label_normalized ===
                                      searchSource && registrySearch
                                      ? `Strong official matches for “${registrySearch}”`
                                      : "Strong NAIC registry matches"
                                  }
                                >
                                  {strong.map((suggestion) => (
                                    <option
                                      key={`${suggestion.source}:${suggestion.record_type}:${suggestion.registry_id}`}
                                      value={registryTarget(suggestion)}
                                    >
                                      {suggestion.display_name} —{" "}
                                      {suggestion.match_score}% name match
                                      {suggestion.record_type === "group"
                                        ? ` · NAIC group ${suggestion.group_code}`
                                        : ` · NAIC company ${suggestion.company_code}`}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              {possible.length ? (
                                <optgroup label="Lower-confidence matches — verify carefully">
                                  {possible.map((suggestion) => (
                                    <option
                                      key={`${suggestion.source}:${suggestion.record_type}:${suggestion.registry_id}`}
                                      value={registryTarget(suggestion)}
                                    >
                                      {suggestion.display_name} —{" "}
                                      {suggestion.match_score}% name match
                                      {suggestion.record_type === "group"
                                        ? ` · NAIC group ${suggestion.group_code}`
                                        : ` · NAIC company ${suggestion.company_code}`}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              {insurerOptions.length ? (
                                <optgroup label="Existing PSG reporting names">
                                  {insurerOptions.map((insurer) => (
                                    <option
                                      key={insurer.value}
                                      value={insurer.value}
                                    >
                                      {insurer.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                            </select>
                          </label>
                          <p
                            id={`insurer-match-help-${alias.source_label_normalized.replaceAll(" ", "-")}`}
                            className="mt-2 text-xs leading-5 text-muted-foreground"
                          >
                            Match the most specific entity supported by the
                            source record; do not guess. Registry status and
                            name similarity do not prove a state-specific
                            license.
                          </p>
                        </div>
                        {strong[0] ? (
                          <div className="rounded-md bg-accent p-3 text-xs leading-5">
                            <p className="font-heading font-semibold">
                              Best name match
                            </p>
                            <p className="text-muted-foreground">
                              {strong[0].display_name} · {strong[0].match_score}
                              % name match · NAIC {strong[0].record_type}{" "}
                              {strong[0].registry_id}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      No reliable option? Leave the name ungrouped. Add a new
                      insurer to the{" "}
                      <Link
                        href="/ops/sys-config/insurance-companies"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        insurer master list
                      </Link>{" "}
                      only after verifying its identity.
                    </p>
                    <label className="block text-sm font-medium">
                      Why is this the right match?{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                      <textarea
                        name="review_notes"
                        maxLength={1000}
                        rows={2}
                        placeholder="Example: Legal company name confirmed on the repair order."
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-normal"
                      />
                    </label>
                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex gap-3">
                        <span
                          aria-hidden="true"
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-xs font-semibold text-primary-foreground"
                        >
                          3
                        </span>
                        <div>
                          <p className="font-heading text-sm font-semibold">
                            Save the decision
                          </p>
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            This applies to “{alias.source_label_name}” across
                            all source shops.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          name="action"
                          value="approve"
                          className="rounded-md bg-primary px-3 py-2 font-heading text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Save confirmed match
                        </button>
                        <button
                          type="submit"
                          name="action"
                          value="reject"
                          formNoValidate
                          className="rounded-md border border-border px-3 py-2 font-heading text-sm font-medium hover:bg-accent"
                        >
                          Leave name ungrouped
                        </button>
                      </div>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ))}
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
                  A suggestion is never selected or saved automatically.
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
                </div>
              ) : null}

              {selectedShop && shopMatches.length ? (
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
                      defaultValue=""
                      className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-sans font-normal"
                    >
                      <option value="" disabled>
                        Select a candidate after verifying its identity
                      </option>
                      {shopMatches.map((match) => {
                        const location = [
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
                            — {match.score}/100 name match ·{" "}
                            {location || "location not stored"} · parent{" "}
                            {match.shop.client?.name ?? "unknown"}
                          </option>
                        );
                      })}
                    </select>
                    <span className="mt-2 block font-sans text-xs font-normal leading-5 text-muted-foreground">
                      The list is ranked, not approved. Compare the parent
                      account and physical location before selecting one.
                    </span>
                  </label>

                  {shopMatches.some((match) => match.locationWarning) ? (
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
                  {shopSearch
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
