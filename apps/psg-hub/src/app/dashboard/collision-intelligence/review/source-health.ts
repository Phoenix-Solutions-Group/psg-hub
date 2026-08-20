export function isMissingReviewView(
  error: { code?: string | null; message?: string | null } | null,
  view: string,
): boolean {
  return (
    error?.code === "PGRST205" &&
    Boolean(error.message?.includes(`'public.${view}'`))
  );
}

export function isForecastArrivalFresh(
  latestArrivalDate: string | null,
  today = new Date(),
): boolean {
  if (!latestArrivalDate) return false;
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  return latestArrivalDate >= cutoff.toISOString().slice(0, 10);
}

const minimumForecastEvaluationWeeks = 156;

export function forecastEvaluationReadiness(
  firstArrivalDate: string | null,
  latestArrivalDate: string | null,
  today = new Date(),
) {
  if (!firstArrivalDate || !latestArrivalDate)
    return {
      coverageWeeks: 0,
      historyReady: false,
      arrivalsFresh: false,
      ready: false,
    };

  const firstArrival = Date.parse(`${firstArrivalDate}T00:00:00Z`);
  const latestArrival = Date.parse(`${latestArrivalDate}T00:00:00Z`);
  if (
    !Number.isFinite(firstArrival) ||
    !Number.isFinite(latestArrival) ||
    latestArrival < firstArrival
  )
    return {
      coverageWeeks: 0,
      historyReady: false,
      arrivalsFresh: false,
      ready: false,
    };

  const coverageWeeks =
    Math.floor((latestArrival - firstArrival) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const historyReady = coverageWeeks >= minimumForecastEvaluationWeeks;
  const arrivalsFresh = isForecastArrivalFresh(latestArrivalDate, today);

  return {
    coverageWeeks,
    historyReady,
    arrivalsFresh,
    ready: historyReady && arrivalsFresh,
  };
}

export type ForecastPolicyRow = {
  shop_id: string;
  forecast_horizon_weeks?: number | null;
  model_key: string;
  promotion_status: string;
};

export type ForecastRunRow = {
  shop_id: string;
  forecast_horizon_weeks: number;
  model_key: string;
  forecast_origin_week: string;
  forecast_week: string;
  source_latest_arrival_date: string | null;
  source_age_days: number | null;
  status: string;
  status_reason: string | null;
  generated_at: string;
};

export type ForecastReadinessRow = {
  shop_id: string;
  forecast_horizon_weeks: number;
  approved_model_key: string | null;
  forecast_model_key: string | null;
  forecast_origin_week: string | null;
  forecast_week: string | null;
  source_latest_arrival_date: string | null;
  source_age_days: number | null;
  forecast_status: string | null;
  is_ready: boolean;
  readiness_status: string;
  status_reason: string | null;
  generated_at: string | null;
};

function utcWeekStart(today: Date) {
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start.toISOString().slice(0, 10);
}

export function buildForecastReadinessFallback(
  mappedShopIds: string[],
  weekOnePolicies: ForecastPolicyRow[],
  horizonPolicies: ForecastPolicyRow[],
  forecastRuns: ForecastRunRow[],
  today = new Date(),
): ForecastReadinessRow[] {
  const policies = new Map(
    [
      ...weekOnePolicies.map((policy) => ({
        ...policy,
        forecast_horizon_weeks: 1,
      })),
      ...horizonPolicies,
    ]
      .filter((policy) => policy.promotion_status === "approved")
      .map((policy) => [
        `${policy.shop_id}:${policy.forecast_horizon_weeks}`,
        policy,
      ]),
  );
  const latestForecasts = new Map<string, ForecastRunRow>();

  for (const forecast of [...forecastRuns].sort((a, b) =>
    `${b.forecast_origin_week}:${b.generated_at}`.localeCompare(
      `${a.forecast_origin_week}:${a.generated_at}`,
    ),
  )) {
    const key = `${forecast.shop_id}:${forecast.forecast_horizon_weeks}`;
    if (!latestForecasts.has(key)) latestForecasts.set(key, forecast);
  }

  const currentWeek = utcWeekStart(today);
  return mappedShopIds.flatMap((shopId) =>
    [1, 2, 3, 4].map((horizon) => {
      const key = `${shopId}:${horizon}`;
      const policy = policies.get(key);
      const forecast = latestForecasts.get(key);
      const readinessStatus = !policy
        ? "model_not_approved"
        : !forecast
          ? "not_generated"
          : forecast.model_key !== policy.model_key
            ? "model_mismatch"
            : forecast.forecast_origin_week !== currentWeek
              ? "forecast_outdated"
              : forecast.status;

      return {
        shop_id: shopId,
        forecast_horizon_weeks: horizon,
        approved_model_key: policy?.model_key ?? null,
        forecast_model_key: forecast?.model_key ?? null,
        forecast_origin_week: forecast?.forecast_origin_week ?? null,
        forecast_week: forecast?.forecast_week ?? null,
        source_latest_arrival_date:
          forecast?.source_latest_arrival_date ?? null,
        source_age_days: forecast?.source_age_days ?? null,
        forecast_status: forecast?.status ?? null,
        is_ready: readinessStatus === "published",
        readiness_status: readinessStatus,
        status_reason: forecast?.status_reason ?? null,
        generated_at: forecast?.generated_at ?? null,
      };
    }),
  );
}
