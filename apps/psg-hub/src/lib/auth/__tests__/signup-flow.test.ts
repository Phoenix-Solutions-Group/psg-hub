import { describe, expect, it } from "vitest";
import {
  CONFIRM_EMAIL_MESSAGE,
  EXISTING_ACCOUNT_MESSAGE,
  resolveSignupOutcome,
} from "@/lib/auth/signup-flow";

describe("resolveSignupOutcome", () => {
  it("detects Supabase duplicate-email responses with empty identities", () => {
    expect(
      resolveSignupOutcome({
        data: {
          user: {
            identities: [],
          },
          session: null,
        },
        error: null,
      })
    ).toEqual({
      kind: "existing_account",
      message: EXISTING_ACCOUNT_MESSAGE,
    });
  });

  it("detects duplicate-email auth errors", () => {
    expect(
      resolveSignupOutcome({
        data: null,
        error: {
          message: "User already registered",
        },
      })
    ).toEqual({
      kind: "existing_account",
      message: EXISTING_ACCOUNT_MESSAGE,
    });
  });

  it("tells a new email to confirm before logging in when no session is returned", () => {
    expect(
      resolveSignupOutcome({
        data: {
          user: {
            identities: [{ id: "identity-1" }],
          },
          session: null,
        },
        error: null,
      })
    ).toEqual({
      kind: "confirmation_required",
      message: CONFIRM_EMAIL_MESSAGE,
    });
  });

  it("allows immediate dashboard routing when signup returns a session", () => {
    expect(
      resolveSignupOutcome({
        data: {
          user: {
            identities: [{ id: "identity-1" }],
          },
          session: { access_token: "token" },
        },
        error: null,
      })
    ).toEqual({
      kind: "signed_in",
    });
  });
});
