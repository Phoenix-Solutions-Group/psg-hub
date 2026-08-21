#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

try {
  require("dotenv").config({ path: ".env.local", quiet: true });
} catch {
  // dotenv is present in this workspace; keep the script runnable if it is not.
}

const OUT_DIR = path.join(process.cwd(), "artifacts", process.env.PIPEDRIVE_CLEANUP_ARTIFACT_ID || "PSG-1534");
const GENERATED_AT = new Date().toISOString();
const PIPEDRIVE_BASE = "https://api.pipedrive.com";
const PIPEDRIVE_PAGE_LIMIT = 500;
const PHONE_FIELD_KEY = "04b2473348bdf2df769dcc3d40323bd319465965";
const CUSTOM_WEBSITE_FIELD_KEY = "6ea223d17fb76811dc47ae73d35610559621cf39";

function requiredEnv(name, aliases = []) {
  const names = [name, ...aliases];
  for (const key of names) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const first = value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object" && typeof entry.value === "string") {
          return entry.value.trim();
        }
        return "";
      })
      .find(Boolean);
    return first ?? "";
  }
  if (typeof value === "object") {
    if (typeof value.value === "string") return value.value.trim();
    if (typeof value.formatted_address === "string") return value.formatted_address.trim();
  }
  return "";
}

function digits(value) {
  return asText(value).replace(/\D/g, "");
}

function phone10(value) {
  const d = digits(value);
  if (d.length < 10) return "";
  return d.slice(-10);
}

function normalizeName(value) {
  return asText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactName(value) {
  return normalizeName(value).replace(/\s+/g, "");
}

function exactDisplayName(value) {
  return asText(value).replace(/\s+/g, " ").trim();
}

function namesMatchExactly(org, source) {
  return exactDisplayName(org.name) === exactDisplayName(sourceName(source));
}

function normalizeUrl(value) {
  const text = cleanWebsiteUrl(value).toLowerCase().trim();
  if (!text) return "";
  return text.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function decodeUrlPieces(value) {
  let text = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) return text;
      text = decoded;
    } catch {
      return text;
    }
  }
  return text;
}

function stripTrackingFromPath(pathname) {
  let pathText = decodeUrlPieces(pathname);
  pathText = pathText.replace(/[?#].*$/, "");
  pathText = pathText.replace(/\/+$/, "");
  if (!pathText || pathText === "/") return "";
  return pathText;
}

function cleanWebsiteUrl(value) {
  const raw = asText(value).trim();
  if (!raw) return "";

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return "";
    const pathText = stripTrackingFromPath(url.pathname);
    return `${url.protocol.toLowerCase()}//${host}${pathText}`;
  } catch {
    const decoded = decodeUrlPieces(raw)
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    return decoded;
  }
}

function normalizePostalCode(value) {
  const text = asText(value);
  const match = text.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
  return match ? match[1] : "";
}

function postalCodeFromObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const key of [
    "postal_code",
    "postalCode",
    "postcode",
    "post_code",
    "zip",
    "zip_code",
    "address_postal_code",
    "address_zip",
  ]) {
    const postalCode = normalizePostalCode(value[key]);
    if (postalCode) return postalCode;
  }
  return "";
}

function postalCodeFromFormattedAddress(value) {
  const text = asText(value).replace(/\s+/g, " ").trim();
  if (!text) return "";

  const cityStateZip = text.match(
    /(?:^|,\s*)[A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s+(\d{5})(?:-\d{4})?(?:,?\s*(?:USA|US|United States(?: of America)?))?$/i,
  );
  if (cityStateZip) return cityStateZip[1];

  const stateZip = text.match(
    /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*,?\s*(\d{5})(?:-\d{4})?(?:,?\s*(?:USA|US|United States(?: of America)?))?$/i,
  );
  return stateZip ? stateZip[1] : "";
}

function postalCodeFromAddress(value) {
  return postalCodeFromObject(value) || postalCodeFromFormattedAddress(value);
}

function stateFrom(value) {
  const text = asText(value).toUpperCase();
  const match = text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/);
  return match ? match[1] : "";
}

