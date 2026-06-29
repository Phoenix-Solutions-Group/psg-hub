import { describe, it, expect } from "vitest";
import { intakeGateDecision } from "@/app/ops/intake/page";

// PSG-402 — the page gate mirrors the route's requireSuperadmin. These assert the
// pure decision; the route's own gate (401/403) is covered in the route test.
describe("intakeGateDecision (pure superadmin gate)", () => {
  it("no session → redirect to /login", () => {
    expect(intakeGateDecision({ hasUser: false, role: null })).toBe("redirect-login");
    // a stale role with no user still redirects (user check wins).
    expect(intakeGateDecision({ hasUser: false, role: "psg_superadmin" })).toBe("redirect-login");
  });

  it("authenticated non-superadmin → restricted block", () => {
    expect(intakeGateDecision({ hasUser: true, role: null })).toBe("restricted");
    expect(intakeGateDecision({ hasUser: true, role: "psg_internal" })).toBe("restricted");
    expect(intakeGateDecision({ hasUser: true, role: "shop_admin" })).toBe("restricted");
  });

  it("psg_superadmin → allow", () => {
    expect(intakeGateDecision({ hasUser: true, role: "psg_superadmin" })).toBe("allow");
  });
});
