import { isBlankPipedriveValue } from "./deal-billing-autofill";

export interface BodyShopDirectoryMatch {
  shop_id: string;
  shop_name: string;
  place_id: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  normalized_name: string | null;
}

export interface OrganizationEnrichmentFieldKeys {
  address: string;
  phone: string | null;
  website: string | null;
  sourceShopId: string | null;
  sourcePlaceId: string | null;
}

export interface OrganizationEnrichmentPatch {
  patch: Record<string, string>;
  filled: Array<{ fieldKey: string; sourceField: string; value: string }>;
  skipped: Array<{
    fieldKey: string;
    sourceField: string;
    reason: "organization_already_has_value" | "source_blank" | "field_not_configured";
  }>;
}

type SupabaseLike = {
  from(table: string): {
    select(columns: string): unknown;
  };
};

type QueryResult = {
  data?: BodyShopDirectoryMatch[] | null;
  error?: { message?: string } | null;
};

type QueryBuilder = PromiseLike<QueryResult> & {
  eq?(column: string, value: string): QueryBuilder;
  ilike?(column: string, value: string): QueryBuilder;
  order?(column: string, options?: Record<string, unknown>): QueryBuilder;
  limit?(count: number): QueryBuilder;
};

const BODY_SHOP_COLUMNS =
  "shop_id,shop_name,place_id,address,phone,website,rating,normalized_name";

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function normalizeBodyShopName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

export function organizationEnrichmentFieldKeys(
  env: Record<string, string | undefined> = process.env,
): OrganizationEnrichmentFieldKeys {
  return {
    address: env.PIPEDRIVE_ORG_ADDRESS_FIELD_KEY?.trim() || "address",
    phone: env.PIPEDRIVE_ORG_PHONE_FIELD_KEY?.trim() || null,
    website: env.PIPEDRIVE_ORG_WEBSITE_FIELD_KEY?.trim() || null,
    sourceShopId: env.PIPEDRIVE_ORG_BODY_SHOP_ID_FIELD_KEY?.trim() || null,
    sourcePlaceId: env.PIPEDRIVE_ORG_GOOGLE_PLACE_ID_FIELD_KEY?.trim() || null,
  };
}

function queryBuilder(query: unknown): QueryBuilder {
  return query as QueryBuilder;
}

function rankMatches(
  rows: BodyShopDirectoryMatch[],
  normalizedName: string,
): BodyShopDirectoryMatch | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const aExact = a.normalized_name === normalizedName ? 0 : 1;
    const bExact = b.normalized_name === normalizedName ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return (b.rating ?? -1) - (a.rating ?? -1);
  })[0] ?? null;
}

export async function findBodyShopForOrganization(
  db: SupabaseLike,
  organizationName: string | null,
): Promise<BodyShopDirectoryMatch | null> {
  const name = clean(organizationName);
  if (!name) return null;
  const normalizedName = normalizeBodyShopName(name);
  if (normalizedName.length < 3) return null;

  const exact = await queryBuilder(db.from("body_shops").select(BODY_SHOP_COLUMNS))
    .eq?.("normalized_name", normalizedName)
    .order?.("rating", { ascending: false, nullsFirst: false })
    .limit?.(5);
  if (exact?.error) {
    throw new Error(exact.error.message ?? "body_shops exact lookup failed");
  }
  const exactMatch = rankMatches(exact?.data ?? [], normalizedName);
  if (exactMatch) return exactMatch;

  const fuzzy = await queryBuilder(db.from("body_shops").select(BODY_SHOP_COLUMNS))
    .ilike?.("shop_name", `%${escapeLike(name)}%`)
    .order?.("rating", { ascending: false, nullsFirst: false })
    .limit?.(5);
  if (fuzzy?.error) {
    throw new Error(fuzzy.error.message ?? "body_shops fuzzy lookup failed");
  }
  return rankMatches(fuzzy?.data ?? [], normalizedName);
}

export function buildOrganizationBodyShopPatch({
  organization,
  match,
  fieldKeys = organizationEnrichmentFieldKeys(),
}: {
  organization: Record<string, unknown>;
  match: BodyShopDirectoryMatch;
  fieldKeys?: OrganizationEnrichmentFieldKeys;
}): OrganizationEnrichmentPatch {
  const result: OrganizationEnrichmentPatch = { patch: {}, filled: [], skipped: [] };
  const candidates: Array<{
    fieldKey: string | null;
    sourceField: string;
    sourceValue: string | null;
  }> = [
    {
      fieldKey: fieldKeys.address,
      sourceField: "body_shops.address",
      sourceValue: clean(match.address),
    },
    {
      fieldKey: fieldKeys.phone,
      sourceField: "body_shops.phone",
      sourceValue: clean(match.phone),
    },
    {
      fieldKey: fieldKeys.website,
      sourceField: "body_shops.website",
      sourceValue: clean(match.website),
    },
    {
      fieldKey: fieldKeys.sourceShopId,
      sourceField: "body_shops.shop_id",
      sourceValue: clean(match.shop_id),
    },
    {
      fieldKey: fieldKeys.sourcePlaceId,
      sourceField: "body_shops.place_id",
      sourceValue: clean(match.place_id),
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.fieldKey) {
      result.skipped.push({
        fieldKey: "(unconfigured)",
        sourceField: candidate.sourceField,
        reason: "field_not_configured",
      });
      continue;
    }
    if (!isBlankPipedriveValue(organization[candidate.fieldKey])) {
      result.skipped.push({
        fieldKey: candidate.fieldKey,
        sourceField: candidate.sourceField,
        reason: "organization_already_has_value",
      });
      continue;
    }
    if (!candidate.sourceValue) {
      result.skipped.push({
        fieldKey: candidate.fieldKey,
        sourceField: candidate.sourceField,
        reason: "source_blank",
      });
      continue;
    }
    result.patch[candidate.fieldKey] = candidate.sourceValue;
    result.filled.push({
      fieldKey: candidate.fieldKey,
      sourceField: candidate.sourceField,
      value: candidate.sourceValue,
    });
  }

  return result;
}