function streetKey(value) {
  return asText(value)
    .toLowerCase()
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(lane|ln)\b/g, "ln")
    .replace(/\b(highway|hwy)\b/g, "hwy")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 28);
}

function bestAddress(row) {
  return (
    asText(row.address_formatted_address) ||
    asText(row.address) ||
    asText(row.raw_payload?.formatted_address) ||
    asText(row.raw_payload?.address) ||
    ""
  );
}

function orgAddress(org) {
  return (
    asText(org.address_formatted_address) ||
    asText(org.address) ||
    asText(org.custom_fields?.address) ||
    ""
  );
}

function orgPostalCode(org) {
  return (
    postalCodeFromObject(org) ||
    postalCodeFromObject(org.address) ||
    postalCodeFromObject(org.custom_fields) ||
    postalCodeFromAddress(org.address_formatted_address) ||
    postalCodeFromAddress(org.address) ||
    postalCodeFromAddress(org.custom_fields?.address)
  );
}

function orgPhone(org) {
  return asText(org[PHONE_FIELD_KEY] ?? org.custom_fields?.[PHONE_FIELD_KEY] ?? org.phone);
}

function orgWebsite(org) {
  return cleanWebsiteUrl(
    org.website ??
      org[CUSTOM_WEBSITE_FIELD_KEY] ??
      org.custom_fields?.website ??
      org.custom_fields?.[CUSTOM_WEBSITE_FIELD_KEY],
  );
}

function sourceAddress(source) {
  if (source.kind === "company") {
    const addr = source.row.address;
    if (addr && typeof addr === "object") {
      return [addr.street, addr.city, addr.state, addr.postal_code, addr.zip]
        .map(asText)
        .filter(Boolean)
        .join(", ");
    }
  }
  return bestAddress(source.row);
}

function sourcePostalCode(source) {
  if (source.kind === "company") {
    const addr = source.row.address;
    return postalCodeFromObject(addr) || postalCodeFromAddress(sourceAddress(source));
  }
  return (
    postalCodeFromObject(source.row) ||
    postalCodeFromObject(source.row.raw_payload) ||
    postalCodeFromAddress(source.row.address_formatted_address) ||
    postalCodeFromAddress(source.row.address) ||
    postalCodeFromAddress(source.row.raw_payload?.formatted_address) ||
    postalCodeFromAddress(source.row.raw_payload?.address)
  );
}

function sourceName(source) {
  return source.kind === "company" ? asText(source.row.name) : asText(source.row.shop_name);
}

function sourcePhone(source) {
  return asText(source.row.phone);
}

function sourceWebsite(source) {
  return cleanWebsiteUrl(source.row.website);
}

function sourceId(source) {
  return source.kind === "company" ? asText(source.row.id) : asText(source.row.shop_id);
}

function pushIndex(map, key, source) {
  if (!key) return;
  const existing = map.get(key);
  if (existing) existing.push(source);
  else map.set(key, [source]);
}

function uniqueBySourceId(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.kind}:${sourceId(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function overlapScore(a, b) {
  const aParts = new Set(normalizeName(a).split(" ").filter(Boolean));
  const bParts = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (aParts.size === 0 || bParts.size === 0) return 0;
  let hit = 0;
  for (const part of aParts) if (bParts.has(part)) hit += 1;
  return hit / Math.max(aParts.size, bParts.size);
}

function matchReason(org, source, strategy) {
  const pieces = [strategy];
  const op = phone10(orgPhone(org));
  const sp = phone10(sourcePhone(source));
  if (op && sp && op === sp) pieces.push("same 10-digit phone");
  const oz = orgPostalCode(org);
  const sz = sourcePostalCode(source);
  if (oz && sz && oz === sz) pieces.push(`same ZIP ${oz}`);
  if (compactName(org.name) && compactName(org.name) === compactName(sourceName(source))) {
    pieces.push("same normalized name");
  } else if (overlapScore(org.name, sourceName(source)) >= 0.72) {
    pieces.push("strong name overlap");
  }
  return pieces.join("; ");
}

async function fetchPipedrivePage(token, cursor) {
  const url = new URL(`${PIPEDRIVE_BASE}/api/v2/organizations`);
  url.searchParams.set("limit", String(PIPEDRIVE_PAGE_LIMIT));
  if (cursor) url.searchParams.set("cursor", cursor);
  url.searchParams.set("api_token", token);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Pipedrive organization read failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.success === false) throw new Error("Pipedrive organization read returned success=false");
  return {
    data: Array.isArray(body.data) ? body.data : [],
    nextCursor: body.additional_data?.next_cursor ?? null,
  };
}

async function fetchPipedriveOrganizations(token) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 50; page += 1) {
    const { data, nextCursor } = await fetchPipedrivePage(token, cursor);
    out.push(...data);
    if (!nextCursor) return out;
    cursor = nextCursor;
  }
  throw new Error("Pipedrive organization pagination exceeded 50 pages");
}

