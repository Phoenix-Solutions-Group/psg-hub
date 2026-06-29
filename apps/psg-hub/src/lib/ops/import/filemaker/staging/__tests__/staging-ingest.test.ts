// PSG-395 (Track B) — staging content-hash + dedup + idempotent ingest tests.
import { describe, it, expect } from "vitest";
import type { RawTable } from "../../../types";
import { stagingContentHash } from "../content-hash";
import { dedupAction } from "../dedup";
import { extractLandingRecords } from "../extract";
import {
  ingestFmTable,
  type CanonicalWriteArgs,
  type ExistingCanonicalRow,
  type IngestStore,
} from "../ingest";
import type { LandingRecord, StagingEntity } from "../types";

// ── content hash ───────────────────────────────────────────────────────────
describe("stagingContentHash", () => {
  it("is deterministic and independent of key order", () => {
    const a = stagingContentHash({ b: "2", a: "1", c: "3" });
    const b = stagingContentHash({ c: "3", a: "1", b: "2" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats missing keys and blank/null values identically", () => {
    const base = stagingContentHash({ a: "1", b: "2" });
    expect(stagingContentHash({ a: "1", b: "2", c: "" })).toBe(base);
    expect(stagingContentHash({ a: "1", b: "2", c: null })).toBe(base);
    expect(stagingContentHash({ a: "1", b: "2", c: undefined })).toBe(base);
  });

  it("changes when any value changes", () => {
    expect(stagingContentHash({ a: "1" })).not.toBe(stagingContentHash({ a: "2" }));
  });
});

// ── dedup decision ───────────────────────────────────────────────────────────
describe("dedupAction", () => {
  const incoming = { sourceSystem: "filemaker", sourceId: "RO-1", contentHash: "h1" };

  it("inserts when there is no existing row", () => {
    expect(dedupAction(null, incoming)).toBe("insert");
  });

  it("skips when provenance + hash both match (true no-op)", () => {
    expect(
      dedupAction({ sourceSystem: "filemaker", sourceId: "RO-1", contentHash: "h1" }, incoming),
    ).toBe("skip");
  });

  it("updates when the hash changed", () => {
    expect(
      dedupAction({ sourceSystem: "filemaker", sourceId: "RO-1", contentHash: "OLD" }, incoming),
    ).toBe("update");
  });

  it("updates (back-fills) a business-key match with NULL provenance", () => {
    expect(
      dedupAction({ sourceSystem: null, sourceId: null, contentHash: null }, incoming),
    ).toBe("update");
  });
});

// ── extractor ────────────────────────────────────────────────────────────────
describe("extractLandingRecords", () => {
  it("captures full row as-text, derives PK + hash, drops PK-less rows", () => {
    const table: RawTable = {
      format: "csv",
      headers: ["RecordID", "RO #", "Last Name"],
      rows: [
        { "RecordID": "1", "RO #": "RO-100", "Last Name": "Smith" },
        { "RecordID": "", "RO #": "RO-200", "Last Name": "NoPk" },
      ],
    };
    const { records, droppedNoPk } = extractLandingRecords({
      entity: "repair_order",
      companyId: "co-1",
      sourceSystem: "filemaker",
      sourceFile: "ro.csv",
      table,
      sourceIdColumn: "RecordID",
    });
    expect(droppedNoPk).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].sourceId).toBe("1");
    expect(records[0].columns).toEqual({ "RecordID": "1", "RO #": "RO-100", "Last Name": "Smith" });
    expect(records[0].contentHash).toBe(stagingContentHash(records[0].columns));
  });
});

// ── in-memory store (tiny replayable DB) ──────────────────────────────────────
type CanonicalRow = ExistingCanonicalRow & { record: CanonicalWriteArgs["record"] };

function fakeStore() {
  // canonical keyed by `${entity}:${companyId}:${businessKey}`
  const canonical = new Map<string, CanonicalRow>();
  // landing keyed by `${entity}:${companyId}:${sourceSystem}:${sourceId}`
  const landing = new Map<string, LandingRecord>();
  let seq = 0;
  const ckey = (e: StagingEntity, co: string, bk: string) => `${e}:${co}:${bk}`;

  const store: IngestStore = {
    async landLanding(entity, records) {
      for (const r of records) {
        landing.set(`${entity}:${r.companyId}:${r.sourceSystem}:${r.sourceId}`, r);
      }
      return records.length;
    },
    async findCanonical(entity, companyId, businessKey) {
      return canonical.get(ckey(entity, companyId, businessKey)) ?? null;
    },
    async insertCanonical(entity, args) {
      const k = ckey(entity, args.companyId, args.businessKey);
      if (canonical.has(k)) throw new Error(`duplicate insert for ${k}`); // would be a real dup bug
      canonical.set(k, {
        id: `id-${++seq}`,
        contentHash: args.contentHash,
        sourceSystem: args.sourceSystem,
        sourceId: args.sourceId,
        record: args.record,
      });
    },
    async updateCanonical(entity, id, args) {
      const k = ckey(entity, args.companyId, args.businessKey);
      const existing = canonical.get(k);
      canonical.set(k, {
        id,
        contentHash: args.contentHash,
        sourceSystem: args.sourceSystem,
        sourceId: args.sourceId,
        record: args.record,
      });
      expect(existing?.id).toBe(id); // update must target the matched row
    },
  };
  return { store, canonical, landing };
}

