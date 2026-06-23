import { describe, it, expect } from "vitest";
import { buildSendPlan, type SendPlanInput } from "../plan";

const ready: SendPlanInput = {
  channels: ["email", "sms"],
  consent: { sms: true, email: true },
  optedOut: {},
  hasContact: { email: true, sms: true },
  suppressed: false,
};

function plan(overrides: Partial<SendPlanInput>) {
  return buildSendPlan({ ...ready, ...overrides });
}

describe("buildSendPlan", () => {
  it("sends both channels when consented, contactable, not opted out", () => {
    expect(plan({})).toEqual([
      { channel: "email", action: "send" },
      { channel: "sms", action: "send" },
    ]);
  });

  it("skips SMS without prior express consent (TCPA), still sends email", () => {
    const out = plan({ consent: { email: true, sms: false } });
    expect(out.find((d) => d.channel === "sms")).toEqual({
      channel: "sms",
      action: "skip",
      reason: "no_consent",
    });
    expect(out.find((d) => d.channel === "email")?.action).toBe("send");
  });

  it("email never requires prior consent", () => {
    const out = plan({ channels: ["email"], consent: {} });
    expect(out).toEqual([{ channel: "email", action: "send" }]);
  });

  it("skips an opted-out channel", () => {
    const out = plan({ optedOut: { email: true } });
    expect(out.find((d) => d.channel === "email")).toEqual({
      channel: "email",
      action: "skip",
      reason: "opted_out",
    });
  });

  it("household suppression kills EVERY channel", () => {
    const out = plan({ suppressed: true });
    expect(out.every((d) => d.action === "skip" && d.reason === "suppressed")).toBe(true);
  });

  it("suppression outranks consent + opt-out (most-restrictive wins)", () => {
    const out = plan({ suppressed: true, optedOut: { sms: true }, consent: {} });
    expect(out.map((d) => d.reason)).toEqual(["suppressed", "suppressed"]);
  });

  it("skips a channel with no usable contact", () => {
    const out = plan({ hasContact: { email: false, sms: true } });
    expect(out.find((d) => d.channel === "email")?.reason).toBe("no_contact");
  });

  it("de-dupes repeated channels, preserving order", () => {
    const out = plan({ channels: ["sms", "sms", "email"] });
    expect(out.map((d) => d.channel)).toEqual(["sms", "email"]);
  });
});