async function fetchAll(supabase, table, columns, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(columns).range(from, to);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

function buildIndexes(sources) {
  const byPhone = new Map();
  const byNameZip = new Map();
  const byNameStreet = new Map();
  const byNameState = new Map();
  const byName = new Map();
  for (const source of sources) {
    const name = sourceName(source);
    const address = sourceAddress(source);
    pushIndex(byPhone, phone10(sourcePhone(source)), source);
    pushIndex(byNameZip, `${compactName(name)}|${sourcePostalCode(source)}`, source);
    pushIndex(byNameStreet, `${compactName(name)}|${streetKey(address)}`, source);
    pushIndex(byNameState, `${compactName(name)}|${stateFrom(address)}`, source);
    pushIndex(byName, compactName(name), source);
  }
  return { byPhone, byNameZip, byNameStreet, byNameState, byName };
}

function chooseMatch(org, indexes) {
  const name = compactName(org.name);
  const keys = [
    { strategy: "exact_phone", tier: "safe", candidates: indexes.byPhone.get(phone10(orgPhone(org))) ?? [] },
    { strategy: "exact_name_zip", tier: "safe", candidates: indexes.byNameZip.get(`${name}|${orgPostalCode(org)}`) ?? [] },
    { strategy: "exact_name_street", tier: "safe", candidates: indexes.byNameStreet.get(`${name}|${streetKey(orgAddress(org))}`) ?? [] },
    { strategy: "exact_name_state", tier: "review", candidates: indexes.byNameState.get(`${name}|${stateFrom(orgAddress(org))}`) ?? [] },
    { strategy: "exact_name_only", tier: "review", candidates: indexes.byName.get(name) ?? [] },
  ];

  for (const bucket of keys) {
    const candidates = uniqueBySourceId(bucket.candidates);
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (bucket.strategy === "exact_phone" && overlapScore(org.name, sourceName(candidate)) < 0.45) {
        return { tier: "conflict", strategy: bucket.strategy, source: candidate, candidateCount: 1 };
      }
      return { tier: bucket.tier, strategy: bucket.strategy, source: candidate, candidateCount: 1 };
    }
    if (candidates.length > 1) {
      return { tier: "conflict", strategy: bucket.strategy, source: candidates[0], candidateCount: candidates.length };
    }
  }
  return { tier: "unmatched", strategy: "no_match", source: null, candidateCount: 0 };
}

