import { describe, expect, it } from "vitest";
import {
  evaluateDirectMailEligibility,
  evaluateEligibilityBatch,
  extractRoCompletedAt,
  hasOpenSurveyAlert,
  letterKindForProduct,
  periodKeyFor,
  printableReasons,
  type EligibilityCustomer,
} from "../eligibility";

const printableCustomer: EligibilityCustomer = {
  id: "cust-1",
  firstName: "Alex",
  lastName: "Driver",
  address: {
    line1: "9 Elm St",
    city: "Austin",
    state: "TX",
    postal_code: "78701",
  },
  roCompletedAt: "2026-04-08",
};

describe("direct-mail eligibility", () => {
  it("marks an in-window three-month customer eligible", () => {
    const decision = evaluateDirectMailEligibility(printableCustomer, {
      letterKind: "three_month",
      asOf: "2026-07-17",
    });
    expect(decision).toMatchObject({
      repairCustomerId: "cust-1",
      eligible: true,
      printable: true,
      suppressedByAlert: false,
      periodKey: "three_month:2026-04",
    });
  });

  it("suppresses an otherwise eligible customer with an open survey alert", () => {
    const decision = evaluateDirectMailEligibility(
      {
        ...printableCustomer,
        surveyAlerts: [{ alertClass: "hotspot", alertPostedAt: "2026-06-30" }],
      },
      { letterKind: "three_month", asOf: "2026-07-17" }
    );
    expect(decision.eligible).toBe(false);
    expect(decision.suppressedByAlert).toBe(true);
    expect(decision.reasons).toContain("suppressed_by_open_survey_alert");
  });

  it("ignores none and expired survey alerts", () => {
    expect(
      hasOpenSurveyAlert(
        [
          { alertClass: "none", alertPostedAt: "2026-07-01" },
          { alertClass: "unresolved", alertPostedAt: "2025-12-01" },
        ],
        "2026-07-17"
      )
    ).toBe(false);
  });

  it("separates non-printable records with clear reasons", () => {
    const reasons = printableReasons({
      id: "cust-2",
      firstName: "",
      lastName: "",
      address: { line1: "", city: "Austin", state: "", postal_code: "" },
    });
    expect(reasons).toEqual([
      "missing_name",
      "missing_address_line1",
      "missing_state",
      "missing_postal_code",
    ]);
  });

  it("rejects out-of-window customers", () => {
    const decision = evaluateDirectMailEligibility(
      { ...printableCustomer, roCompletedAt: "2026-01-01" },
      { letterKind: "three_month", asOf: "2026-07-17" }
    );
    expect(decision.eligible).toBe(false);
    expect(decision.reasons).toContain("outside_date_window");
  });

  it("returns a stable period key for idempotent upserts", () => {
    const a = periodKeyFor("three_month", printableCustomer, "2026-07-17");
    const b = periodKeyFor("three_month", printableCustomer, "2026-07-18");
    expect(a).toBe("three_month:2026-04");
    expect(b).toBe(a);
  });

  it("summarizes eligible, non-printable, and suppressed buckets", () => {
    const batch = evaluateEligibilityBatch(
      [
        printableCustomer,
        { ...printableCustomer, id: "cust-2", address: { line1: "", city: "", state: "", postal_code: "" } },
        {
          ...printableCustomer,
          id: "cust-3",
          surveyAlerts: [{ alertClass: "misfire", alertPostedAt: "2026-07-01" }],
        },
      ],
      { letterKind: "three_month", asOf: "2026-07-17" }
    );
    expect(batch.eligibleIds).toEqual(["cust-1"]);
    expect(batch.nonPrintable.map((d) => d.repairCustomerId)).toEqual(["cust-2"]);
    expect(batch.suppressed.map((d) => d.repairCustomerId)).toEqual(["cust-3"]);
  });

  it("maps live production products to FileMaker letter kinds", () => {
    expect(letterKindForProduct("thank_you")).toBe("thank_you");
    expect(letterKindForProduct("warranty")).toBe("one_year");
    expect(letterKindForProduct("service_recovery")).toBe("referral");
  });

  it("extracts RO completion dates from the known import keys", () => {
    expect(extractRoCompletedAt({ completed_at: "2026-04-08T12:00:00Z" })).toBe("2026-04-08");
    expect(extractRoCompletedAt({ nope: "2026-04-08" })).toBeNull();
  });
});
