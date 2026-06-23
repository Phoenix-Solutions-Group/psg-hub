import { describe, it, expect } from "vitest";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "../token";

const SECRET = "test-unsub-secret";

describe("unsubscribe token", () => {
  it("round-trips a signed token to the normalized contact", () => {
    const token = makeUnsubscribeToken("email", " Jordan@Shop.COM ", { secret: SECRET });
    expect(token).not.toBe("");
    const verified = verifyUnsubscribeToken(token, { secret: SECRET });
    expect(verified).toEqual({ channel: "email", contact: "jordan@shop.com" });
  });

  it("normalizes the phone before minting (sms channel)", () => {
    const token = makeUnsubscribeToken("sms", "(555) 867-5309", { secret: SECRET });
    expect(verifyUnsubscribeToken(token, { secret: SECRET })).toEqual({
      channel: "sms",
      contact: "+15558675309",
    });
  });

  it("returns '' for an unusable contact", () => {
    expect(makeUnsubscribeToken("email", "nope", { secret: SECRET })).toBe("");
  });

  it("rejects a token signed with a different secret", () => {
    const token = makeUnsubscribeToken("email", "jordan@shop.com", { secret: SECRET });
    expect(verifyUnsubscribeToken(token, { secret: "other" })).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = makeUnsubscribeToken("email", "jordan@shop.com", { secret: SECRET });
    const [, sig] = token.split(".");
    // Swap the payload but keep the old signature → must fail.
    const forged = `${Buffer.from("email:evil@attacker.com").toString("base64url")}.${sig}`;
    expect(verifyUnsubscribeToken(forged, { secret: SECRET })).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyUnsubscribeToken(null, { secret: SECRET })).toBeNull();
    expect(verifyUnsubscribeToken("", { secret: SECRET })).toBeNull();
    expect(verifyUnsubscribeToken("no-dot", { secret: SECRET })).toBeNull();
    expect(verifyUnsubscribeToken(".sig", { secret: SECRET })).toBeNull();
  });
});