function fieldRows(org, match) {
  if (!match.source) return [];
  const source = match.source;
  const sourceDisplayName = sourceName(source);
  const exactNameMatch = namesMatchExactly(org, source);
  const nameReviewFields = {
    source_name: sourceDisplayName,
    source_exact_name_match: exactNameMatch ? "yes" : "no",
  };
  const sourceValues = {
    address: sourceAddress(source),
    phone: sourcePhone(source),
    website: sourceWebsite(source),
  };
  const orgValues = {
    address: orgAddress(org),
    phone: orgPhone(org),
    website: orgWebsite(org),
  };
  const rows = [];
  for (const field of ["address", "phone", "website"]) {
    const current = orgValues[field];
    const proposed = sourceValues[field];
    if (!proposed) continue;
    const sourceField = field === "address" ? "address" : field;
    if (!current) {
      const category =
        match.tier === "safe" && exactNameMatch ? "safe_fill" : exactNameMatch ? "needs_review_fill" : "name_review";
      rows.push({
        category,
        pipedrive_org_id: org.id,
        pipedrive_org_name: org.name ?? "",
        blank_field_to_fill: field,
        proposed_value: proposed,
        source_table: source.kind === "company" ? "companies" : "body_shops",
        source_id: sourceId(source),
        source_field: sourceField,
        confidence_tier: category === "safe_fill" ? match.tier : "review",
        match_strategy: match.strategy,
        reason: exactNameMatch
          ? matchReason(org, source, match.strategy)
          : `Pipedrive name differs from source name; hold for manual review (${exactDisplayName(org.name)} vs ${exactDisplayName(
              sourceDisplayName,
            )})`,
        candidate_count: match.candidateCount,
        ...nameReviewFields,
      });
    } else if (field === "phone" && phone10(current) && phone10(proposed) && phone10(current) !== phone10(proposed)) {
      rows.push(conflictRow(org, source, field, current, proposed, match));
    } else if (field === "website" && normalizeUrl(current) && normalizeUrl(proposed) && normalizeUrl(current) !== normalizeUrl(proposed)) {
      rows.push(conflictRow(org, source, field, current, proposed, match));
    } else if (
      field === "address" &&
      postalCodeFromAddress(current) &&
      postalCodeFromAddress(proposed) &&
      postalCodeFromAddress(current) !== postalCodeFromAddress(proposed)
    ) {
      rows.push(conflictRow(org, source, field, current, proposed, match));
    }
  }
  return rows;
}

function conflictRow(org, source, field, current, proposed, match) {
  const exactNameMatch = namesMatchExactly(org, source);
  return {
    category: exactNameMatch ? "existing_conflict" : "name_review",
    pipedrive_org_id: org.id,
    pipedrive_org_name: org.name ?? "",
    blank_field_to_fill: "",
    existing_field: field,
    existing_value: current,
    proposed_value: proposed,
    source_table: source.kind === "company" ? "companies" : "body_shops",
    source_id: sourceId(source),
    source_field: field,
    confidence_tier: "conflict",
    match_strategy: match.strategy,
    reason: exactNameMatch
      ? `Pipedrive already has a different ${field}; review before any overwrite`
      : `Pipedrive name differs from source name; hold for manual review before considering the ${field} conflict (${exactDisplayName(
          org.name,
        )} vs ${exactDisplayName(sourceName(source))})`,
    candidate_count: match.candidateCount,
    source_name: sourceName(source),
    source_exact_name_match: exactNameMatch ? "yes" : "no",
  };
}

function toCsv(rows) {
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()),
  );
  const esc = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => esc(row[h])).join(","))].join("\n") + "\n";
}

