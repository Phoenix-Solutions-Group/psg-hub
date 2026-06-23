// W0 / PSG-223 — Send-history importer + reconciliation tests.
//
// Three layers:
//  1. Inline parser tests pinning the two real envelope layouts (col-0 names and
//     warranty pieces whose name shares a row with a left-column marketing prefix)
//     plus the form-feed page-footer marker — the things that bit naive parsing.
//  2. A committed synthetic fixture (no PII) that pins reconciliation + dedup math
//     deterministically.
//  3. The real 2021-09-07 production-center batch (committed in docs/) as the AC1
//     proof on actual data.
//
// Hashing is injected (MailHasher). Production binds src/lib/ops/mail/household.ts
// (PSG-221) so mail_send_history keys match mail_suppression's. The TEST hasher
// below is a deterministic stand-in: it shares household.ts's USPS street
// normalization (via the shared address resolver) but is intentionally STRICTER
// on names — it also strips honorifics, which household.ts does NOT. That extra
// strip lets the "123 Main St === 123 Main Street" + honorific dedup be proven
// here without coupling to the module; it is also why the real-batch split under
// this stand-in (1766/13) differs by one from the production binding (1767/12).
// household_key is address-only, so suppression is unaffected either way.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { resolveAddress, type AddressInput } from "@/lib/ops/import/address";
import {
  formatReconciliationReport,
  importSendBatch,
  parseEnvelopeFilename,
  parseEnvelopeMarkdown,
  splitCityStateZip,
  type EnvelopeSource,
  type MailHasher,
} from "@/lib/ops/mail";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures");
const SENT_DATE = "2021-09-07";

// ── Deterministic test stand-in hasher (NOT identical to household.ts: see above) ──
function canonAddress(a: AddressInput): string {
  const r = resolveAddress(a).address;
  return [r.line1, r.line2, r.city, r.state, r.zip]
    .map((p) => (p ?? "").toUpperCase().replace(/\s+/g, " ").trim())
    .join("|");
}
const HONORIFIC_RE = /\b(mr|mrs|ms|miss|dr)\b\.?/gi;
function canonName(n: string): string {
  return n
    .replace(HONORIFIC_RE, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const testHasher: MailHasher = {
  householdKey: (a) => sha("hh|" + canonAddress(a)),
  recipientHash: (n, a) => sha("rc|" + canonName(n) + "|" + canonAddress(a)),
};

function loadEnvelopes(dir: string): EnvelopeSource[] {
  return readdirSync(dir)
    .filter((f) => /-envelope-\d{2}-\d{2}\.md$/i.test(f))
    .sort()
    .map((f) => ({ filename: f, content: readFileSync(path.join(dir, f), "utf8") }));
}

describe("parseEnvelopeFilename", () => {
  it("reads piece code + variant", () => {
    expect(parseEnvelopeFilename("04b-envelope-09-07.md")).toEqual({
      pieceCode: "04b",
      pieceVariant: "envelope",
    });
    expect(parseEnvelopeFilename("t-letter-09-07.md")).toEqual({
      pieceCode: "t",
      pieceVariant: "letter",
    });
  });
  it("rejects non-conforming names", () => {
    expect(parseEnvelopeFilename("readme.md")).toBeNull();
    expect(parseEnvelopeFilename("04-envelope.md")).toBeNull();
  });
});

describe("splitCityStateZip", () => {
  it("parses spelled-out state + 5-digit / ZIP+4", () => {
    expect(splitCityStateZip("Tucson, Arizona 85712")).toEqual({
      city: "Tucson",
      state: "Arizona",
      zip: "85712",
    });
    expect(splitCityStateZip("Elk Grove Village, Illinois 60007-1234")).toEqual({
      city: "Elk Grove Village",
      state: "Illinois",
      zip: "60007",
    });
  });
  it("returns null for unparseable lines", () => {
    expect(splitCityStateZip("Nowhere Land")).toBeNull();
    expect(splitCityStateZip(null)).toBeNull();
  });
});

describe("parseEnvelopeMarkdown — real layouts", () => {
  it("col-0 layout: name at column 0, form-feed footer marker, no empty trailing block", () => {
    // Mirrors t/13/16 pieces: leading marker, name+address at col 0, a \f-prefixed
    // footer marker after each recipient, and a trailing footer at EOF.
    const content = [
      "# 13_Envelope_09-07",
      "",
      "PS218",
      "",
      "Mr. Stephen Moore",
      "2930 North Swan Road",
      "Tucson, Arizona 85712",
      "\f                              PS218",
      "",
      "Tracy Ash",
      "1695 Highway 52",
      "Tuscumbia, Missouri 65082",
      "\f                              PS218",
    ].join("\n");
    const blocks = parseEnvelopeMarkdown(content);
    // 2 recipients; the trailing EOF footer marker yields no phantom block.
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      psgid: "PS218",
      rawName: "Mr. Stephen Moore",
      rawStreetLines: ["2930 North Swan Road"],
      rawCityStateZip: "Tucson, Arizona 85712",
    });
    expect(blocks[1].rawName).toBe("Tracy Ash");
  });

  it("warranty layout: name shares its row with a left-column marketing prefix", () => {
    // Mirrors the 07 piece: 'Your Repair Warranty Enclosed' fills the left column;
    // the name + address align in the right column. Name is recovered by slicing
    // at the address column, dropping the marketing prefix (never hashed).
    const pad = " ".repeat(32);
    const content = [
      "# 07_Envelope_09-07",
      "",
      "PS760",
      "",
      "Your Repair Warranty Enclosed   Smsgt. Warren Weakley",
      pad + "425 Southwest B B Highway",
      pad + "Warrensburg, Missouri 64093",
      "\f" + " ".repeat(46) + "PS760",
    ].join("\n");
    const blocks = parseEnvelopeMarkdown(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].rawName).toBe("Smsgt. Warren Weakley");
    expect(blocks[0].rawStreetLines).toEqual(["425 Southwest B B Highway"]);
    expect(blocks[0].rawCityStateZip).toBe("Warrensburg, Missouri 64093");
  });

  it("keeps unit (line2) lines with the street", () => {
    const blocks = parseEnvelopeMarkdown(
      readFileSync(path.join(FIXTURE_DIR, "99-envelope-09-07.md"), "utf8"),
    );
    const jane = blocks.find((b) => b.rawName === "Jane Sample");
    expect(jane?.rawStreetLines).toEqual(["456 Oak Avenue", "Apt 7"]);
    expect(jane?.psgid).toBe("PS901");
  });
});

