import { describe, it, expect } from "vitest";
import { checkResponseSafety } from "@/lib/reviews/safety";

describe("checkResponseSafety", () => {
  describe("phone numbers", () => {
    it("catches (402) 555-1234 format", () => {
      const r = checkResponseSafety("Call us at (402) 555-1234 for help.");
      expect(r.flags).toContain("phone_number");
      expect(r.blocked).toBe(false);
    });
    it("catches 402-555-1234 format", () => {
      const r = checkResponseSafety("Reach out at 402-555-1234.");
      expect(r.flags).toContain("phone_number");
    });
    it("catches +1 402 555 1234 format", () => {
      const r = checkResponseSafety("Call +1 402 555 1234 for details.");
      expect(r.flags).toContain("phone_number");
    });
  });

  it("catches email addresses", () => {
    const r = checkResponseSafety("Email us at foo@bar.com.");
    expect(r.flags).toContain("email_address");
  });

  it("catches URLs", () => {
    const r1 = checkResponseSafety("See https://example.com for details.");
    expect(r1.flags).toContain("url");
    const r2 = checkResponseSafety("Visit www.example.com.");
    expect(r2.flags).toContain("url");
  });

  describe("admissions of fault", () => {
    it("catches 'we were at fault'", () => {
      const r = checkResponseSafety("We were at fault here and we are sorry.");
      expect(r.flags).toContain("admission_of_fault");
      expect(r.blocked).toBe(true);
    });
    it("catches 'our mistake caused' (case-insensitive)", () => {
      const r = checkResponseSafety("OUR MISTAKE CAUSED the delay.");
      expect(r.flags).toContain("admission_of_fault");
      expect(r.blocked).toBe(true);
    });
    it("catches 'we are at fault'", () => {
      const r = checkResponseSafety("We are at fault for this.");
      expect(r.flags).toContain("admission_of_fault");
    });
  });

  describe("insurance promises", () => {
    it("catches 'insurance will cover'", () => {
      const r = checkResponseSafety("Your insurance will cover everything.");
      expect(r.flags).toContain("insurance_promise");
      expect(r.blocked).toBe(true);
    });
    it("catches 'your insurer must pay'", () => {
      const r = checkResponseSafety("Your insurer must pay for the repair.");
      expect(r.flags).toContain("insurance_promise");
    });
  });

  it("clean text returns no flags", () => {
    const r = checkResponseSafety(
      "Thanks for the feedback. We are glad the repair worked out."
    );
    expect(r.flags).toEqual([]);
    expect(r.blocked).toBe(false);
  });
});
