#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

const OUT_DIR = path.resolve("artifacts/PSG-2059");
const GENERATED_AT = new Date().toISOString();

const PIPEDRIVE_FIELD_KEYS = {
  psgId: "f9036ab08f3060c05153ff91d2085270a935a8b4",
  status: "d951c5339056146e633711ba1451baa420b60aa0",
  phone: "04b2473348bdf2df769dcc3d40323bd319465965",
  portalCustomer: "5368733239b9b8f92c83b4ebc2fd2c083bfc0977",
  databaseName: "e1ef5b453f53bd9df792f5145a5a8fd80d20a5aa",
  displayName: "d6dfb1cfee548ef9e680962ddcbce413a3fda68d",
  quickBooksCustomerId: "921b3b004023b2835a58ac99f31c1704df773974",
  msoNumber: "d75f2d24f4b1c2c1eb0bba235a116723ec40d7ed",
};

const ACTION_COLUMNS = [
  "generated_at",
  "pipedrive_org_id",
  "pipedrive_org_name",
  "target_field_name",
  "target_field_key",
  "current_value",
  "proposed_value",
  "source_system",
  "source_id",
  "source_field",
  "match_strategy",
  "match_reason",
  "classification",
  "hold_reason",
  "requires_nick_approval",
  "source_name",
  "source_address",
  "source_city",
  "source_state",
  "source_postal_code",
  "source_phone",
  "source_website",
  "source_psg_id",
];

const INVENTORY_COLUMNS = [
  "generated_at",
  "source_system",
  "source_id",
  "source_name",
  "source_psg_id",
  "source_address",
  "source_city",
  "source_state",
  "source_postal_code",
  "source_phone",
  "source_website",
  "match_strategy",
  "confidence",
  "pipedrive_org_id",
  "pipedrive_org_name",
  "pipedrive_psg_id",
  "pipedrive_address",
  "pipedrive_phone",
  "pipedrive_website",
  "address_check",
  "proposed_action_count",
  "review_reason",
  "evidence",
];

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|llc|l\.l\.c|corp|corporation|co|company|ltd|limited)\b/g, " ")
    .replace(/\b(auto body|autobody|body shop|collision repair|collision center|collision|paint and body|paint body|glass)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeState(value) {
  return clean(value).toUpperCase().slice(0, 2);
}

function normalizePsgId(value) {
  const raw = clean(value).toUpperCase().replace(/\s+/g, "");
  const match = raw.match(/PS[-_]?(\d+)/);
  return match ? `PS${match[1]}` : raw;
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : "";
}

function normalizeDomain(value) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "";
  const cleaned = cleanWebsiteUrl(raw);
  try {
    const url = new URL(cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}

const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "gclid",
  "fbclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "mcmid",
  "y_source",
]);

function decodeUrlOnce(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanWebsiteUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  const decoded = decodeUrlOnce(raw);
  try {
    const url = new URL(decoded.startsWith("http") ? decoded : `https://${decoded}`);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_KEYS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    if (url.hostname.toLowerCase().endsWith("google.com") && url.pathname === "/url") {
      const target = url.searchParams.get("q") || url.searchParams.get("url");
      return cleanWebsiteUrl(target);
    }
    url.hash = "";
    return url.toString();
  } catch {
    const stripped = decoded.split(/[?#]/)[0];
    return stripped || decoded;
  }
}

function hasWebsiteTracking(value) {
  const decoded = decodeUrlOnce(clean(value));
  return /(?:[?&]|%3[fF]|%26)(?:utm_[^=&%]*|gclid|fbclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|mcmid|y_source|adurl)=/i.test(decoded)
    || /google\.com\/url/i.test(decoded);
}

function normalizeAddress(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(highway)\b/g, "hwy")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAddressParts(address) {
  const text = clean(address);
  const match = text.match(/,\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:,|$)/);
  if (match) return { city: match[1].trim(), state: match[2], postalCode: match[3] };
  const fallback = text.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
  return fallback ? { city: "", state: fallback[1], postalCode: fallback[2] } : { city: "", state: "", postalCode: "" };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function similarity(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

function parseCsvLine(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      out.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  out.push(value);
  return out;
}

async function readCsvRows(filePath, onRow, { limit = Infinity } = {}) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  let count = 0;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const fields = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ""]));
    await onRow(row);
    count += 1;
    if (count >= limit) break;
  }
  return count;
}

