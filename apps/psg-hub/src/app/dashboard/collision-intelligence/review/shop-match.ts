export type ShopDirectoryEntry = {
  id: string;
  name: string | null;
  slug: string | null;
  address_street: string | null;
  address_locality: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  client: { name: string } | null;
};

export type ShopIdentityEvidence = {
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  checkedAt: string;
  sources: Array<[string, string]>;
};

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
  if (!evidence) return true;
  return (
    normalizeShopMatchText(shop.address_street ?? "") ===
      normalizeShopMatchText(evidence.street) &&
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
