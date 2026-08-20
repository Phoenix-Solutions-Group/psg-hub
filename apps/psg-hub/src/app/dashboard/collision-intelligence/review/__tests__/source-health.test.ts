import { describe, expect, it } from "vitest";
import { isMissingReviewView } from "../source-health";

describe("isMissingReviewView", () => {
  it("accepts only the named missing view", () => {
    const error = {
      code: "PGRST205",
      message:
        "Could not find the table 'public.v_collision_forecast_readiness' in the schema cache",
    };

    expect(isMissingReviewView(error, "v_collision_forecast_readiness")).toBe(
      true,
    );
    expect(
      isMissingReviewView(error, "v_collision_storm_source_reconciliation"),
    ).toBe(false);
    expect(
      isMissingReviewView(
        { ...error, code: "42501" },
        "v_collision_forecast_readiness",
      ),
    ).toBe(false);
  });
});