function writeJson(fileName, value) {
  fs.writeFileSync(path.join(OUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

function writeCsv(fileName, rows) {
  fs.writeFileSync(path.join(OUT_DIR, fileName), toCsv(rows));
}

function writeMarkdown(summary, proposedRows, reviewRows, nameReviewRows, urlCleanupRows) {
  const md = `# ${path.basename(OUT_DIR)} Pipedrive Contact Cleanup Dry Run

Generated: ${GENERATED_AT}

## Bottom Line

This is a dry-run report only. It read Pipedrive organizations and PSG-owned Supabase shop data, then produced proposed fills for blank address, phone, and website fields. No Pipedrive records were modified.

## Counts

| Metric | Count |
| --- | ---: |
| Pipedrive organizations read | ${summary.pipedriveOrganizations} |
| Supabase body shop directory rows read | ${summary.bodyShopRows} |
| Internal company rows read | ${summary.companyRows} |
| Organizations missing address | ${summary.missing.address} |
| Organizations missing phone | ${summary.missing.phone} |
| Organizations missing website | ${summary.missing.website} |
| Matched organizations | ${summary.matchedOrganizations} |
| Unmatched organizations | ${summary.unmatchedOrganizations} |
| Safe proposed fills | ${summary.safeFillRows} |
| Review proposed fills | ${summary.reviewFillRows} |
| Name differences held for review | ${summary.nameReviewRows} |
| Existing conflicts for review | ${summary.conflictRows} |

## Match Rules

- Proposed update: one unique source match by exact 10-digit phone, exact normalized name plus verified postal ZIP, or exact normalized name plus street key, and the Pipedrive shop name must exactly match the source shop name after trimming extra spaces.
- Name review: any Pipedrive/source shop-name difference, including punctuation, spacing, suffix, or word-boundary differences. These are held even when phone, ZIP, or normalized name evidence looks strong.
- Review: one unique source match by exact normalized name plus state, or exact normalized name only.
- Conflict: more than one possible source match, weak name evidence on a phone match, unverified postal evidence, or Pipedrive already has a different value.
- Unmatched: no usable corroborating source row.

## Files

- \`pipedrive_contact_cleanup_summary.json\`: machine-readable counts and run metadata.
- \`pipedrive_contact_cleanup_proposed_updates.csv\`: proposed fills that are safe candidates for QA sampling.
- \`pipedrive_contact_cleanup_name_review.csv\`: all rows where the Pipedrive shop name and source shop name are not an exact display-name match.
- \`pipedrive_contact_cleanup_review_items.csv\`: lower-confidence fills, conflicts, and unmatched organizations for manual review.
- \`pipedrive_contact_cleanup_url_cleanup_examples.csv\`: website examples that show URL normalization/cleanup cases for QA.
- \`pipedrive_contact_cleanup_all_rows.csv\`: all proposed/review rows in one file.

## QA Sample Guidance

Tess should sample-check proposed update rows by confirming the proposed value against the linked Supabase source row and the public shop website or Google listing when needed. Name-review rows and other review rows should not be auto-filled until Nick approves the specific shop match or a written normalization rule.

## Proposed Update Sample

${proposedRows.slice(0, 10).map((row) => `- Org ${row.pipedrive_org_id} (${row.pipedrive_org_name}) ${row.blank_field_to_fill}: ${row.proposed_value} — ${row.reason}`).join("\n") || "- No proposed update rows generated."}

## Name Review Sample

${nameReviewRows.slice(0, 10).map((row) => `- Org ${row.pipedrive_org_id} (${row.pipedrive_org_name}) vs ${row.source_name || "unknown source"}: ${row.reason}`).join("\n") || "- No name-review rows generated."}

## Review Item Sample

${reviewRows.slice(0, 10).map((row) => `- Org ${row.pipedrive_org_id} (${row.pipedrive_org_name}) ${row.category}: ${row.reason}`).join("\n") || "- No review rows generated."}

## URL Cleanup Example Sample

${urlCleanupRows.slice(0, 10).map((row) => `- Org ${row.pipedrive_org_id} (${row.pipedrive_org_name}) ${row.url_cleanup_reason}: ${row.original_url} -> ${row.normalized_url}`).join("\n") || "- No URL cleanup example rows generated."}
`;
  fs.writeFileSync(path.join(OUT_DIR, "pipedrive_contact_cleanup_report.md"), md);
}

function urlCleanupExamples(rows) {
  return rows
    .filter((row) => row.source_field === "website" || row.blank_field_to_fill === "website" || row.existing_field === "website")
    .map((row) => {
      const original = row.proposed_value || row.existing_value || "";
      const normalized = normalizeUrl(original);
      const hasTracking =
        /(%3f|%26|utm_|y_source|gclid|fbclid|\?)/i.test(original) || /%25/i.test(original);
      const changed = original && normalized && original !== normalized;
      return {
        pipedrive_org_id: row.pipedrive_org_id,
        pipedrive_org_name: row.pipedrive_org_name,
        source_name: row.source_name || "",
        category: row.category,
        original_url: original,
        normalized_url: normalized,
        url_cleanup_reason: hasTracking
          ? "tracking-or-encoded-url"
          : changed
            ? "scheme-www-or-trailing-slash-normalization"
            : "website-review-example",
      };
    })
    .filter((row) => row.original_url && (row.url_cleanup_reason !== "website-review-example" || row.category !== "safe_fill"))
    .slice(0, 100);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pipedriveToken = requiredEnv("PIPEDRIVE_API_TOKEN", ["PIPEDRIVE_TOKEN", "PIPEDRIVE_API_KEY"]);
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [orgs, bodyShops, companies] = await Promise.all([
    fetchPipedriveOrganizations(pipedriveToken),
    fetchAll(supabase, "body_shops", "shop_id,shop_name,place_id,address,phone,website,raw_payload"),
    fetchAll(supabase, "companies", "id,shop_id,name,address,phone,contact"),
  ]);

  const sources = [
    ...bodyShops.map((row) => ({ kind: "body_shop", row })),
    ...companies.map((row) => ({ kind: "company", row })),
  ];
  const indexes = buildIndexes(sources);
  const allRows = [];
  const unmatchedRows = [];
  let matchedOrganizations = 0;

  const missing = { address: 0, phone: 0, website: 0 };
  for (const org of orgs) {
    if (!orgAddress(org)) missing.address += 1;
    if (!orgPhone(org)) missing.phone += 1;
    if (!orgWebsite(org)) missing.website += 1;

    const match = chooseMatch(org, indexes);
    if (match.source) {
      matchedOrganizations += 1;
      allRows.push(...fieldRows(org, match));
    } else {
      unmatchedRows.push({
        category: "unmatched",
        pipedrive_org_id: org.id,
        pipedrive_org_name: org.name ?? "",
        confidence_tier: "unmatched",
        match_strategy: "no_match",
        reason: "No unique source row found using phone, name plus ZIP/address, or normalized name.",
      });
    }
  }
  allRows.push(...unmatchedRows);

  const safeRows = allRows.filter((row) => row.category === "safe_fill");
  const reviewRows = allRows.filter((row) => row.category !== "safe_fill");
  const nameReviewRows = allRows.filter((row) => row.category === "name_review");
  const urlCleanupRows = urlCleanupExamples(allRows);
  const summary = {
    generatedAt: GENERATED_AT,
    dryRunOnly: true,
    pipedriveOrganizations: orgs.length,
    bodyShopRows: bodyShops.length,
    companyRows: companies.length,
    missing,
    matchedOrganizations,
    unmatchedOrganizations: unmatchedRows.length,
    safeFillRows: safeRows.length,
    reviewFillRows: allRows.filter((row) => row.category === "needs_review_fill").length,
    nameReviewRows: nameReviewRows.length,
    conflictRows: allRows.filter((row) => row.category === "existing_conflict").length,
    reviewRowsTotal: reviewRows.length,
    matchPolicy: {
      proposedUpdates: [
        "exact display-name match plus one safe source strategy: exact_phone, exact_name_zip, or exact_name_street",
      ],
      nameReview:
        "any display-name difference between the Pipedrive organization and the selected source row is held for manual review",
      safe: ["exact_phone", "exact_name_zip", "exact_name_street"],
      review: ["exact_name_state", "exact_name_only"],
      conflict:
        "multiple candidates, weak phone/name evidence, unverified postal evidence, existing Pipedrive value differs, or display names differ",
      postalCodeEvidence:
        "ZIP matching only uses structured postal-code fields or a postal-code ending in a city/state/postal address line; street numbers are ignored.",
    },
    fieldKeys: {
      pipedrivePhone: PHONE_FIELD_KEY,
      pipedriveCustomWebsite: CUSTOM_WEBSITE_FIELD_KEY,
      pipedriveAddress: "address",
    },
  };

  writeJson("pipedrive_contact_cleanup_summary.json", summary);
  writeCsv("pipedrive_contact_cleanup_safe_fills.csv", safeRows);
  writeCsv("pipedrive_contact_cleanup_proposed_updates.csv", safeRows);
  writeCsv("pipedrive_contact_cleanup_name_review.csv", nameReviewRows);
  writeCsv("pipedrive_contact_cleanup_review_items.csv", reviewRows);
  writeCsv("pipedrive_contact_cleanup_url_cleanup_examples.csv", urlCleanupRows);
  writeCsv("pipedrive_contact_cleanup_all_rows.csv", allRows);
  writeMarkdown(summary, safeRows, reviewRows, nameReviewRows, urlCleanupRows);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
