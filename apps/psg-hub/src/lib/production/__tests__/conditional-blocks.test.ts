import { describe, it, expect } from "vitest";
import {
  renderConditionalBlocks,
  renderMergeFields,
  type MailMergeData,
} from "@/lib/production/templates";
import { attributesToFlags, type CustomerAttributes } from "@/lib/production/triggers";

/**
 * L2 — Conditional content blocks (PSG-115c acceptance #1):
 * one template yields materially different, correct copy by attribute.
 */

function data(flags: MailMergeData["flags"]): MailMergeData {
  return {
    customer: { firstName: "Jane", lastName: "Doe", vehicle: "2021 Accord" },
    company: { name: "Ace Body Shop" },
    program: {},
    flags,
  };
}

describe("renderConditionalBlocks", () => {
  it("leaves a template with no #if untouched (pure-merge fast path)", () => {
    const tpl = "Hi {{customer.firstName}} from {{company.name}}";
    expect(renderConditionalBlocks(tpl, data({}))).toBe(tpl);
  });

  it("selects the then-branch when the flag is truthy", () => {
    const tpl = "{{#if flags.isEV}}EV care{{else}}gas care{{/if}}";
    expect(renderConditionalBlocks(tpl, data({ isEV: true }))).toBe("EV care");
  });

  it("selects the else-branch when the flag is falsy", () => {
    const tpl = "{{#if flags.isEV}}EV care{{else}}gas care{{/if}}";
    expect(renderConditionalBlocks(tpl, data({ isEV: false }))).toBe("gas care");
  });

  it("drops an if-only block (no else) when false", () => {
    const tpl = "A{{#if flags.inWarranty}} warranty applies{{/if}}B";
    expect(renderConditionalBlocks(tpl, data({ inWarranty: false }))).toBe("AB");
    expect(renderConditionalBlocks(tpl, data({ inWarranty: true }))).toBe(
      "A warranty appliesB"
    );
  });

  it("supports negation with a leading !", () => {
    const tpl = "{{#if !flags.isRepeat}}Welcome!{{else}}Welcome back!{{/if}}";
    expect(renderConditionalBlocks(tpl, data({ isRepeat: false }))).toBe("Welcome!");
    expect(renderConditionalBlocks(tpl, data({ isRepeat: true }))).toBe("Welcome back!");
  });

  it("treats a missing flag as falsy", () => {
    const tpl = "{{#if flags.unknown}}X{{else}}Y{{/if}}";
    expect(renderConditionalBlocks(tpl, data({}))).toBe("Y");
  });

  it("nests blocks correctly", () => {
    const tpl =
      "{{#if flags.isEV}}EV{{#if flags.repairOver1000}} premium{{/if}}{{else}}ICE{{/if}}";
    expect(renderConditionalBlocks(tpl, data({ isEV: true, repairOver1000: true }))).toBe(
      "EV premium"
    );
    expect(renderConditionalBlocks(tpl, data({ isEV: true, repairOver1000: false }))).toBe(
      "EV"
    );
    expect(renderConditionalBlocks(tpl, data({ isEV: false, repairOver1000: true }))).toBe(
      "ICE"
    );
  });

  it("the string \"false\" / \"0\" / \"no\" are falsy", () => {
    const tpl = "{{#if flags.tier}}has{{else}}none{{/if}}";
    expect(renderConditionalBlocks(tpl, data({ tier: "false" }))).toBe("none");
    expect(renderConditionalBlocks(tpl, data({ tier: "0" }))).toBe("none");
    expect(renderConditionalBlocks(tpl, data({ tier: "Champion" }))).toBe("has");
  });
});

describe("one template, materially different correct letters by attribute", () => {
  // A single warranty/care template that adapts by EV/ICE, warranty, repeat,
  // and repair investment — the L2 acceptance scenario.
  const TEMPLATE =
    "Dear {{customer.firstName}}, thank you for trusting {{company.name}} with your " +
    "{{customer.vehicle}}. " +
    "{{#if flags.isEV}}Our EV-certified technicians restored your high-voltage " +
    "system to spec.{{else}}Our technicians restored your vehicle to manufacturer " +
    "spec.{{/if}} " +
    "{{#if flags.inWarranty}}Your repair is covered by our written workmanship " +
    "warranty for as long as you own the vehicle.{{/if}}" +
    "{{#if flags.isRepeat}} Thank you for coming back to us.{{else}} We hope to earn " +
    "your trust for years to come.{{/if}}" +
    "{{#if flags.repairOver1000}} As a thank-you for a major repair, enjoy a " +
    "complimentary detail on your next visit.{{/if}}";

  const render = (attrs: CustomerAttributes): string =>
    renderMergeFields(TEMPLATE, {
      customer: { firstName: "Jane", lastName: "Doe", vehicle: "2023 Model 3" },
      company: { name: "Ace Body Shop" },
      program: {},
      flags: attributesToFlags(attrs),
    }).html;

  it("an EV, in-warranty, repeat, big-ticket customer gets the full EV letter", () => {
    const html = render({
      powertrain: "EV",
      inWarranty: true,
      repeatCustomer: true,
      repairTotal: 2400,
    });
    expect(html).toContain("EV-certified technicians");
    expect(html).toContain("written workmanship warranty");
    expect(html).toContain("Thank you for coming back");
    expect(html).toContain("complimentary detail");
    expect(html).not.toContain("manufacturer spec");
  });

  it("an ICE, out-of-warranty, first-time, small-ticket customer gets a different letter", () => {
    const html = render({
      powertrain: "ICE",
      inWarranty: false,
      repeatCustomer: false,
      repairTotal: 300,
    });
    expect(html).toContain("manufacturer spec");
    expect(html).toContain("hope to earn your trust");
    expect(html).not.toContain("EV-certified");
    expect(html).not.toContain("workmanship warranty");
    expect(html).not.toContain("complimentary detail");
  });

  it("the two letters are materially different from the same template", () => {
    const ev = render({ powertrain: "EV", inWarranty: true, repeatCustomer: true, repairTotal: 2400 });
    const ice = render({ powertrain: "ICE", inWarranty: false, repeatCustomer: false, repairTotal: 300 });
    expect(ev).not.toBe(ice);
  });
});
