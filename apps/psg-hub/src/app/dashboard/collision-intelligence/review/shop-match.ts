export type ShopDirectoryEntry = {
  id: string;
  name: string | null;
  slug: string | null;
  address_street: string | null;
  address_locality: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  client: { name: string } | null;
  members?: Array<{ user_id: string }>;
};

export type ShopIdentityEvidence = {
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  checkedAt: string;
  sources: Array<[string, string]>;
};

export type ForecastCandidateEvidence = {
  source: "governed" | "preview";
  evaluatedAt: string;
  latestWeekCutoff: string;
  modelLabel: string;
  holdoutRepairs: number;
  maeImprovementPct: readonly [number, number];
  wapePct: readonly [number, number];
  intervalCoveragePct: readonly [number, number];
  historyNote: string;
};

export type ForecastCandidateEvaluationRow = {
  source_shop_key: string;
  latest_week_cutoff: string;
  horizons: unknown;
  evaluated_at: string;
};

export function shopMemberCount(
  shop: Pick<ShopDirectoryEntry, "members">,
  customerProfileIds: ReadonlySet<string>,
) {
  return (
    shop.members?.filter((member) => customerProfileIds.has(member.user_id))
      .length ?? 0
  );
}

export function approvedPoliciesWithoutCustomerAudience<
  T extends { shop_id: string; promotion_status: string },
>(
  policies: T[],
  shops: ShopDirectoryEntry[],
  customerProfileIds: ReadonlySet<string>,
) {
  return policies.filter((policy) => {
    if (policy.promotion_status !== "approved") return false;
    const shop = shops.find((candidate) => candidate.id === policy.shop_id);
    return !shop || shopMemberCount(shop, customerProfileIds) === 0;
  });
}

// ponytail: two verified pilot locations; move to governed identity rows when review coverage expands.
export const shopIdentityEvidence: Record<string, ShopIdentityEvidence> = {
  PS228: {
    street: "4538 Cornhusker Hwy",
    locality: "Lincoln",
    region: "NE",
    postalCode: "68504",
    checkedAt: "Aug 20, 2026",
    sources: [
      [
        "BBB business profile",
        "https://www.bbb.org/us/ne/lincoln/profile/auto-body-repair-and-painting/tracys-collision-center-0714-207000414",
      ],
      [
        "GM Collision Repair Network",
        "https://www.gmparts.com/content/dam/gmparts/na/us/en/index/technical-resources/collision-repair-network/02-pdfs/GM_CRN_CT6_Specialty%20Active_8.23.pdf",
      ],
    ],
  },
  PS229: {
    street: "1500 Center Park Rd",
    locality: "Lincoln",
    region: "NE",
    postalCode: "68512",
    checkedAt: "Aug 20, 2026",
    sources: [
      [
        "BBB business profile",
        "https://www.bbb.org/us/ne/lincoln/profile/auto-body-repair-and-painting/tracys-collision-center-0714-207000414/addressId/70387",
      ],
    ],
  },
};

// ponytail: preview fallback until the governed candidate-evidence migration is released.
export const forecastCandidateEvidence: Record<
  string,
  ForecastCandidateEvidence
> = {
  PS228: {
    source: "preview",
    evaluatedAt: "2026-08-20",
    latestWeekCutoff: "2026-08-03",
    modelLabel: "Seasonal + recent blend",
    holdoutRepairs: 531,
    maeImprovementPct: [16.5, 21.0],
    wapePct: [27.5, 29.1],
    intervalCoveragePct: [80.4, 85.1],
    historyNote: "One 46-week internal coverage gap was excluded.",
  },
  PS229: {
    source: "preview",
    evaluatedAt: "2026-08-20",
    latestWeekCutoff: "2026-08-03",
    modelLabel: "Seasonal + recent blend",
    holdoutRepairs: 844,
    maeImprovementPct: [20.1, 24.1],
    wapePct: [17.7, 18.7],
    intervalCoveragePct: [80.4, 85.1],
    historyNote: "The current evaluation segment has no long internal gap.",
  },
};

