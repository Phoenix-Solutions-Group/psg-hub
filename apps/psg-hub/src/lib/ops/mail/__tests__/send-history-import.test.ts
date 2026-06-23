// W0 / PSG-223 — Send-history importer + reconciliation tests.
//
// Two layers:
//  1. A committed synthetic fixture (no PII) that always runs in CI and pins the
//     parser, hashing, dedup, and reconciliation math deterministically.
//  2. The real 2021-09-07 production-center batch — gitignored (PII), so it runs
//     only where the operator data is present on disk (local proof / QA). Point
//     PSG_MAIL_SAMPLE_DIR at the batch dir, or rely on the repo-root default.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_MAIL_HASH_SALT,
  formatReconciliationReport,
  importSendBatch,
  normalizeRecipientName,
  parseEnvelopeFilename,
  parseEnvelopeMarkdown,
  splitCityStateZip,
  type EnvelopeSource,
} from "@/lib/ops/mail";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures");
const SENT_DATE = "2021-09-07";

function loadEnvelopes(dir: string): EnvelopeSource[] {
  return readdirSync(dir)
    .filter((f) => /-envelope-\d{2}-\d{2}\.md$/i.test(f))
    .sort()
    .map((f) => ({
      filename: f,
      content: readFileSync(path.join(dir, f), "utf8"),
    }));
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

describe("normalizeRecipientName", () => {
  it("drops honorifics, lowercases, collapses", () => {
    expect(normalizeRecipientName("Mr. John Sample")).toBe("john sample");
    expect(normalizeRecipientName("  Ms.  Ana   Aguirre ")).toBe("ana aguirre");
  });
});

describe("parseEnvelopeMarkdown (form-feed delimited blocks)", () => {
  const content = readFileSync(
    path.join(FIXTURE_DIR, "99-envelope-09-07.md"),
    "utf8",
  );
  const blocks = parseEnvelopeMarkdown(content);

  it("splits every PSGID-delimited recipient, including indented \\f markers", () => {
    expect(blocks).toHaveLength(6);
    expect(blocks[0].psgid).toBe("PS900");
    expect(blocks[3].psgid).toBe("PS901");
  });
  it("separates name / street(s) / city-state-zip; keeps unit lines", () => {
    expect(blocks[0].rawName).toBe("Mr. John Sample");
    expect(blocks[0].rawCityStateZip).toBe("Springfield, Illinois 62704");
    // Jane has a 2nd street (unit) line.
    expect(blocks[2].rawStreetLines).toEqual(["456 Oak Avenue", "Apt 7"]);
  });
});

describe("importSendBatch — reconciliation (AC1) on synthetic fixture", () => {
  const sources = loadEnvelopes(FIXTURE_DIR);
  const { records, report } = importSendBatch(sources, {
    sentDate: SENT_DATE,
    batchRef: SENT_DATE,
    salt: DEFAULT_MAIL_HASH_SALT,
  });

  it("reconciles source-in = persisted + deduplicated + rejected", () => {
    expect(report.sourceRowsIn).toBe(6);
    expect(report.persisted).toBe(3);
    expect(report.deduplicated).toBe(1);
    expect(report.rejected).toBe(2);
    expect(
      report.persisted + report.deduplicated + report.rejected,
    ).toBe(report.sourceRowsIn);
  });

  it("classifies rejects with reasons", () => {
    expect(report.rejectedByReason.missing_street).toBe(1);
    expect(report.rejectedByReason.unparseable_city_state_zip).toBe(1);
    expect(report.rejectedDetail).toHaveLength(2);
  });

  it("collapses send_ref duplicates (idempotency, not an error)", () => {
    // Block #2 is the same (shop, normalized recipient, piece, date) as #1.
    const refs = records.map((r) => r.send_ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("normalizes '123 Main St' === '123 Main Street' to one household/recipient", () => {
    const john = records.find((r) => r.shop_name === "PS900");
    const johnP901 = records.find((r) => r.shop_name === "PS901");
    expect(john).toBeDefined();
    expect(johnP901).toBeDefined();
    // Same person+address, different shop → same hashes, different send_ref.
    expect(johnP901!.recipient_hash).toBe(john!.recipient_hash);
    expect(johnP901!.household_key).toBe(john!.household_key);
    expect(johnP901!.send_ref).not.toBe(john!.send_ref);
  });

  it("persists NO raw PII — only salted hashes + shop key (AC4)", () => {
    for (const r of records) {
      expect(r.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.household_key).toMatch(/^[0-9a-f]{64}$/);
      const blob = JSON.stringify(r).toLowerCase();
      expect(blob).not.toContain("john");
      expect(blob).not.toContain("sample");
      expect(blob).not.toContain("main");
      expect(blob).not.toContain("springfield");
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
  });
});

// ── Real 2021-09-07 production-center batch (gitignored PII; on-disk only) ──
const SAMPLE_DIR =
  process.env.PSG_MAIL_SAMPLE_DIR ??
  path.resolve(
    __dirname,
    "../../../../../../../docs/psg/production-center/production-files-sample/2021-09-07",
  );
const hasSample = existsSync(SAMPLE_DIR);

describe.skipIf(!hasSample)(
  "importSendBatch — real 2021-09-07 batch (operator data present)",
  () => {
    // Lazy: the describe body still runs when skipped, so don't touch the FS
    // unless the gitignored sample is actually present.
    const sources = hasSample ? loadEnvelopes(SAMPLE_DIR) : [];
    const { records, report } = importSendBatch(sources, {
      sentDate: SENT_DATE,
      batchRef: SENT_DATE,
      salt: DEFAULT_MAIL_HASH_SALT,
    });

    it("processes only envelope artifacts and reconciles exactly", () => {
      expect(sources.length).toBeGreaterThan(0);
      // The core AC1 invariant on real data.
      expect(
        report.persisted + report.deduplicated + report.rejected,
      ).toBe(report.sourceRowsIn);
      expect(report.sourceRowsIn).toBeGreaterThan(1000);
      expect(report.persisted).toBeGreaterThan(0);
      // Surface the real numbers for QA.
      console.log("\n" + formatReconciliationReport(report) + "\n");
    });

    it("emits real numbered pieces with salted-hash-only rows (AC4)", () => {
      const pieces = new Set(records.map((r) => r.piece_code));
      expect(pieces.size).toBeGreaterThan(1);
      for (const r of records.slice(0, 200)) {
        expect(r.recipient_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(r.household_key).toMatch(/^[0-9a-f]{64}$/);
        expect(r.shop_name).toMatch(/^PS\d+$/);
      }
    });
  },
);
