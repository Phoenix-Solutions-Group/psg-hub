import { describe, it, expect } from "vitest";
import {
  buildSolicitationDraft,
  validateDraftCompliance,
  type SolicitationDraftInput,
} from "../draft";

const base: SolicitationDraftInput = {
  shopName: "Westside Collision",
  recipientFirstName: "Jordan",
  reviewUrl: "https://g.page/r/westside/review",
  unsubscribeUrl: "https://hub.psgweb.me/api/unsubscribe?token=abc.def",
  senderPostalAddress: "123 Main St, Springfield, IL 62704",
  channels: ["email", "sms"],
};

describe("buildSolicitationDraft — email", () => {
  const draft = buildSolicitationDraft(base);

  it("renders subject + the review link in text and html", () => {
    expect(draft.email?.subject).toContain("Westside Collision");
    expect(draft.email?.text).toContain(base.reviewUrl);
    expect(draft.email?.html).toContain(`href="${base.reviewUrl}"`);
  });

  it("includes the CAN-SPAM footer: physical address + unsubscribe link", () => {
    expect(draft.email?.text).toContain(base.senderPostalAddress);
    expect(draft.email?.text).toContain(base.unsubscribeUrl);
    expect(draft.email?.html).toContain(base.unsubscribeUrl as string);
  });

  it("greets by first name, or neutrally when unknown", () => {
    expect(draft.email?.text.startsWith("Hi Jordan,")).toBe(true);
    const anon = buildSolicitationDraft({ ...base, recipientFirstName: null });
    expect(anon.email?.text.startsWith("Hi there,")).toBe(true);
  });

  it("escapes html-significant characters in the shop name", () => {
    const evil = buildSolicitationDraft({ ...base, shopName: "A & B <Body>" });
    expect(evil.email?.html).toContain("A &amp; B &lt;Body&gt;");
    expect(evil.email?.html).not.toContain("<Body>");
  });

  it("uses plain language (no AI/marketing vocabulary)", () => {
    const blob = `${base.shopName} ${JSON.stringify(buildSolicitationDraft(base))}`.toLowerCase();
    for (const word of [
      "delve",
      "elevate",
      "seamless",
      "unlock",
      "leverage",
      "supercharge",
      "unparalleled",
      "tapestry",
    ]) {
      expect(blob).not.toContain(word);
    }
  });
});

describe("buildSolicitationDraft — sms", () => {
  it("carries the mandatory STOP notice and the review link", () => {
    const draft = buildSolicitationDraft({ ...base, channels: ["sms"] });
    expect(draft.sms?.body).toMatch(/reply stop/i);
    expect(draft.sms?.body).toContain(base.reviewUrl);
    expect(draft.email).toBeUndefined();
  });
});

describe("validateDraftCompliance", () => {
  it("passes a fully-formed draft", () => {
    const draft = buildSolicitationDraft(base);
    expect(
      validateDraftCompliance(draft, {
        unsubscribeUrl: base.unsubscribeUrl,
        senderPostalAddress: base.senderPostalAddress,
      })
    ).toEqual([]);
  });

  it("flags a missing unsubscribe URL", () => {
    const draft = buildSolicitationDraft({ ...base, unsubscribeUrl: "" });
    const issues = validateDraftCompliance(draft, {
      unsubscribeUrl: "",
      senderPostalAddress: base.senderPostalAddress,
    });
    expect(issues.join(" ")).toMatch(/unsubscribe/i);
  });

  it("flags a missing physical address", () => {
    const issues = validateDraftCompliance(buildSolicitationDraft(base), {
      unsubscribeUrl: base.unsubscribeUrl,
      senderPostalAddress: "",
    });
    expect(issues.join(" ")).toMatch(/postal address/i);
  });

  it("flags an SMS body with no STOP notice", () => {
    const issues = validateDraftCompliance({ sms: { body: "leave a review pls" } });
    expect(issues.join(" ")).toMatch(/stop/i);
  });
});