type CandidateHorizon = {
  forecast_horizon_weeks: number;
  model_key: string;
  model_wape_pct: number;
  mae_improvement_pct: number;
  holdout_repairs: number;
  excluded_internal_gap_weeks: number;
  interval_validation_coverage_pct: number;
};

function candidateHorizons(value: unknown): CandidateHorizon[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const horizons = value.filter(
    (item): item is CandidateHorizon =>
      Boolean(item) &&
      typeof item === "object" &&
      [
        "forecast_horizon_weeks",
        "model_wape_pct",
        "mae_improvement_pct",
        "holdout_repairs",
        "excluded_internal_gap_weeks",
        "interval_validation_coverage_pct",
      ].every(
        (key) =>
          typeof (item as Record<string, unknown>)[key] === "number" &&
          Number.isFinite((item as Record<string, number>)[key]),
      ) &&
      typeof (item as Record<string, unknown>).model_key === "string",
  );
  return horizons.length === 4 &&
    horizons
      .map((horizon) => horizon.forecast_horizon_weeks)
      .sort((a, b) => a - b)
      .every((horizon, index) => horizon === index + 1)
    ? horizons
    : null;
}

function range(values: number[]): readonly [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

export function summarizeForecastCandidateEvidence(
  row: ForecastCandidateEvaluationRow,
): ForecastCandidateEvidence | null {
  const horizons = candidateHorizons(row.horizons);
  if (!horizons) return null;
  const models = new Set(horizons.map((horizon) => horizon.model_key));
  const modelLabel =
    models.size > 1
      ? "Best supported model by horizon"
      : models.has("seasonal_recent_blend_v1")
        ? "Seasonal + recent blend"
        : models.has("trailing4_v1")
          ? "Recent four-week average"
          : "Evaluated model";
  const excludedGapWeeks = Math.max(
    ...horizons.map((horizon) => horizon.excluded_internal_gap_weeks),
  );

  return {
    source: "governed",
    evaluatedAt: row.evaluated_at,
    latestWeekCutoff: row.latest_week_cutoff,
    modelLabel,
    holdoutRepairs: Math.max(
      ...horizons.map((horizon) => horizon.holdout_repairs),
    ),
    maeImprovementPct: range(
      horizons.map((horizon) => horizon.mae_improvement_pct),
    ),
    wapePct: range(horizons.map((horizon) => horizon.model_wape_pct)),
    intervalCoveragePct: range(
      horizons.map((horizon) => horizon.interval_validation_coverage_pct),
    ),
    historyNote: excludedGapWeeks
      ? `${excludedGapWeeks} internal coverage-gap weeks were excluded.`
      : "The current evaluation segment has no long internal gap.",
  };
}

export function preferredForecastPilot(
  evidence: Record<string, ForecastCandidateEvidence>,
) {
  return Object.entries(evidence).sort(([, left], [, right]) => {
    const leftWape = (left.wapePct[0] + left.wapePct[1]) / 2;
    const rightWape = (right.wapePct[0] + right.wapePct[1]) / 2;
    return leftWape - rightWape || right.holdoutRepairs - left.holdoutRepairs;
  })[0]?.[0];
}

export type RankedShopMatch = {
  shop: ShopDirectoryEntry;
  score: number;
  searchScore: number;
  locationWarning: boolean;
};

const directions = new Set([
  "central",
  "downtown",
  "east",
  "north",
  "northeast",
  "northwest",
  "south",
  "southeast",
  "southwest",
  "west",
]);

const genericShopTokens = new Set([
  "auto",
  "automotive",
  "body",
  "car",
  "center",
  "collision",
  "paint",
  "repair",
  "service",
  "services",
  "shop",
  "the",
]);

export function normalizeShopMatchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeStreet(value: string) {
  return normalizeShopMatchText(value).replace(/\broad\b/g, "rd");
}

export function matchesVerifiedShopLocation(
  sourceShopKey: string,
  shop: Pick<
    ShopDirectoryEntry,
    | "address_street"
    | "address_locality"
    | "address_region"
    | "address_postal_code"
  >,
) {
  const evidence = shopIdentityEvidence[sourceShopKey];
  if (!evidence) return false;
  return (
    normalizeStreet(shop.address_street ?? "") ===
      normalizeStreet(evidence.street) &&
    normalizeShopMatchText(shop.address_locality ?? "") ===
      normalizeShopMatchText(evidence.locality) &&
    normalizeShopMatchText(shop.address_region ?? "") ===
      normalizeShopMatchText(evidence.region) &&
    normalizeShopMatchText(shop.address_postal_code ?? "") ===
      normalizeShopMatchText(evidence.postalCode)
  );
}

function tokenSet(value: string) {
  return new Set(normalizeShopMatchText(value).split(" ").filter(Boolean));
}

function distinctiveText(tokens: Set<string>) {
  return [...tokens]
    .filter((token) => token.length > 1 && !genericShopTokens.has(token))
    .join(" ");
}

function dice(left: string, right: string) {
  const pairs = (value: string) =>
    new Set(
      Array.from({ length: Math.max(0, value.length - 1) }, (_, index) =>
        value.slice(index, index + 2),
      ),
    );
  const leftPairs = pairs(left);
  const rightPairs = pairs(right);
  if (!leftPairs.size || !rightPairs.size) return 0;
  const shared = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
  return (2 * shared) / (leftPairs.size + rightPairs.size);
}

function hasLocationGap(source: string, target: string) {
  const targetTokens = tokenSet(target);
  return [...tokenSet(source)].some(
    (token) => directions.has(token) && !targetTokens.has(token),
  );
}

function similarity(source: string, target: string) {
  const left = normalizeShopMatchText(source);
  const right = normalizeShopMatchText(target);
  if (!left || !right) return 0;
  if (left === right) return 100;
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  const shared = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  let score = Math.round(
    dice(left, right) * 60 +
      (shared / Math.max(leftTokens.size, rightTokens.size)) * 40,
  );
  if (left.includes(right) || right.includes(left)) score = Math.max(78, score);
  const hasDistinctiveOverlap = [...leftTokens].some(
    (token) =>
      token.length > 1 &&
      !genericShopTokens.has(token) &&
      rightTokens.has(token),
  );
  if (
    !hasDistinctiveOverlap &&
    dice(distinctiveText(leftTokens), distinctiveText(rightTokens)) < 0.55
  ) {
    score = Math.min(24, score);
  }
  return hasLocationGap(source, target) ? Math.min(79, score) : score;
}

function directorySearchScore(query: string, shop: ShopDirectoryEntry) {
  const normalized = normalizeShopMatchText(query);
  if (!normalized) return 0;
  const searchable = normalizeShopMatchText(
    [
      shop.name,
      shop.client?.name,
      shop.slug,
      shop.address_street,
      shop.address_locality,
      shop.address_region,
      shop.address_postal_code,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (searchable.includes(normalized)) return 100;
  const queryTokens = tokenSet(normalized);
  const searchableTokens = tokenSet(searchable);
  const coverage =
    [...queryTokens].filter((token) => searchableTokens.has(token)).length /
    queryTokens.size;
  return Math.max(
    Math.round(coverage * 88),
    similarity(query, shop.name ?? ""),
    similarity(query, shop.client?.name ?? ""),
  );
}

export function rankShopMatches(
  sourceName: string,
  shops: ShopDirectoryEntry[],
  query = "",
  limit = 8,
): RankedShopMatch[] {
  const hasQuery = Boolean(normalizeShopMatchText(query));
  return shops
    .map((shop) => {
      const target = shop.name ?? shop.client?.name ?? shop.slug ?? "";
      return {
        shop,
        score: Math.max(
          similarity(sourceName, shop.name ?? ""),
          similarity(sourceName, shop.client?.name ?? ""),
        ),
        searchScore: directorySearchScore(query, shop),
        locationWarning: hasLocationGap(sourceName, target),
      };
    })
    .filter((match) => (hasQuery ? match.searchScore >= 35 : match.score >= 25))
    .sort((left, right) =>
      hasQuery
        ? right.searchScore - left.searchScore || right.score - left.score
        : right.score - left.score,
    )
    .slice(0, limit);
}
