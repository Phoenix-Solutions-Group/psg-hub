import { describe, it, expect } from "vitest";
import {
  evaluateSuppression,
  isSuppressed,
  flagSuppressionRow,
  alreadyMailedRow,
  buildSuppressionRef,
  type SuppressionRow,
  type SuppressionQueryClient,
} from "../suppression";
import { householdKey, recipientHash } from "../household";

const SALT = { salt: "test-salt" };
const HOUSE = { line1: "123 Main St", city: "Los Angeles", state: "CA", zip: "90012" };
const HK = householdKey(HOUSE, SALT);

const optOut: SuppressionRow = {
  scope: "household",
  household_key: HK,
  recipient_hash: null,
  piece_code: null,
  reason: "opt_out",
  effective_from: "2020-01-01",
};

describe("evaluateSuppression — opt-out honored", () => {
  it("suppresses a household that opted out", () => {
    const r = evaluateSuppression([optOut], { householdKey: HK, asOf: "2026-06-23" });
    expect(r).toEqual({ suppressed: true, reason: "opt_out" });
  });

  it("does NOT suppress a different household", () => {
    const other = householdKey({ ...HOUSE, line1: "999 Other St" }, SALT);
    expect(evaluateSuppression([optOut], { householdKey: other, asOf: "2026-06-23" }))
      .toEqual({ suppressed: false });
  });

  it("opt-out suppresses every recipient at the address (household dedup)", () => {
    // Two different people at the same address resolve to the same household key,
    // so an opt-out on the household suppresses both.
    const husband = householdKey(HOUSE, SALT);
    const wife = householdKey(HOUSE, SALT);
    expect(husband).toBe(wife);
    expect(evaluateSuppression([optOut], { householdKey: husband }).suppressed).toBe(true);
    expect(evaluateSuppression([optOut], { householdKey: wife }).suppressed).toBe(true);
  });
});

describe("evaluateSuppression — effective date gating", () => {
  it("ignores a rule not yet in effect on the send date", () => {
    const future: SuppressionRow = { ...optOut, effective_from: "2027-01-01" };
    expect(evaluateSuppression([future], { householdKey: HK, asOf: "2026-06-23" }))
      .toEqual({ suppressed: false });
  });

  it("applies a rule effective on or before the send date", () => {
    expect(evaluateSuppression([optOut], { householdKey: HK, asOf: "2020-01-01" }).suppressed)
      .toBe(true);
  });
});

describe("evaluateSuppression — piece-scoped already_mailed dedup", () => {
  const mailed: SuppressionRow = {
    scope: "piece",
    household_key: HK,
    recipient_hash: null,
    piece_code: "07",
    reason: "already_mailed",
    effective_from: "2021-09-07",
  };

  it("suppresses re-mailing the same piece to the same household", () => {
    expect(evaluateSuppression([mailed], { householdKey: HK, pieceCode: "07", asOf: "2026-06-23" }))
      .toEqual({ suppressed: true, reason: "already_mailed" });
  });

  it("allows a DIFFERENT piece to the same household", () => {
    expect(evaluateSuppression([mailed], { householdKey: HK, pieceCode: "10", asOf: "2026-06-23" }))
      .toEqual({ suppressed: false });
  });

  it("does not suppress when no piece is supplied", () => {
    expect(evaluateSuppression([mailed], { householdKey: HK, asOf: "2026-06-23" }))
      .toEqual({ suppressed: false });
  });
});

describe("evaluateSuppression — most-restrictive reason wins", () => {
  it("reports opt_out over already_mailed when both match", () => {
    const mailed: SuppressionRow = {
      scope: "piece", household_key: HK, recipient_hash: null,
      piece_code: "07", reason: "already_mailed", effective_from: "2021-09-07",
    };
    const r = evaluateSuppression([mailed, optOut], { householdKey: HK, pieceCode: "07" });
    expect(r).toEqual({ suppressed: true, reason: "opt_out" });
  });
});

