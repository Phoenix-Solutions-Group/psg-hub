import { describe, expect, it } from "vitest";
import { checkConversionStructure } from "..";
import type { ConversionBlock } from "..";

// PSG-776 seed / PSG-773 owns full adversarial coverage. These lock the C2
// contract the assembler + route are built against.

const hero = "hero" as const;
const estimate = "estimate" as const;

function goodConversion(): ConversionBlock {
  return {
    callActions: [
      { tel: "+19143403604", label: "Call (914) 340-3604", placement: hero },
      { tel: "+19143403604", label: "Call now", placement: "cta" },
    ],
    estimateActions: [
      {
        href: "#estimate",
        label: "Get a free estimate",
        leadEndpoint: "/api/leads/tedesco",
        placement: estimate,
      },
    ],
    primaryCtaOccurrences: 3,
  };
}

describe("checkConversionStructure (C2)", () => {
  it("passes a page with an early call action, estimate action, and repeated CTA", () => {
    expect(checkConversionStructure(goodConversion())).toEqual([]);
  });

  it("flags a page with no tap-to-call action", () => {
    const c = goodConversion();
    c.callActions = [];
    const codes = checkConversionStructure(c).map((v) => v.code);
    expect(codes).toContain("missing_call_action");
  });

  it("flags a call action that is present but not in the hero", () => {
    const c = goodConversion();
    c.callActions = [{ tel: "+19143403604", label: "Call", placement: "footer" }];
    const codes = checkConversionStructure(c).map((v) => v.code);
    expect(codes).toContain("call_action_not_early");
    expect(codes).not.toContain("missing_call_action");
  });

  it("flags a missing estimate action and a dead-stub estimate (no endpoint)", () => {
    const c = goodConversion();
    c.estimateActions = [];
    expect(checkConversionStructure(c).map((v) => v.code)).toContain(
      "missing_estimate_action"
    );

    const stub = goodConversion();
    stub.estimateActions = [
      { href: "#estimate", label: "Get a free estimate", leadEndpoint: "", placement: estimate },
    ];
    expect(checkConversionStructure(stub).map((v) => v.code)).toContain(
      "missing_estimate_action"
    );
  });

  it("flags a primary CTA that appears only once", () => {
    const c = goodConversion();
    c.primaryCtaOccurrences = 1;
    expect(checkConversionStructure(c).map((v) => v.code)).toContain(
      "conversion_action_not_repeated"
    );
  });

  it("treats a whitespace-only tel as no call action", () => {
    const c = goodConversion();
    c.callActions = [{ tel: "   ", label: "Call", placement: hero }];
    expect(checkConversionStructure(c).map((v) => v.code)).toContain(
      "missing_call_action"
    );
  });
});
