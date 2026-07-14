// PSG-224 — production miner run: mine REAL trigger + A/B priors from the
// imported send batch × the repair-customer/survey outcome exports.
//
// Wires the real pieces end-to-end:
//   send side    = importSendBatch over the production-center 2021-09-07 batch
//                  (the only per-recipient send batch in the repo; spec §2 — the
//                  full 30-yr send log is sourced via the operator bridge later,
//                  at which point THIS script scales up unchanged).
//   outcome side = repair-customer + survey FileMaker exports (markdown tables),
//                  hashed with the SAME canonical household.ts so household_key /
//                  recipient_hash match the send side.
//   segment      = enriched per send from the recipient's repair-customer record
//                  (pay type / region / repeat-customer), keyed by household.
//
// Emits: docs/ops/mail/priors/priors.md (real summary) + a seed at
// apps/psg-hub/supabase/seeds/mail_send_priors_w0.sql (operator applies to prod,
// per the survey_attribution_pilot.sql convention). Prints reconciliation +
// match-coverage diagnostics.
//
//   npx tsx apps/psg-hub/scripts/mine-mail-priors.mts
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { importSendBatch } from "../src/lib/ops/mail/send-history-import";
import { householdKey, recipientHash } from "../src/lib/ops/mail/household";
import { normalizeState } from "../src/lib/ops/import/address";
import {
  mineSendPriors,
  renderPriorsSummary,
  normalizePayType,
  type SendRecord,
  type OutcomeRecord,
} from "../src/lib/ops/mail/priors";
import {
  repairCustomerToOutcome,
  surveyToOutcome,
  type OutcomeHashers,
} from "../src/lib/ops/mail/outcome-sources";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../.."); // psg-hub root
const BATCH_DIR = path.join(REPO, "docs/psg/production-center/production-files-sample/2021-09-07");
const EXPORT_DIR = path.join(REPO, "docs/psg/filemaker/exports");
const FILEMAKER_EXPORT_DIR = path.join(REPO, "docs/Filemaker Exports");
const SENT_DATE = "2021-09-07";
const COMPUTED_AT = "2026-07-14";
const WINDOW_DAYS = 180;

const hashers: OutcomeHashers = {
  householdKey: (a) => householdKey(a),
  recipientHash: (n, a) => recipientHash(n, a),
};

// ── Markdown-table parser (handles multiple tables per file) ────────────────
function parseMarkdownTables(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/);
  const rows: Record<string, string>[] = [];
  let header: string[] | null = null;
  const cells = (line: string) =>
    line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) {
      header = null;
      continue;
    }
    if (/^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line)) continue; // separator
    const c = cells(line);
    // A header is a row immediately followed by a `| --- |` separator.
    const next = lines[i + 1] ?? "";
    if (!header && /^\s*\|?[\s:-]*-{2,}/.test(next)) {
      header = c;
      continue;
    }
    if (header) {
      const obj: Record<string, string> = {};
      header.forEach((h, j) => (obj[h] = c[j] ?? ""));
      rows.push(obj);
    }
  }
  return rows;
}

function listExports(prefix: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith(prefix) && e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(EXPORT_DIR);
  return out;
}

// ── FileMaker CSV path (PSG-273) ────────────────────────────────────────────
//
// Nick's 2020-2026 export bridge landed the production-sized inputs in
// docs/Filemaker Exports/. Prefer those when present; keep the PSG-224 one-day
// markdown path below as a fallback for historical reproduction.
function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).filter((r) => r.some((c) => c.trim() !== "")).map((r) => {
    const out: Record<string, string> = {};
    header.forEach((h, i) => (out[h] = r[i] ?? ""));
    return out;
  });
}