describe("evaluateSuppression — recipient-scoped bad_address", () => {
  it("suppresses the specific recipient, not the household", () => {
    const rh = recipientHash("John Smith", HOUSE, SALT);
    const bad: SuppressionRow = {
      scope: "recipient", household_key: null, recipient_hash: rh,
      piece_code: null, reason: "bad_address", effective_from: "2022-01-01",
    };
    expect(evaluateSuppression([bad], { recipientHash: rh }).suppressed).toBe(true);
    // A sibling at the same household (no recipient match) is not suppressed by it.
    expect(evaluateSuppression([bad], { householdKey: HK }).suppressed).toBe(false);
  });
});

describe("evaluateSuppression — fail-safe", () => {
  it("treats a recipient with no keys as not suppressed", () => {
    expect(evaluateSuppression([optOut], {})).toEqual({ suppressed: false });
  });
});

describe("isSuppressed — DB fetch path (injected client)", () => {
  function fakeClient(rows: SuppressionRow[], capture?: (f: string) => void): SuppressionQueryClient {
    return {
      from() {
        return {
          select() {
            return {
              or(filter: string) {
                capture?.(filter);
                return {
                  async lte() {
                    return { data: rows, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  it("fetches + evaluates: suppresses an opted-out household", async () => {
    let seenFilter = "";
    const client = fakeClient([optOut], (f) => (seenFilter = f));
    const r = await isSuppressed({ householdKey: HK, asOf: "2026-06-23" }, { client });
    expect(r).toEqual({ suppressed: true, reason: "opt_out" });
    expect(seenFilter).toContain(`household_key.eq.${HK}`);
  });

  it("short-circuits (no DB call) when the query has no keys", async () => {
    let called = false;
    const client = fakeClient([optOut], () => (called = true));
    const r = await isSuppressed({}, { client });
    expect(r).toEqual({ suppressed: false });
    expect(called).toBe(false);
  });

  it("uses pre-fetched rows directly when provided", async () => {
    const r = await isSuppressed({ householdKey: HK }, { rows: [optOut] });
    expect(r.suppressed).toBe(true);
  });
});

describe("seed builders", () => {
  it("flagSuppressionRow: opt-out → household scope + stable ref", () => {
    const row = flagSuppressionRow({
      address: HOUSE, reason: "opt_out", effectiveFrom: "2020-01-01", hash: SALT,
    });
    expect(row).not.toBeNull();
    expect(row!.scope).toBe("household");
    expect(row!.household_key).toBe(HK);
    expect(row!.suppression_ref).toBe(`opt_out:household:${HK}`);
    // Idempotent: rebuilding the same flag yields the same ref.
    const again = flagSuppressionRow({
      address: HOUSE, reason: "opt_out", effectiveFrom: "2020-01-01", hash: SALT,
    });
    expect(again!.suppression_ref).toBe(row!.suppression_ref);
  });

  it("flagSuppressionRow: bad_address → recipient scope", () => {
    const row = flagSuppressionRow({
      name: "John Smith", address: HOUSE, reason: "bad_address",
      effectiveFrom: "2022-01-01", hash: SALT,
    });
    expect(row!.scope).toBe("recipient");
    expect(row!.recipient_hash).toBe(recipientHash("John Smith", HOUSE, SALT));
  });

  it("flagSuppressionRow: returns null when no usable key", () => {
    expect(flagSuppressionRow({ address: {}, reason: "opt_out", effectiveFrom: "2020-01-01", hash: SALT }))
      .toBeNull();
  });

  it("alreadyMailedRow: piece scope + deterministic ref", () => {
    const row = alreadyMailedRow({ householdKey: HK, pieceCode: "07", sentDate: "2021-09-07" });
    expect(row.scope).toBe("piece");
    expect(row.reason).toBe("already_mailed");
    expect(row.piece_code).toBe("07");
    expect(row.effective_from).toBe("2021-09-07");
    expect(row.suppression_ref).toBe(buildSuppressionRef("already_mailed", "piece", HK, "07"));
  });
});
