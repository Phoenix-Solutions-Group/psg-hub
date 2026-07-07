#!/usr/bin/env node
// PSG-825 — create the 12 Group-B "pre-CRM maintenance shop" Pipedrive ORG RECORDS ONLY
// (NO deals) and print the RECURRING_MAINTENANCE_SUPPLEMENT env value to load in Vercel prod.
//
// WHY: these 12 shops have been on Website Hosting & Management (WHM) since before we used
// Pipedrive, so there is no sale to record. Nick ruled on PSG-819 that we fold them into the
// monthly maintenance cycle WITHOUT fabricating won deals (no invented amounts/dates that
// would distort revenue reporting). An org record with no deal keeps sales/revenue clean while
// giving the recurring engine the org id + name it needs to provision a monthly board.
//
// IDEMPOTENT: for each shop we EXACT-MATCH search organizations by name first; an existing org
// is reused (never duplicated). Re-running is safe — it creates nothing that already exists and
// prints the same env value.
//
// SAFETY: dry-run by default (no writes). Pass --apply to actually create missing orgs. The
// token is read from PIPEDRIVE_API_TOKEN (alias PIPEDRIVE_TOKEN / PIPEDRIVE_API_KEY) and is
// NEVER logged. Address is intentionally omitted (optional; not present on the Asana boards) —
// the engine only needs name + id; address can be backfilled later without touching this list.
//
// USAGE (from repo root, with prod token in env):
//   PIPEDRIVE_API_TOKEN=**** node apps/psg-hub/scripts/psg-825-create-supplement-orgs.mjs          # dry-run
//   PIPEDRIVE_API_TOKEN=**** node apps/psg-hub/scripts/psg-825-create-supplement-orgs.mjs --apply  # create
// Optional: PIPEDRIVE_COMPANY_DOMAIN=yourco (defaults to the shared api host).

// The 12 Group-B shops (Radiant Writing gid 1202856740480581 is a non-shop → EXCLUDED).
// gid = Asana WHM board id (audit trail back to PSG-816 delta_boards_no_won_deal).
const SHOPS = [
  { name: "Certified Auto Body", gid: "907233958730096" },
  { name: "Robert Noaker Racing", gid: "911590681929926" }, // affiliate of won org 1415, distinct entity
  { name: "Auto Body Specialties", gid: "919301274989722" },
  { name: "Patton Brothers Collision Center", gid: "927620964804215" },
  { name: "Superior Collision", gid: "927620964804265" },
  { name: "Warrensburg Collision", gid: "927620964804326" },
  { name: "Central Body Company", gid: "938454098621400" },
  { name: "Bump & Grind Auto Body", gid: "1122188928670895" },
  { name: "Keno Collision & Service", gid: "1156393182503062" },
  { name: "Body Builders Automotive", gid: "1162459472955706" },
  { name: "Alamo Heights Collision Center", gid: "911403155718602" },
  { name: "ITG Glass Company", gid: "1202518402858286" },
];

const APPLY = process.argv.includes("--apply");
const TOKEN = (
  process.env.PIPEDRIVE_API_TOKEN ||
  process.env.PIPEDRIVE_TOKEN ||
  process.env.PIPEDRIVE_API_KEY ||
  ""
).trim();
if (!TOKEN) {
  console.error("ERROR: no Pipedrive token in PIPEDRIVE_API_TOKEN / PIPEDRIVE_TOKEN / PIPEDRIVE_API_KEY");
  process.exit(2);
}

function baseUrl() {
  const domain = (process.env.PIPEDRIVE_COMPANY_DOMAIN || "").trim();
  if (!domain) return "https://api.pipedrive.com";
  const sub = domain.replace(/^https?:\/\//, "").replace(/\.pipedrive\.com.*$/, "");
  return `https://${sub}.pipedrive.com`;
}
const BASE = baseUrl();

// api_token goes in the query string (Pipedrive convention). We build the URL with URLSearchParams
// so the token is never string-concatenated into a logged message.
function url(path, params = {}) {
  const u = new URL(`${BASE}/api/v1${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  u.searchParams.set("api_token", TOKEN);
  return u;
}
function redact(u) {
  const c = new URL(u);
  c.searchParams.set("api_token", "***");
  return c.toString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pipedrive rate-limits bursts (HTTP 429). Retry 429/5xx with backoff that honours the
// Retry-After header, so a single --apply run completes cleanly instead of half-provisioning.
async function fetchRetry(target, init = {}, { tries = 5 } = {}) {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(target, init);
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= tries) return res; // give up → caller surfaces the HTTP status
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : wait;
    console.log(`  … HTTP ${res.status}, retrying in ${Math.round(delay / 100) / 10}s (attempt ${attempt}/${tries - 1})`);
    await sleep(delay);
    wait = Math.min(wait * 2, 16000);
  }
}

async function findExactOrg(name) {
  const res = await fetchRetry(url("/organizations/search", { term: name, fields: "name", exact_match: "true", limit: 10 }));
  if (!res.ok) throw new Error(`search "${name}" → HTTP ${res.status} (${redact(res.url)})`);
  const body = await res.json();
  const items = body?.data?.items ?? [];
  // exact_match should already constrain this; double-check case-insensitively to be safe.
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = items.find((it) => norm(it?.item?.name ?? "") === norm(name));
  return hit ? { id: hit.item.id, name: hit.item.name } : null;
}

async function createOrg(name) {
  const res = await fetchRetry(url("/organizations"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create "${name}" → HTTP ${res.status}`);
  const body = await res.json();
  const id = body?.data?.id;
  if (!id) throw new Error(`create "${name}" → no id in response`);
  return { id, name: body.data.name ?? name };
}

async function main() {
  console.log(`PSG-825 supplement-org provisioning — ${APPLY ? "APPLY (will create missing orgs)" : "DRY-RUN (no writes)"}`);
  console.log(`Pipedrive base: ${BASE}\n`);
  const resolved = [];
  for (const [i, shop] of SHOPS.entries()) {
    if (i > 0) await sleep(300); // stay under Pipedrive's burst rate limit
    const existing = await findExactOrg(shop.name);
    if (existing) {
      console.log(`  = exists   org ${existing.id}  ${shop.name}`);
      resolved.push({ id: existing.id, name: shop.name });
      continue;
    }
    if (!APPLY) {
      console.log(`  + would create        ${shop.name}  (Asana gid ${shop.gid})`);
      resolved.push({ id: null, name: shop.name });
      continue;
    }
    const created = await createOrg(shop.name);
    console.log(`  + created  org ${created.id}  ${shop.name}`);
    resolved.push({ id: created.id, name: shop.name });
  }

  const allResolved = resolved.every((r) => r.id != null);
  console.log(`\n--- RECURRING_MAINTENANCE_SUPPLEMENT (${resolved.length} shops) ---`);
  if (!allResolved) {
    console.log("(dry-run or partial — re-run with --apply to mint the missing org ids)");
  }
  console.log(resolved.map((r) => `${r.id ?? "<id>"}|${r.name}`).join("\n"));
  console.log("--- end ---");
  console.log(
    "\nNext: paste the block above into Vercel prod env RECURRING_MAINTENANCE_SUPPLEMENT (newline-separated),\n" +
      "then redeploy. The engine reads it additively on top of RECURRING_MAINTENANCE_ROSTER (PSG-817).",
  );
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