function parseDate(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (s === "") return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (mdy) {
    const y = Number(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]);
    return `${String(y).padStart(4, "0")}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  return "";
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

function yes(raw: string | null | undefined): boolean {
  return (raw ?? "").trim().toLowerCase() === "yes";
}

type CsvProfile = {
  date: string;
  payType: string;
  region: string;
  repeat: boolean;
};

type CsvOutcome = {
  date: string;
};

function latestProfileBefore(profiles: CsvProfile[], sentDate: string): CsvProfile | null {
  let best: CsvProfile | null = null;
  for (const profile of profiles) {
    if (profile.date <= sentDate) best = profile;
    else if (!best) return profile;
  }
  return best;
}

function addSend(
  sends: SendRecord[],
  profilesBySerial: Map<string, CsvProfile[]>,
  serial: string,
  sentDate: string,
  pieceCode: string
) {
  if (!serial || !sentDate) return;
  const profile = latestProfileBefore(profilesBySerial.get(serial) ?? [], sentDate);
  sends.push({
    pieceCode,
    sentDate,
    roNumber: serial,
    recipientHash: null,
    householdKey: null,
    payType: profile?.payType ?? null,
    region: profile?.region ?? null,
    repeatCustomer: profile?.repeat ?? null,
  });
}

function addOutcome(outcomesBySerial: Map<string, CsvOutcome[]>, serial: string, outcomeDate: string) {
  if (!serial || !outcomeDate) return;
  const existing = outcomesBySerial.get(serial);
  if (existing) existing.push({ date: outcomeDate });
  else outcomesBySerial.set(serial, [{ date: outcomeDate }]);
}

function writeOutputs(
  priors: ReturnType<typeof mineSendPriors>,
  meta: {
    sourceLabel: string;
    methodRef: string;
    computedAt: string;
    coverageNote: string;
  }
) {
  const md = renderPriorsSummary(priors, {
    computedAt: meta.computedAt,
    windowDays: WINDOW_DAYS,
    sourceLabel: meta.sourceLabel,
  });
  writeFileSync(path.join(REPO, "docs/ops/mail/priors/priors.md"), md + meta.coverageNote);

  const sql: string[] = [
    "-- PSG-273 — mined mail_send_priors (W0 §5/AC3). GENERATED by",
    "-- apps/psg-hub/scripts/mine-mail-priors.mts — do not hand-edit; regenerate.",
    `-- Source: ${meta.sourceLabel}. Window: ${WINDOW_DAYS}d. Computed: ${meta.computedAt}.`,
    "-- Idempotent: upsert on (segment_key, piece_code, ab_variant).",
    "begin;",
    "delete from public.mail_send_priors where method_ref in ('mine-mail-priors.mts@2021-09-07', 'mine-mail-priors.mts@filemaker-2020-2026');",
  ];
  const esc = (s: string) => s.replace(/'/g, "''");
  for (const p of priors) {
    sql.push(
      `insert into public.mail_send_priors (segment_key, piece_code, trigger, ab_variant, n_sent, n_outcome, outcome_rate, method_ref, computed_at) values (` +
        `'${esc(p.segmentKey)}', '${esc(p.pieceCode)}', '${esc(p.trigger)}', '${p.abVariant}', ${p.nSent}, ${p.nOutcome}, ${p.outcomeRate.toFixed(6)}, ` +
        `'${meta.methodRef}', '${meta.computedAt}T00:00:00Z')` +
        ` on conflict (segment_key, piece_code, ab_variant) do update set ` +
        `n_sent = excluded.n_sent, n_outcome = excluded.n_outcome, outcome_rate = excluded.outcome_rate, ` +
        `trigger = excluded.trigger, method_ref = excluded.method_ref, computed_at = excluded.computed_at;`
    );
  }
  sql.push("commit;", "");
  writeFileSync(path.join(REPO, "apps/psg-hub/supabase/seeds/mail_send_priors_w0.sql"), sql.join("\n"));
}

function runFileMakerCsvMiner(): void {
  const lettersPath = path.join(FILEMAKER_EXPORT_DIR, "letters-printed.csv");
  const repairPaths = [
    path.join(FILEMAKER_EXPORT_DIR, "Repair Customer Export - 01-01-18...12-31-20.csv"),
    path.join(FILEMAKER_EXPORT_DIR, "repair-customer_nick.csv"),
  ];
  const surveyPath = path.join(FILEMAKER_EXPORT_DIR, "Survey Export - 01-01-18...12-31-20.csv");

  const profilesBySerial = new Map<string, CsvProfile[]>();
  const outcomesBySerial = new Map<string, CsvOutcome[]>();
  const seenRepairOutcomes = new Set<string>();
  let repairRows = 0;
  let surveyRows = 0;

  for (const repairPath of repairPaths) {
    if (!existsSync(repairPath)) continue;
    for (const row of parseCsv(readFileSync(repairPath, "utf8"))) {
      const serial = (row.RC_SerialNum ?? "").trim();
      const outcomeDate = parseDate(row.RC_Date_Out || row.RC_CreationDate);
      if (!serial || !outcomeDate) continue;
      const key = `${serial}\0${outcomeDate}\0${row.RC_Shop ?? ""}`;
      if (seenRepairOutcomes.has(key)) continue;
      seenRepairOutcomes.add(key);
      repairRows++;
      const profile: CsvProfile = {
        date: outcomeDate,
        payType: normalizePayType(row.RC_PayType),
        region: normalizeState(row.RC_Cust_State) ?? "unknown",
        repeat: yes(row.RC_Repeat_Yes_No),
      };
      const profiles = profilesBySerial.get(serial);
      if (profiles) profiles.push(profile);
      else profilesBySerial.set(serial, [profile]);
      addOutcome(outcomesBySerial, serial, outcomeDate);
    }
  }
  for (const profiles of profilesBySerial.values()) {
    profiles.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (existsSync(surveyPath)) {
    for (const row of parseCsv(readFileSync(surveyPath, "utf8"))) {
      const serial = (row.S_MatchField_Customer || row.S_RC_RONumber || "").trim();
      const outcomeDate = parseDate(row.S_CreationDate || row.S_RC_Date_Out);
      if (!serial || !outcomeDate) continue;
      surveyRows++;
      addOutcome(outcomesBySerial, serial, outcomeDate);
    }
  }

  const sends: SendRecord[] = [];
  for (const row of parseCsv(readFileSync(lettersPath, "utf8"))) {
    const serial = (row.RC_SerialNum ?? "").trim();
    if (!serial) continue;
    const thankYou = parseDate(row.Letter_ThankYou_Printed);
    const thankYouNs = parseDate(row.Letter_ThankYouNS_Printed);
    const thankYouNw = parseDate(row.Letter_ThankYouNW_Printed);
    const thankYouNsNw = parseDate(row.Letter_ThankYouNSNW_Printed);
    const warranty = parseDate(row.Letter_Warranty_Printed);
    const warrantyS = parseDate(row.Letter_WarrantyS_Printed);
    const survey = parseDate(row.Letter_Survey_Printed);
    let surveyConsumed = false;
    let warrantyConsumed = false;

    if (thankYou && warranty && survey && thankYou === warranty && warranty === survey) {
      addSend(sends, profilesBySerial, serial, thankYou, "07");
      surveyConsumed = true;
      warrantyConsumed = true;
    }
    if (thankYouNs && warranty && thankYouNs === warranty && !warrantyConsumed) {
      addSend(sends, profilesBySerial, serial, thankYouNs, "04");
      warrantyConsumed = true;
    }
    if (warrantyS && survey && warrantyS === survey) {
      addSend(sends, profilesBySerial, serial, warrantyS, "05");
      addSend(sends, profilesBySerial, serial, survey, "01");
      surveyConsumed = true;
    }
    addSend(sends, profilesBySerial, serial, thankYouNsNw, "06");
    addSend(sends, profilesBySerial, serial, thankYouNw, "03");
    if (warranty && !warrantyConsumed) addSend(sends, profilesBySerial, serial, warranty, "05");
    if (survey && !surveyConsumed) addSend(sends, profilesBySerial, serial, survey, "01");

    const singles: Array<[string, string]> = [
      ["Letter_3Month_Printed", "10"],
      ["Letter_Birthday_Printed", "11"],
      ["Letter_Drivers_Printed", "12"],
      ["Letter_6Month_Printed", "13"],
      ["Letter_1Year_Printed", "14"],
      ["Letter_18Month_Printed", "15"],
      ["Letter_2Year_Printed", "16"],
      ["Letter_ThankYou_progressive_Printed", "03"],
      ["Letter_6Month_progressive_Printed", "13"],
      ["Letter_1Year_progressive_Printed", "14"],
      ["Letter_AgentAckn_Printed", "A"],
    ];
    for (const [column, pieceCode] of singles) {
      addSend(sends, profilesBySerial, serial, parseDate(row[column]), pieceCode);
    }
  }

  const outcomes: OutcomeRecord[] = [];
  for (const [serial, rows] of outcomesBySerial) {
    for (const outcome of rows) {
      outcomes.push({
        roNumber: serial,
        outcomeDate: outcome.date,
        repeat: false,
        referral: false,
        surveyReturned: true,
        subsequentRo: true,
      });
    }
  }

  const priors = mineSendPriors(sends, outcomes, { windowDays: WINDOW_DAYS });
  const totalOutcomes = priors.reduce((a, p) => a + p.nOutcome, 0);
  const nonzeroCells = priors.filter((p) => p.nOutcome > 0).length;
  const sourceLabel =
    `FileMaker CSV exports (letters-printed.csv: ${sends.length} send events; ` +
    `repair outcomes: ${repairRows}; survey outcomes: ${surveyRows})`;
  const coverageNote = [
    "",
    "> **Coverage:** mined from Nick's 2020-2026 FileMaker letter-production export",
    "> plus repair-customer and survey outcome exports. Rows are joined by the",
    "> legacy customer serial carried in the exports; no raw customer names or",
    "> addresses are written to the priors outputs.",
    `> ${totalOutcomes} sends had a positive repair/survey outcome inside the`,
    `> ${WINDOW_DAYS}-day window across ${nonzeroCells} non-zero cells.`,
    "",
  ].join("\n");

  writeOutputs(priors, {
    sourceLabel,
    methodRef: "mine-mail-priors.mts@filemaker-2020-2026",
    computedAt: COMPUTED_AT,
    coverageNote,
  });

  console.log(
    `CSV SEND: ${sends.length} send events / OUTCOME: ${outcomes.length} outcome rows / ` +
      `PRIORS: ${priors.length} cells / ${totalOutcomes} positive outcomes / ${nonzeroCells} non-zero cells`
  );
  console.log("WROTE docs/ops/mail/priors/priors.md + apps/psg-hub/supabase/seeds/mail_send_priors_w0.sql");
}

if (existsSync(path.join(FILEMAKER_EXPORT_DIR, "letters-printed.csv"))) {
  runFileMakerCsvMiner();
  process.exit(0);
}

// ── 1. Send side: import the real batch ─────────────────────────────────────
const envelopes = readdirSync(BATCH_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ filename: f, content: readFileSync(path.join(BATCH_DIR, f), "utf8") }));
const { records, report } = importSendBatch(envelopes, { sentDate: SENT_DATE, batchRef: SENT_DATE });
console.log(`SEND: ${report.persisted} persisted / ${report.sourceRowsIn} in / ${report.deduplicated} dedup / ${report.rejected} rejected`);

// ── 2. Outcome side + segment-profile map (by household) ────────────────────
type Profile = { payType: string; region: string; repeat: boolean; date: string };
const profileByHousehold = new Map<string, Profile>();
const outcomes: OutcomeRecord[] = [];

function addressOf(row: Record<string, string>, c: { l1: string; l2: string; city: string; state: string; zip: string }) {
  return { line1: row[c.l1] ?? null, line2: row[c.l2] ?? null, city: row[c.city] ?? null, state: row[c.state] ?? null, zip: row[c.zip] ?? null };
}
function considerProfile(hkey: string, p: Profile) {
  if (!hkey) return;
  const cur = profileByHousehold.get(hkey);
  // Prefer the latest repair ON/BEFORE the send (the trigger); else keep latest.
  const before = (d: string) => d !== "" && d <= SENT_DATE;
  if (!cur) return void profileByHousehold.set(hkey, p);
  if (before(p.date) && (!before(cur.date) || p.date > cur.date)) profileByHousehold.set(hkey, p);
  else if (!before(cur.date) && p.date > cur.date) profileByHousehold.set(hkey, p);
}

for (const file of listExports("repair-customer-export")) {
  for (const row of parseMarkdownTables(readFileSync(file, "utf8"))) {
    if (!row.RC_Cust_Last && !row.RC_Cust_First) continue;
    outcomes.push(repairCustomerToOutcome(row, hashers));
    const addr = addressOf(row, { l1: "RC_Cust_Address1", l2: "RC_Cust_Address2", city: "RC_Cust_City", state: "RC_Cust_State", zip: "RC_Cust_Zip" });
    considerProfile(householdKey(addr), {
      payType: normalizePayType(row.RC_PayType),
      region: normalizeState(row.RC_Cust_State) ?? "unknown",
      repeat: String(row.RC_Repeat_Yes_No ?? "").trim().toLowerCase() === "yes",
      date: (row.RC_Date_Out || row.RC_CreationDate || "").slice(0, 10),
    });
  }
}
for (const file of listExports("survey-export")) {
  for (const row of parseMarkdownTables(readFileSync(file, "utf8"))) {
    if (!row.S_RC_Cust_Name_Last && !row.S_RC_Cust_Name_First) continue;
    outcomes.push(surveyToOutcome(row, hashers));
    const addr = addressOf(row, { l1: "S_RC_Cust_Address", l2: "S_RC_Cust_Address2", city: "S_RC_Cust_City", state: "S_RC_Cust_State", zip: "S_RC_Cust_Zip" });
    considerProfile(householdKey(addr), {
      payType: normalizePayType(row.S_RC_PayType),
      region: normalizeState(row.S_RC_Cust_State) ?? "unknown",
      repeat: String(row.S_RC_Repeat ?? "").trim().toLowerCase() === "yes",
      date: (row.S_RC_Date_Out || row.S_CreationDate || "").slice(0, 10),
    });
  }
}
console.log(`OUTCOME: ${outcomes.length} outcome rows / ${profileByHousehold.size} household profiles`);

// ── 3. Enrich sends with segment attributes by household ─────────────────────
let matchedSeg = 0;
const sends: SendRecord[] = records.map((r) => {
  const prof = profileByHousehold.get(r.household_key);
  if (prof) matchedSeg++;
  return {
    pieceCode: r.piece_code,
    sentDate: r.sent_date,
    roNumber: r.ro_number,
    recipientHash: r.recipient_hash,
    householdKey: r.household_key,
    payType: prof?.payType ?? null,
    region: prof?.region ?? null,
    repeatCustomer: prof ? prof.repeat : null,
  };
});
console.log(`ENRICH: ${matchedSeg}/${records.length} sends matched a repair-customer profile for segmentation`);

// ── 4. Mine ─────────────────────────────────────────────────────────────────
const priors = mineSendPriors(sends, outcomes, { windowDays: WINDOW_DAYS });
const totalOutcomes = priors.reduce((a, p) => a + p.nOutcome, 0);
console.log(`PRIORS: ${priors.length} (segment,piece,arm) cells / ${totalOutcomes} positive outcomes matched in-window`);

// ── 5. Write doc + seed ─────────────────────────────────────────────────────
const sourceLabel = `production batch ${SENT_DATE} (${report.persisted} sends) × repair-customer + survey exports`;
const md = renderPriorsSummary(priors, { computedAt: SENT_DATE, windowDays: WINDOW_DAYS, sourceLabel });
const coverageNote = [
  "",
  "> **Coverage (honest):** mined from the **only** per-recipient send batch in",
  `> the repo (${SENT_DATE}, ${report.persisted} sends; spec §2 — the full 30-year`,
  "> send log lands via the operator bridge, after which re-running",
  "> `scripts/mine-mail-priors.mts` scales these priors up unchanged).",
  `> ${matchedSeg}/${records.length} sends matched a repair-customer profile for`,
  `> segmentation; ${totalOutcomes} sends had a positive outcome inside the`,
  `> ${WINDOW_DAYS}-day window. Thin cells are expected at this data volume.`,
  "",
].join("\n");
writeFileSync(path.join(REPO, "docs/ops/mail/priors/priors.md"), md + coverageNote);

// Seed SQL (operator applies to prod; mirrors survey_attribution_pilot.sql).
const sql: string[] = [
  "-- PSG-224 — mined mail_send_priors (W0 §5/AC3). GENERATED by",
  "-- apps/psg-hub/scripts/mine-mail-priors.mts — do not hand-edit; regenerate.",
  `-- Source: ${sourceLabel}. Window: ${WINDOW_DAYS}d. Computed: ${SENT_DATE}.`,
  "-- Idempotent: upsert on (segment_key, piece_code, ab_variant).",
  "begin;",
  "delete from public.mail_send_priors where method_ref = 'mine-mail-priors.mts@2021-09-07';",
];
const esc = (s: string) => s.replace(/'/g, "''");
for (const p of priors) {
  sql.push(
    `insert into public.mail_send_priors (segment_key, piece_code, trigger, ab_variant, n_sent, n_outcome, outcome_rate, method_ref, computed_at) values (` +
      `'${esc(p.segmentKey)}', '${esc(p.pieceCode)}', '${esc(p.trigger)}', '${p.abVariant}', ${p.nSent}, ${p.nOutcome}, ${p.outcomeRate.toFixed(6)}, ` +
      `'mine-mail-priors.mts@2021-09-07', '${SENT_DATE}T00:00:00Z')` +
      ` on conflict (segment_key, piece_code, ab_variant) do update set ` +
      `n_sent = excluded.n_sent, n_outcome = excluded.n_outcome, outcome_rate = excluded.outcome_rate, ` +
      `trigger = excluded.trigger, method_ref = excluded.method_ref, computed_at = excluded.computed_at;`
  );
}
sql.push("commit;", "");
writeFileSync(path.join(REPO, "apps/psg-hub/supabase/seeds/mail_send_priors_w0.sql"), sql.join("\n"));
console.log(`WROTE docs/ops/mail/priors/priors.md + apps/psg-hub/supabase/seeds/mail_send_priors_w0.sql (${priors.length} rows)`);
