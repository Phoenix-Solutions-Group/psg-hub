import { describe, expect, it } from "vitest";
import { buildNurturePlan, pathForTrigger } from "..";

const NOW = new Date("2026-07-11T12:00:00.000Z");

describe("Wave 1 nurture planner", () => {
  it("maps approved Wave 1 triggers to the right paths", () => {
    expect(pathForTrigger("web_lead")).toBe("hot_inbound");
    expect(pathForTrigger("deal_stale_14_days")).toBe("stalled_deal");
    expect(pathForTrigger("deal_won")).toBe("onboarding_retention");
  });

  it("allows email while blocking SMS until texting consent is recorded", () => {
    const plan = buildNurturePlan({
      path: "hot_inbound",
      now: NOW,
      contact: {
        firstName: "Pat",
        email: "pat@example.com",
        phone: "555-867-5309",
        smsConsent: false,
      },
    });

    expect(plan.find((d) => d.channel === "email")).toMatchObject({ action: "send" });
    expect(plan.find((d) => d.channel === "sms")).toMatchObject({
      action: "skip",
      reason: "no_consent",
    });
  });

  it("sends SMS only with consent and a valid phone number", () => {
    const plan = buildNurturePlan({
      path: "stalled_deal",
      now: NOW,
      contact: {
        email: "owner@shop.com",
        phone: "(555) 867-5309",
        smsConsent: true,
      },
    });

    expect(plan.find((d) => d.channel === "sms")).toMatchObject({ action: "send" });
  });

  it("hard-stops every channel when the contact is do-not-contact", () => {
    const plan = buildNurturePlan({
      path: "onboarding_retention",
      now: NOW,
      contact: {
        email: "owner@shop.com",
        phone: "+15558675309",
        smsConsent: true,
        doNotContact: true,
      },
    });

    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((d) => d.action === "skip" && d.reason === "do_not_contact")).toBe(true);
  });
});
