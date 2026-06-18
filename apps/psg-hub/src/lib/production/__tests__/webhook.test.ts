import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLobSignature, normalizeLobEvent } from "@/lib/production/webhook";

const SECRET = "whsec_test";
const NOW = 1_750_000_000_000; // fixed clock (ms)

function sign(rawBody: string, timestamp: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

describe("verifyLobSignature", () => {
  const rawBody = JSON.stringify({ event_type: { id: "postcard.delivered" } });
  const ts = String(NOW);

  it("accepts a valid signature within tolerance", () => {
    const sig = sign(rawBody, ts);
    expect(verifyLobSignature({ rawBody, signature: sig, timestamp: ts, secret: SECRET, nowMs: NOW }))
      .toEqual({ valid: true });
  });

  it("rejects a tampered body", () => {
    const sig = sign(rawBody, ts);
    const result = verifyLobSignature({
      rawBody: rawBody + "x",
      signature: sig,
      timestamp: ts,
      secret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp (replay defense)", () => {
    const oldTs = String(NOW - 10 * 60 * 1000); // 10 min old
    const sig = sign(rawBody, oldTs);
    const result = verifyLobSignature({
      rawBody,
      signature: sig,
      timestamp: oldTs,
      secret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ valid: false, reason: "stale" });
  });

  it("rejects missing signature / timestamp / secret", () => {
    expect(verifyLobSignature({ rawBody, signature: null, timestamp: ts, secret: SECRET, nowMs: NOW }))
      .toEqual({ valid: false, reason: "missing" });
    expect(verifyLobSignature({ rawBody, signature: "x", timestamp: null, secret: SECRET, nowMs: NOW }))
      .toEqual({ valid: false, reason: "missing" });
    expect(verifyLobSignature({ rawBody, signature: "x", timestamp: ts, secret: "", nowMs: NOW }))
      .toEqual({ valid: false, reason: "missing" });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const result = verifyLobSignature({
      rawBody,
      signature: "deadbeef",
      timestamp: ts,
      secret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });
});

describe("normalizeLobEvent", () => {
  it("normalizes a Lob status event", () => {
    const parsed = {
      event_type: { id: "postcard.delivered" },
      date_created: "2026-07-01T12:00:00Z",
      body: { id: "psc_abc123", expected_delivery_date: "2026-07-01" },
    };
    expect(normalizeLobEvent(parsed)).toEqual({
      vendor: "lob",
      externalId: "psc_abc123",
      status: "delivered",
      eventType: "postcard.delivered",
      occurredAt: "2026-07-01T12:00:00Z",
      raw: parsed,
    });
  });

  it("returns null for an unrecognized shape", () => {
    expect(normalizeLobEvent({})).toBeNull();
    expect(normalizeLobEvent(null)).toBeNull();
    expect(normalizeLobEvent({ event_type: { id: "x" } })).toBeNull(); // no body.id
  });
});