describe("importSendBatch — reconciliation (AC1) on synthetic fixture", () => {
  const sources = loadEnvelopes(FIXTURE_DIR);
  const { records, report } = importSendBatch(
    sources,
    { sentDate: SENT_DATE, batchRef: SENT_DATE },
    testHasher,
  );

  it("reconciles source-in = persisted + deduplicated + rejected", () => {
    expect(report.sourceRowsIn).toBe(6);
    expect(report.persisted).toBe(3);
    expect(report.deduplicated).toBe(1);
    expect(report.rejected).toBe(2);
    expect(report.persisted + report.deduplicated + report.rejected).toBe(
      report.sourceRowsIn,
    );
  });

  it("classifies rejects with reasons (PII-safe detail)", () => {
    expect(report.rejectedByReason.missing_street).toBe(1);
    expect(report.rejectedByReason.unparseable_city_state_zip).toBe(1);
    expect(report.rejectedDetail).toHaveLength(2);
    for (const d of report.rejectedDetail) {
      expect(d.detail).not.toMatch(/nowhere|chicago/i);
    }
  });

  it("collapses send_ref duplicates (idempotency, not an error)", () => {
    const refs = records.map((r) => r.send_ref);
    expect(new Set(refs).size).toBe(refs.length);
    // The dedup case is '123 Main St' vs '123 Main Street' at the same shop — the
    // shared address normalization collapses them to one send_ref.
    expect(report.deduplicated).toBe(1);
  });

  it("normalizes '123 Main St' === '123 Main Street' and drops honorifics", () => {
    const johnP900 = records.find((r) => r.shop_name === "PS900");
    const johnP901 = records.find(
      (r) => r.shop_name === "PS901" && r.recipient_hash === johnP900?.recipient_hash,
    );
    expect(johnP900).toBeDefined();
    expect(johnP901).toBeDefined();
    // Same person+address, different shop → same hashes, different send_ref.
    expect(johnP901!.household_key).toBe(johnP900!.household_key);
    expect(johnP901!.send_ref).not.toBe(johnP900!.send_ref);
  });

  it("persists NO raw PII — only salted hashes + shop key (AC4)", () => {
    for (const r of records) {
      expect(r.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.household_key).toMatch(/^[0-9a-f]{64}$/);
      const blob = JSON.stringify(r).toLowerCase();
      for (const pii of ["john", "jane", "sample", "main", "oak", "springfield"]) {
        expect(blob).not.toContain(pii);
      }
    }
  });

  it("builds the deterministic send_ref shape from spec §3.1", () => {
    const r = records[0];
    expect(r.send_ref).toBe(
      `${r.shop_name}:${r.recipient_hash}:${r.piece_code}:${r.sent_date}`,
    );
    expect(r.source).toBe("filemaker");
    expect(r.batch_ref).toBe(SENT_DATE);
    expect(r.piece_variant).toBe("envelope");
    expect(r.ro_number).toBeNull();
  });
});

// ── Real 2021-09-07 production-center batch (committed in docs/) ─────────────
const SAMPLE_DIR =
  process.env.PSG_MAIL_SAMPLE_DIR ??
  path.resolve(
    __dirname,
    "../../../../../../../docs/psg/production-center/production-files-sample/2021-09-07",
  );
const hasSample = existsSync(SAMPLE_DIR);

describe.skipIf(!hasSample)("importSendBatch — real 2021-09-07 batch", () => {
  // Guarded so the eager load is skipped when the batch is absent (skipIf only
  // skips the it() bodies, not this setup).
  const sources = hasSample ? loadEnvelopes(SAMPLE_DIR) : [];
  const { records, report } = importSendBatch(
    sources,
    { sentDate: SENT_DATE, batchRef: SENT_DATE },
    testHasher,
  );

  it("processes only envelope artifacts and reconciles exactly (AC1)", () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(report.persisted + report.deduplicated + report.rejected).toBe(
      report.sourceRowsIn,
    );
    expect(report.sourceRowsIn).toBeGreaterThan(50);
    expect(report.persisted).toBeGreaterThan(0);
    // Surface the real numbers for QA.
    console.log("\n" + formatReconciliationReport(report) + "\n");
  });

  it("emits multiple numbered pieces with salted-hash-only rows (AC4)", () => {
    const pieces = new Set(records.map((r) => r.piece_code));
    expect(pieces.size).toBeGreaterThan(1);
    for (const r of records.slice(0, 300)) {
      expect(r.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.household_key).toMatch(/^[0-9a-f]{64}$/);
      expect(r.shop_name).toMatch(/^PS\d+$/);
      expect(r.piece_variant).toBe("envelope");
    }
  });
});