const RO_MAPPING = {
  customer_last_name: "Last Name",
  customer_first_name: "First Name",
  ro_number: "RO #",
  vehicle_make: "Make",
};

function roTable(rows: Array<Record<string, string>>): RawTable {
  return { format: "csv", headers: ["RecordID", "RO #", "Last Name", "First Name", "Make"], rows };
}

const baseRows = [
  { "RecordID": "1", "RO #": "RO-100", "Last Name": "Smith", "First Name": "Al", "Make": "Honda" },
  { "RecordID": "2", "RO #": "RO-200", "Last Name": "Jones", "First Name": "Bo", "Make": "Ford" },
];

function ingestArgs(store: IngestStore, rows: Array<Record<string, string>>) {
  return {
    store,
    entity: "repair_order" as const,
    companyId: "co-1",
    sourceSystem: "filemaker",
    sourceFile: "ro.csv",
    table: roTable(rows),
    mapping: RO_MAPPING,
    sourceIdColumn: "RecordID",
  };
}

// ── idempotent ingest ─────────────────────────────────────────────────────────
describe("ingestFmTable — idempotency", () => {
  it("first run inserts all; re-run is a pure no-op (zero duplicates)", async () => {
    const { store, canonical, landing } = fakeStore();

    const first = await ingestFmTable(ingestArgs(store, baseRows));
    expect(first).toMatchObject({ landed: 2, inserted: 2, updated: 0, skipped: 0, failed: 0 });
    expect(canonical.size).toBe(2);
    expect(landing.size).toBe(2);

    // Re-running the IDENTICAL export must not insert or update anything.
    const second = await ingestFmTable(ingestArgs(store, baseRows));
    expect(second).toMatchObject({ landed: 2, inserted: 0, updated: 0, skipped: 2, failed: 0 });
    expect(canonical.size).toBe(2); // still exactly two — no duplicates
  });

  it("updates in place when a source row's content changed", async () => {
    const { store, canonical } = fakeStore();
    await ingestFmTable(ingestArgs(store, baseRows));

    const changed = [
      { ...baseRows[0], "Make": "Toyota" }, // RO-100 changed
      baseRows[1], // RO-200 unchanged
    ];
    const run = await ingestFmTable(ingestArgs(store, changed));
    expect(run).toMatchObject({ inserted: 0, updated: 1, skipped: 1, failed: 0 });
    expect(canonical.size).toBe(2);
    expect(canonical.get("repair_order:co-1:RO-100")?.record.ro?.payload_jsonb).toBeTruthy();
  });

  it("back-fills provenance on a row first loaded without it, then skips on re-run", async () => {
    const { store, canonical } = fakeStore();
    // Simulate a row the single-file v1.1 importer created: business key present,
    // NULL provenance + NULL hash.
    canonical.set("repair_order:co-1:RO-100", {
      id: "legacy-1",
      contentHash: null,
      sourceSystem: null,
      sourceId: null,
      record: { index: 0, customer: { first_name: "", last_name: "Smith", phone: null, email: null, address: {} } },
    });

    const run1 = await ingestFmTable(ingestArgs(store, baseRows));
    // RO-100 back-filled (update), RO-200 inserted.
    expect(run1).toMatchObject({ inserted: 1, updated: 1, skipped: 0, failed: 0 });
    expect(canonical.get("repair_order:co-1:RO-100")?.sourceSystem).toBe("filemaker");
    expect(canonical.get("repair_order:co-1:RO-100")?.id).toBe("legacy-1"); // same row, not a dup

    // Now the DB is fully provenanced → identical re-run is a no-op.
    const run2 = await ingestFmTable(ingestArgs(store, baseRows));
    expect(run2).toMatchObject({ inserted: 0, updated: 0, skipped: 2, failed: 0 });
  });

  it("counts PK-less and invalid rows as failed without landing/inserting them", async () => {
    const { store, canonical, landing } = fakeStore();
    const rows = [
      baseRows[0],
      { "RecordID": "", "RO #": "RO-300", "Last Name": "NoPk", "First Name": "X", "Make": "GM" }, // no PK
      { "RecordID": "4", "RO #": "", "Last Name": "", "First Name": "Y", "Make": "GM" }, // invalid: blank required
    ];
    const run = await ingestFmTable(ingestArgs(store, rows));
    expect(run.inserted).toBe(1);
    expect(run.failed).toBe(2); // PK-less row + invalid (blank required) row
    expect(canonical.size).toBe(1); // only the valid row is promoted to canonical
    // Both PK-bearing rows land raw (replay buffer); the PK-less row cannot.
    expect(landing.size).toBe(2);
  });
});
