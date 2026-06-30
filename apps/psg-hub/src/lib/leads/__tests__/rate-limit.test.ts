import { describe, it, expect, vi, beforeEach } from "vitest";

// Each terminal query (.gte) consumes the next queued result. assertWithinLeadLimits
// runs two counts (per-IP, then global), so push them in that order.
const gteResults: Array<{ count: number | null; error: unknown }> = [];
const inserted: Array<Record<string, unknown>> = [];
let insertError: { message: string } | null = null;
let insertThrows = false;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn(() => Promise.resolve(gteResults.shift())),
      insert: vi.fn((row: Record<string, unknown>) => {
        if (insertThrows) throw new Error("insert blew up");
        inserted.push(row);
        return Promise.resolve({ error: insertError });
      }),
    })),
  })),
}));

const {
  assertWithinLeadLimits,
  recordLeadSubmission,
  LeadRateLimitError,
  clientIp,
  hashIp,
} = await import("@/lib/leads/rate-limit");

beforeEach(() => {
  gteResults.length = 0;
  inserted.length = 0;
  insertError = null;
  insertThrows = false;
});

describe("assertWithinLeadLimits", () => {
  it("resolves when both the per-IP and global windows are under limit", async () => {
    gteResults.push({ count: 0, error: null }, { count: 0, error: null });
    await expect(assertWithinLeadLimits({ ipHash: "h" })).resolves.toBeUndefined();
  });

  it("throws per_ip when the IP window is at limit", async () => {
    gteResults.push({ count: 5, error: null });
    await expect(assertWithinLeadLimits({ ipHash: "h" })).rejects.toMatchObject({
      scope: "per_ip",
    });
  });

  it("throws global when the global window is at limit", async () => {
    gteResults.push({ count: 0, error: null }, { count: 60, error: null });
    const err = await assertWithinLeadLimits({ ipHash: "h" }).catch((e) => e);
    expect(err).toBeInstanceOf(LeadRateLimitError);
    expect(err.scope).toBe("global");
  });

  it("throws a generic error (fail-closed) when the IP count query errors", async () => {
    gteResults.push({ count: null, error: { message: "boom" } });
    await expect(assertWithinLeadLimits({ ipHash: "h" })).rejects.toThrow(
      /lead rate-limit check failed/,
    );
  });

  it("throws a generic error when the global count query errors", async () => {
    gteResults.push(
      { count: 0, error: null },
      { count: null, error: { message: "boom2" } },
    );
    await expect(assertWithinLeadLimits({ ipHash: "h" })).rejects.toThrow(
      /lead rate-limit check failed/,
    );
  });
});

describe("recordLeadSubmission", () => {
  it("inserts a hashed-IP row with the outcome", async () => {
    await recordLeadSubmission({ ipHash: "abc", outcome: "accepted" });
    expect(inserted).toEqual([{ ip_hash: "abc", outcome: "accepted" }]);
  });

  it("is best-effort: a DB error never throws (lead is not failed)", async () => {
    insertError = { message: "write failed" };
    await expect(
      recordLeadSubmission({ ipHash: "abc", outcome: "honeypot" }),
    ).resolves.toBeUndefined();
  });

  it("is best-effort: a thrown insert never propagates", async () => {
    insertThrows = true;
    await expect(
      recordLeadSubmission({ ipHash: "abc", outcome: "honeypot" }),
    ).resolves.toBeUndefined();
  });
});

describe("clientIp", () => {
  function req(headers: Record<string, string>): Request {
    return new Request("https://psg.example/api/leads/inbound", { headers });
  }

  it("takes the first hop of x-forwarded-for", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 70.0.0.1, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip, then to a shared 'unknown' bucket", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(req({}))).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("is deterministic for the same IP + salt, and hides the raw IP", () => {
    const a = hashIp("203.0.113.7", { salt: "s" });
    const b = hashIp("203.0.113.7", { salt: "s" });
    expect(a).toBe(b);
    expect(a).not.toContain("203.0.113.7");
    expect(a).toHaveLength(64); // sha256 hex
  });

  it("differs by IP and by salt", () => {
    expect(hashIp("1.1.1.1", { salt: "s" })).not.toBe(hashIp("2.2.2.2", { salt: "s" }));
    expect(hashIp("1.1.1.1", { salt: "s1" })).not.toBe(hashIp("1.1.1.1", { salt: "s2" }));
  });
});
