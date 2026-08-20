import { describe, expect, it } from "vitest";
import { getMissingFields, getRequestSummary, isFieldRequired, requestErrorMessage } from "../customer-request-actions";

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

  it("marks conditional fields as required only when the form rule requires them", () => {
    expect(isFieldRequired("destination_change", { key: "phoneNumber", label: "New phone number", type: "tel" }, {})).toBe(false);
    expect(isFieldRequired("destination_change", { key: "landingPage", label: "New landing page", type: "url" }, {})).toBe(false);
    expect(isFieldRequired("campaign_status_change", { key: "pauseUntil", label: "If pausing, until when?" }, { action: "Restart" })).toBe(false);
    expect(isFieldRequired("campaign_status_change", { key: "pauseUntil", label: "If pausing, until when?" }, { action: "Pause" })).toBe(true);
  });

  it("keeps new-campaign end date and destinations optional", () => {
    expect(getMissingFields("new_campaign", {
      service: "Collision repair", offer: "Free estimate", area: "Riverside", startDate: "2026-09-01", budgetGuidance: "2000",
    }, false)).toEqual([]);
  });

  it("omits blank optional new-campaign values from review and submission details", () => {
    expect(getRequestSummary("new_campaign", {
      service: "Collision repair", offer: "Free estimate", area: "Riverside", startDate: "2026-09-01", budgetGuidance: "2000",
      endDate: "", landingPage: "   ", phoneNumber: "",
    })).toEqual([
      { label: "Service to promote", value: "Collision repair" },
      { label: "Offer or message", value: "Free estimate" },
      { label: "Area to cover", value: "Riverside" },
      { label: "Start date", value: "2026-09-01" },
      { label: "Monthly budget guidance", value: "2000" },
    ]);
  });

  it("distinguishes permission, validation, server, and network failures", () => {
    expect(requestErrorMessage(403)).toMatch(/owner or manager/i);
    expect(requestErrorMessage(400)).toMatch(/field needs attention/i);
    expect(requestErrorMessage(500)).toMatch(/our side/i);
    expect(requestErrorMessage()).toMatch(/internet connection/i);
  });
});
