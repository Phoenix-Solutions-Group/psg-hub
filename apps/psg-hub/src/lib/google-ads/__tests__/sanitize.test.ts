import { describe, it, expect } from "vitest";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";

describe("sanitizeLastError", () => {
  it("returns empty for null/undefined", () => {
    expect(sanitizeLastError(null)).toBe("");
    expect(sanitizeLastError(undefined)).toBe("");
  });

  it("truncates to 500 chars", () => {
    const long = "x".repeat(800);
    expect(sanitizeLastError(long).length).toBeLessThanOrEqual(500);
  });

  it("redacts digit sequences ≥7 chars", () => {
    const out = sanitizeLastError("Error on customer 1234567890 at row 42");
    expect(out).not.toContain("1234567890");
    expect(out).toContain("[REDACTED_ID]");
    // Short digit (42) retained
    expect(out).toContain("42");
  });

  it("redacts email addresses", () => {
    const out = sanitizeLastError("Permission denied for user foo@bar.com");
    expect(out).not.toContain("foo@bar.com");
    expect(out).toContain("[REDACTED_EMAIL]");
  });

  it("handles both in one pass", () => {
    const out = sanitizeLastError("user jane@co.io customer 9876543210 failed");
    expect(out).not.toContain("jane@co.io");
    expect(out).not.toContain("9876543210");
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(out).toContain("[REDACTED_ID]");
  });
});
