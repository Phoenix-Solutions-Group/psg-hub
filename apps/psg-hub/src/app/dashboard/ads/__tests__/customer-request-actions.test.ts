import { describe, expect, it } from "vitest";
import { getMissingFields, requestErrorMessage } from "../customer-request-actions";
import { friendlyStatus } from "../page";

describe("customer Ads request rules", () => {
  it("requires a campaign and the required budget fields, but not a current budget", () => {
    expect(getMissingFields("budget_change", {}, false)).toEqual([
      "Campaign",
      "Requested monthly budget",
      "Why do you want this change?",
      "When would you like it?",
    ]);
  });

  it("only requires a pause-until value when pausing", () => {
    const base = { reason: "Seasonal", requestedDate: "2026-09-01" };
    expect(getMissingFields("campaign_status_change", { ...base, action: "Restart" }, true)).toEqual([]);
    expect(getMissingFields("campaign_status_change", { ...base, action: "Pause" }, true)).toEqual(["If pausing, until when?"]);
  });

  it("accepts either destination and explains when both are missing", () => {
    expect(getMissingFields("destination_change", { phoneNumber: "555-0100" }, true)).toEqual([]);
    expect(getMissingFields("destination_change", { landingPage: "https://example.com" }, true)).toEqual([]);
    expect(getMissingFields("destination_change", {}, true)).toEqual(["A new phone number or landing page"]);
  });

  it("keeps new-campaign end date and destinations optional", () => {
    expect(getMissingFields("new_campaign", {
      service: "Collision repair", offer: "Free estimate", area: "Riverside", startDate: "2026-09-01", budgetGuidance: "2000",
    }, false)).toEqual([]);
  });

  it("distinguishes permission, validation, server, and network failures", () => {
    expect(requestErrorMessage(403)).toMatch(/owner or manager/i);
    expect(requestErrorMessage(400)).toMatch(/field needs attention/i);
    expect(requestErrorMessage(500)).toMatch(/our side/i);
    expect(requestErrorMessage()).toMatch(/internet connection/i);
  });

  it("uses completion wording that matches the request type", () => {
    expect(friendlyStatus("done", "problem_report")).toBe("Answered");
    expect(friendlyStatus("done", "performance_review")).toBe("Answered");
    expect(friendlyStatus("done", "budget_change")).toBe("Done – the change is live");
  });
});