function addUnique(map, row) {
  const nameKey = normalizeName(row.name);
  const psgKey = normalizePsgId(row.psgId);
  const stateKey = normalizeState(row.state);
  const postalKey = clean(row.postalCode).slice(0, 5);
  const fallback = `${row.sourceSystem}:${row.sourceId}`;
  const key = psgKey || (nameKey ? `${nameKey}|${stateKey}|${postalKey}` : fallback);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...row, evidenceCount: 1, sourceSystems: new Set([row.sourceSystem]) });
    return;
  }
  existing.evidenceCount += 1;
  existing.sourceSystems.add(row.sourceSystem);
  for (const field of ["psgId", "address", "city", "state", "postalCode", "phone", "website"]) {
    if (!clean(existing[field]) && clean(row[field])) existing[field] = row[field];
  }
}

async function loadFileMakerRows() {
  const sources = new Map();
  const add = (sourceSystem, sourceId, name, psgId, detail = "") => {
    if (!clean(name) && !clean(psgId)) return;
    addUnique(sources, {
      sourceSystem,
      sourceId,
      name: clean(name),
      psgId: normalizePsgId(psgId),
      address: "",
      city: "",
      state: "",
      postalCode: "",
      phone: "",
      website: "",
      detail,
    });
  };

  await readCsvRows("docs/Filemaker Exports/repair-customer_nick.csv", (row) => {
    add("FileMaker repair customers", row.RC_MatchField_Master, row.RC_Shop, row.RC_MatchField_Master);
  });
  await readCsvRows("docs/Filemaker Exports/Repair Customer Export - 01-01-18...12-31-20.csv", (row) => {
    add("FileMaker repair customer export 2018-2020", row.RC_MatchField_Master, row.RC_Shop, row.RC_MatchField_Master);
  });
  await readCsvRows("docs/Filemaker Exports/Customer Names/Customer Names/csv3.csv", (row) => {
    add("FileMaker customer names csv3", row.BusinessKeyPSG, row.BUName, row.BusinessKeyPSG);
  });
  return Array.from(sources.values()).map((row) => ({
    ...row,
    sourceSystem: `${row.sourceSystem} aggregate`,
    detail: `FileMaker evidence rows: ${row.evidenceCount}; systems: ${Array.from(row.sourceSystems).join("; ")}`,
  }));
}

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function selectAll(sb, table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`Supabase ${table} read failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function loadSupabaseRows() {
  const sb = supabaseClient();
  const [bodyShops, shops, clients, invoiced, invoicedCache, locations, profiles] = await Promise.all([
    selectAll(sb, "body_shops", "shop_id,shop_name,place_id,address,phone,website,source,imported_at"),
    selectAll(sb, "shops", "id,name,url,telephone,address_street,address_locality,address_region,address_postal_code,address_country,google_place_id,slug"),
    selectAll(sb, "clients", "id,name,website_url,zip_code,primary_market"),
    selectAll(sb, "invoiced_customers", "invoiced_id,psg_id,name,city,state,parent_invoiced_id,imported_at"),
    selectAll(sb, "invoiced_customer_cache", "invoiced_id,psg_id,name,city,state,parent_invoiced_id,synced_at"),
    selectAll(sb, "locations", "id,shop_id,name,is_primary"),
    selectAll(sb, "location_profiles", "id,location_id,address,phone,website"),
  ]);

  const locationById = new Map(locations.map((location) => [location.id, location]));
  const rows = [];
  for (const row of bodyShops) {
    const parsed = parseAddressParts(row.address);
    rows.push({
      sourceSystem: "Supabase Google Business Profile body_shops",
      sourceId: row.place_id || row.shop_id,
      name: row.shop_name,
      psgId: "",
      address: row.address,
      city: parsed.city,
      state: parsed.state,
      postalCode: parsed.postalCode,
      phone: row.phone,
      website: row.website,
      detail: `source=${row.source || ""}; imported_at=${row.imported_at || ""}`,
    });
  }
  for (const row of shops) {
    rows.push({
      sourceSystem: "Supabase shops",
      sourceId: row.id,
      name: row.name,
      psgId: "",
      address: [row.address_street, row.address_locality, row.address_region, row.address_postal_code, row.address_country].filter(Boolean).join(", "),
      city: row.address_locality,
      state: row.address_region,
      postalCode: row.address_postal_code,
      phone: row.telephone,
      website: row.url,
      detail: `slug=${row.slug || ""}; google_place_id=${row.google_place_id || ""}`,
    });
  }
  for (const row of clients) {
    rows.push({
      sourceSystem: "Supabase clients",
      sourceId: row.id,
      name: row.name,
      psgId: "",
      address: "",
      city: row.primary_market,
      state: "",
      postalCode: row.zip_code,
      phone: "",
      website: row.website_url,
      detail: "client registry row",
    });
  }
  for (const row of invoiced) {
    rows.push({
      sourceSystem: "Supabase Invoiced customers",
      sourceId: row.invoiced_id,
      name: row.name,
      psgId: row.psg_id,
      address: "",
      city: row.city,
      state: row.state,
      postalCode: "",
      phone: "",
      website: "",
      detail: `parent_invoiced_id=${row.parent_invoiced_id || ""}; imported_at=${row.imported_at || ""}`,
    });
  }
  for (const row of invoicedCache) {
    rows.push({
      sourceSystem: "Supabase Invoiced customer cache",
      sourceId: row.invoiced_id,
      name: row.name,
      psgId: row.psg_id,
      address: "",
      city: row.city,
      state: row.state,
      postalCode: "",
      phone: "",
      website: "",
      detail: `parent_invoiced_id=${row.parent_invoiced_id || ""}; synced_at=${row.synced_at || ""}`,
    });
  }
  for (const profile of profiles) {
    const location = locationById.get(profile.location_id);
    const parsed = parseAddressParts(profile.address);
    rows.push({
      sourceSystem: "Supabase Google Business Profile location_profiles",
      sourceId: profile.id,
      name: location?.name || "",
      psgId: "",
      address: profile.address,
      city: parsed.city,
      state: parsed.state,
      postalCode: parsed.postalCode,
      phone: profile.phone,
      website: profile.website,
      detail: `location_id=${profile.location_id}; shop_id=${location?.shop_id || ""}; is_primary=${location?.is_primary ?? ""}`,
    });
  }
  return rows.filter((row) => clean(row.name) || clean(row.psgId));
}

function pipedriveToken() {
  return process.env.PIPEDRIVE_API_KEY || process.env.PIPEDRIVE_API_TOKEN || process.env.PIPEDRIVE_TOKEN;
}

async function pipedriveRequest(pathName) {
  const token = pipedriveToken();
  if (!token) throw new Error("Missing Pipedrive API token");
  const url = new URL(`https://api.pipedrive.com/api/v1${pathName}`);
  url.searchParams.set("api_token", token);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Pipedrive GET ${pathName} returned HTTP ${res.status}`);
  const json = await res.json();
  if (json?.success === false) throw new Error(`Pipedrive GET ${pathName} returned success=false`);
  return json;
}

async function loadPipedriveOrganizations() {
  const out = [];
  for (let start = 0, page = 0; page < 1000; page += 1) {
    const json = await pipedriveRequest(`/organizations?start=${start}&limit=500`);
    out.push(...(Array.isArray(json.data) ? json.data : []));
    const pagination = json.additional_data?.pagination;
    if (!pagination?.more_items_in_collection) return out.map(normalizePipedriveOrg);
    start = Number(pagination.next_start);
    if (!Number.isFinite(start)) throw new Error("Pipedrive pagination did not return next_start");
  }
  throw new Error("Pipedrive pagination exceeded 1000 pages");
}

function normalizePipedriveOrg(org) {
  return {
    id: org.id,
    name: clean(org.name),
    psgId: normalizePsgId(org[PIPEDRIVE_FIELD_KEYS.psgId]),
    status: clean(org[PIPEDRIVE_FIELD_KEYS.status]),
    address: clean(org.address_formatted_address || org.address),
    city: clean(org.address_locality),
    state: clean(org.address_admin_area_level_1),
    postalCode: clean(org.address_postal_code),
    phone: clean(org[PIPEDRIVE_FIELD_KEYS.phone] || org.phone),
    website: cleanWebsiteUrl(org.website),
    addTime: clean(org.add_time),
    updateTime: clean(org.update_time),
    raw: org,
  };
}

function buildIndex(orgs) {
  const index = {
    byPsgId: new Map(),
    byPhone: new Map(),
    byDomain: new Map(),
    byNameState: new Map(),
    byName: new Map(),
    byFirstToken: new Map(),
  };
  const push = (map, key, org) => {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(org);
    map.set(key, list);
  };
  for (const org of orgs) {
    push(index.byPsgId, org.psgId, org);
    push(index.byPhone, normalizePhone(org.phone), org);
    push(index.byDomain, normalizeDomain(org.website), org);
    push(index.byNameState, `${normalizeName(org.name)}|${normalizeState(org.state)}`, org);
    const orgName = normalizeName(org.name);
    push(index.byName, orgName, org);
    push(index.byFirstToken, orgName.split(" ")[0], org);
  }
  return index;
}

function chooseMatch(source, index) {
  const psgId = normalizePsgId(source.psgId);
  const phone = normalizePhone(source.phone);
  const domain = normalizeDomain(source.website);
  const name = normalizeName(source.name);
  const state = normalizeState(source.state);
  const strategies = [
    ["exact_psg_id", index.byPsgId.get(psgId) || []],
    ["exact_phone", index.byPhone.get(phone) || []],
    ["exact_website_domain", index.byDomain.get(domain) || []],
    ["exact_name_state", index.byNameState.get(`${name}|${state}`) || []],
    ["exact_name_only", index.byName.get(name) || []],
  ].filter(([, list]) => list.length > 0);

  if (strategies.length === 0) {
    const firstToken = name.split(" ")[0];
    const candidates = firstToken && firstToken.length >= 4 ? index.byFirstToken.get(firstToken) || [] : [];
    if (candidates.length > 300) {
      return { org: null, strategy: "unmatched", confidence: "unmatched", reason: "No exact Pipedrive match. Fuzzy review skipped because the first-token candidate set is too broad." };
    }
    const fuzzy = [];
    for (const org of candidates) {
      const score = similarity(name, org.name);
      if (score >= 0.88) fuzzy.push({ org, score });
    }
    fuzzy.sort((a, b) => b.score - a.score);
    if (fuzzy.length === 1 || (fuzzy[0] && fuzzy[0].score - (fuzzy[1]?.score ?? 0) >= 0.06)) {
      return { org: fuzzy[0].org, strategy: "fuzzy_name", confidence: "review", reason: `fuzzy_name score=${fuzzy[0].score.toFixed(2)}` };
    }
    return { org: null, strategy: "unmatched", confidence: "unmatched", reason: "No Pipedrive organization matched by PSG ID, phone, website, name+state, or strong fuzzy name." };
  }

  const [strategy, list] = strategies[0];
  const unique = new Map(list.map((org) => [org.id, org]));
  if (unique.size > 1) {
    return { org: Array.from(unique.values())[0], strategy, confidence: "review", reason: `${strategy} matched ${unique.size} Pipedrive organizations.` };
  }
  const org = Array.from(unique.values())[0];
  const score = similarity(source.name, org.name);
  const strongName = score >= 0.92 || normalizeName(source.name) === normalizeName(org.name);
  const high = strategy === "exact_psg_id" || (["exact_phone", "exact_website_domain", "exact_name_state"].includes(strategy) && strongName);
  return { org, strategy, confidence: high ? "matched" : "review", reason: `${strategy}; name_similarity=${score.toFixed(2)}` };
}

function addressCheck(source, org) {
  if (!org) return "unmatched";
  const sourceAddress = normalizeAddress(source.address);
  const orgAddress = normalizeAddress(org.address);
  if (!sourceAddress && !orgAddress) return "both_missing_address";
  if (sourceAddress && !orgAddress) return "pipedrive_missing_address";
  if (!sourceAddress && orgAddress) return "source_missing_address";
  if (sourceAddress === orgAddress || sourceAddress.includes(orgAddress) || orgAddress.includes(sourceAddress)) return "address_matches";
  return "address_conflict_or_stale";
}

function actionRows(source, match, addressStatus) {
  if (!match.org) return [];
  const org = match.org;
  const rows = [];
  const fieldSpecs = [
    ["PSG ID", PIPEDRIVE_FIELD_KEYS.psgId, org.psgId, normalizePsgId(source.psgId), "source_psg_id"],
    ["Phone", PIPEDRIVE_FIELD_KEYS.phone, org.phone, source.phone, "source_phone"],
    ["Website", "website", org.website, source.website, "source_website"],
    ["Address", "address", org.address, source.address, "source_address"],
  ];

  for (const [name, key, current, proposedRaw, sourceField] of fieldSpecs) {
    const proposed = name === "Website" ? cleanWebsiteUrl(proposedRaw) : clean(proposedRaw);
    if (!proposed) continue;
    let classification = "skipped";
    let holdReason = "";
    let requiresNickApproval = "false";
    if (!clean(current)) {
      const safeStrategy = ["exact_psg_id", "exact_phone", "exact_website_domain", "exact_name_state"].includes(match.strategy);
      const safeName = similarity(source.name, org.name) >= 0.92 || match.strategy === "exact_psg_id";
      const addressSafe = name !== "Address" || ["pipedrive_missing_address", "address_matches"].includes(addressStatus);
      if (match.confidence === "matched" && safeStrategy && safeName && addressSafe) {
        classification = "safe_fill";
      } else if (match.confidence === "review") {
        classification = "name_review";
        holdReason = "Match needs human review before any blank field can be filled.";
      } else {
        classification = "weak_match";
        holdReason = "Match is not strong enough for an automatic blank-field fill.";
      }
    } else if (name === "Address" && addressStatus === "address_conflict_or_stale") {
      classification = "existing_conflict";
      holdReason = "Pipedrive and source address differ. This may be stale data, duplicate locations, or a name collision.";
      requiresNickApproval = "true";
    } else {
      const currentComparable = name === "Phone" ? normalizePhone(current) : name === "Website" ? normalizeDomain(current) : name === "Address" ? normalizeAddress(current) : normalizePsgId(current);
      const proposedComparable = name === "Phone" ? normalizePhone(proposed) : name === "Website" ? normalizeDomain(proposed) : name === "Address" ? normalizeAddress(proposed) : normalizePsgId(proposed);
      if (currentComparable && proposedComparable && currentComparable === proposedComparable) {
        classification = "already_current";
      } else {
        classification = "existing_conflict";
        holdReason = "Pipedrive already has a different value. Do not overwrite automatically.";
        requiresNickApproval = "true";
      }
    }
    if (name === "Website" && classification === "safe_fill" && hasWebsiteTracking(proposed)) {
      classification = "needs_review_fill";
      holdReason = "Website still contains campaign or referral tracking after cleanup; review before any blank-field fill.";
      requiresNickApproval = "true";
    }
    rows.push({
      generated_at: GENERATED_AT,
      pipedrive_org_id: org.id,
      pipedrive_org_name: org.name,
      target_field_name: name,
      target_field_key: key,
      current_value: current,
      proposed_value: proposed,
      source_system: source.sourceSystem,
      source_id: source.sourceId,
      source_field: sourceField,
      match_strategy: match.strategy,
      match_reason: match.reason,
      classification,
      hold_reason: holdReason,
      requires_nick_approval: requiresNickApproval,
      source_name: source.name,
      source_address: source.address,
      source_city: source.city,
      source_state: source.state,
      source_postal_code: source.postalCode,
      source_phone: source.phone,
      source_website: cleanWebsiteUrl(source.website),
      source_psg_id: source.psgId,
    });
  }
  return rows;
}

function toCsv(rows, columns) {
  const escape = (value) => {
    const text = clean(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => escape(row[column])).join(",")).join("\n")}\n`;
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row[field] || "blank";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topN(rows, field, n = 20) {
  return Object.entries(countBy(rows, field))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function buildMarkdown(summary) {
  return `# PSG-2059 Customer Inventory Dry Run

Generated: ${summary.generatedAt}

## Bottom line

This was a dry run only. No Pipedrive, Invoiced, FileMaker, or Supabase records were changed.

The inventory found ${summary.counts.totalSourceRows.toLocaleString()} customer/source rows across FileMaker, Invoiced-derived Supabase tables, Supabase shop/location tables, Google Business Profile address data, and live Pipedrive organizations. It produced ${summary.counts.safeBlankFills.toLocaleString()} proposed safe blank-field fills and ${summary.counts.reviewHolds.toLocaleString()} rows that need human review before any write-back.

## Counts

| Measure | Count |
| --- | ---: |
| Pipedrive organizations read | ${summary.counts.pipedriveOrganizations.toLocaleString()} |
| Source rows after aggregation | ${summary.counts.totalSourceRows.toLocaleString()} |
| Matched rows | ${summary.counts.matchedRows.toLocaleString()} |
| Unmatched rows | ${summary.counts.unmatchedRows.toLocaleString()} |
| Safe blank-field fills | ${summary.counts.safeBlankFills.toLocaleString()} |
| Already-current field checks | ${summary.counts.alreadyCurrent.toLocaleString()} |
| Existing conflicts / possible stale values | ${summary.counts.existingConflicts.toLocaleString()} |
| Human-review action rows | ${summary.counts.reviewHolds.toLocaleString()} |

## Proposed next step

Approve a reviewed write-back pass only for the safe blank-field fills after Tess samples the CSV. Do not approve overwrites yet. Address conflicts, name-only matches, fuzzy matches, and unmatched records should stay in manual review because they may represent duplicate locations, stale addresses, or different shops with similar names.

## Output files

- \`psg2059_customer_inventory_all.csv\`
- \`psg2059_pipedrive_standardization_actions.csv\`
- \`psg2059_safe_blank_fills.csv\`
- \`psg2059_review_holds.csv\`
- \`psg2059_customer_inventory_summary.json\`

## Guardrails used

- No live writes.
- Existing Pipedrive values are never overwritten in the safe-fill bucket.
- Exact PSG ID is the strongest match.
- Exact phone or website matches require a close organization-name match before a blank field is considered safe.
- Name-only, fuzzy, duplicate, ambiguous, and address-conflict rows require human review.
`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const [fileMakerRows, supabaseRows, pipedriveOrgs] = await Promise.all([
    loadFileMakerRows(),
    loadSupabaseRows(),
    loadPipedriveOrganizations(),
  ]);

  const index = buildIndex(pipedriveOrgs);
  const sourceMap = new Map();
  for (const row of [...fileMakerRows, ...supabaseRows]) addUnique(sourceMap, row);
  const sourceRows = Array.from(sourceMap.values()).map((row) => ({
    ...row,
    sourceSystem: Array.from(row.sourceSystems ?? [row.sourceSystem]).join("; "),
  }));

  const inventory = [];
  const actions = [];
  for (const source of sourceRows) {
    const match = chooseMatch(source, index);
    const addressStatus = addressCheck(source, match.org);
    const rowActions = actionRows(source, match, addressStatus);
    actions.push(...rowActions);
    inventory.push({
      generated_at: GENERATED_AT,
      source_system: source.sourceSystem,
      source_id: source.sourceId,
      source_name: source.name,
      source_psg_id: source.psgId,
      source_address: source.address,
      source_city: source.city,
      source_state: source.state,
      source_postal_code: source.postalCode,
      source_phone: source.phone,
      source_website: cleanWebsiteUrl(source.website),
      match_strategy: match.strategy,
      confidence: match.confidence,
      pipedrive_org_id: match.org?.id ?? "",
      pipedrive_org_name: match.org?.name ?? "",
      pipedrive_psg_id: match.org?.psgId ?? "",
      pipedrive_address: match.org?.address ?? "",
      pipedrive_phone: match.org?.phone ?? "",
      pipedrive_website: cleanWebsiteUrl(match.org?.website ?? ""),
      address_check: addressStatus,
      proposed_action_count: rowActions.length,
      review_reason: match.confidence === "review" ? match.reason : addressStatus === "address_conflict_or_stale" ? "Address conflict or stale address candidate." : "",
      evidence: source.detail || "",
    });
  }

  const safe = actions.filter((row) => row.classification === "safe_fill");
  const review = actions.filter((row) => !["safe_fill", "already_current", "skipped"].includes(row.classification));
  const summary = {
    generatedAt: GENERATED_AT,
    dryRunOnly: true,
    liveWrites: 0,
    fieldKeyMap: PIPEDRIVE_FIELD_KEYS,
    counts: {
      pipedriveOrganizations: pipedriveOrgs.length,
      fileMakerRows: fileMakerRows.length,
      supabaseRows: supabaseRows.length,
      totalSourceRows: sourceRows.length,
      matchedRows: inventory.filter((row) => row.pipedrive_org_id).length,
      unmatchedRows: inventory.filter((row) => !row.pipedrive_org_id).length,
      proposedActionRows: actions.length,
      safeBlankFills: safe.length,
      alreadyCurrent: actions.filter((row) => row.classification === "already_current").length,
      existingConflicts: actions.filter((row) => row.classification === "existing_conflict").length,
      reviewHolds: review.length,
    },
    byClassification: countBy(actions, "classification"),
    byTargetField: countBy(actions, "target_field_name"),
    inventoryByMatchStrategy: countBy(inventory, "match_strategy"),
    inventoryByAddressCheck: countBy(inventory, "address_check"),
    topReviewHoldReasons: topN(review, "hold_reason"),
    outputFiles: [
      "psg2059_customer_inventory_all.csv",
      "psg2059_pipedrive_standardization_actions.csv",
      "psg2059_safe_blank_fills.csv",
      "psg2059_review_holds.csv",
      "psg2059_customer_inventory_summary.json",
      "psg2059_customer_inventory_report.md",
    ],
  };

  await Promise.all([
    writeFile(path.join(OUT_DIR, "psg2059_customer_inventory_all.csv"), toCsv(inventory, INVENTORY_COLUMNS)),
    writeFile(path.join(OUT_DIR, "psg2059_pipedrive_standardization_actions.csv"), toCsv(actions, ACTION_COLUMNS)),
    writeFile(path.join(OUT_DIR, "psg2059_safe_blank_fills.csv"), toCsv(safe, ACTION_COLUMNS)),
    writeFile(path.join(OUT_DIR, "psg2059_review_holds.csv"), toCsv(review, ACTION_COLUMNS)),
    writeFile(path.join(OUT_DIR, "psg2059_customer_inventory_summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(path.join(OUT_DIR, "psg2059_customer_inventory_report.md"), buildMarkdown(summary)),
  ]);

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
