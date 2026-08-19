import { describe, expect, it } from "vitest";

import {
  classifySurveyAlert,
  type SurveyAlertClass,
  type SurveyAlertClassificationInput,
} from "../classification";

describe("classifySurveyAlert", () => {
  const cases: Array<{
    id: string;
    input: SurveyAlertClassificationInput;
    expected: SurveyAlertClass;
  }> = [
    {
      id: "UT-CLS-0 duplicate",
      input: {
        duplicate: true,
        wouldRecommend: true,
        unresolvedShop: false,
        csiResolve: 1,
        referralConsumer: true,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "duplicate",
    },
    {
      id: "UT-CLS-1 perfect",
      input: {
        wouldRecommend: true,
        unresolvedShop: false,
        csiResolve: 1,
        referralConsumer: false,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "perfect",
    },
    {
      id: "UT-CLS-2 misfire",
      input: {
        wouldRecommend: true,
        unresolvedShop: false,
        csiResolve: 0.8,
        referralConsumer: false,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "misfire",
    },
    {
      id: "UT-CLS-3 hotspot",
      input: {
        wouldRecommend: false,
        unresolvedShop: false,
        csiResolve: 0.6,
        referralConsumer: false,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "hotspot",
    },
    {
      id: "UT-CLS-4 unresolved",
      input: {
        wouldRecommend: true,
        unresolvedShop: true,
        csiResolve: 0.5,
        referralConsumer: false,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "unresolved",
    },
    {
      id: "UT-CLS-5 referral",
      input: {
        wouldRecommend: true,
        unresolvedShop: false,
        csiResolve: 1,
        referralConsumer: true,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "referral",
    },
    {
      id: "UT-CLS-6 none",
      input: {
        wouldRecommend: false,
        unresolvedShop: false,
        csiResolve: 1,
        referralConsumer: false,
        referralTrackingEnabled: true,
        creditHold: false,
      },
      expected: "none",
    },
    {
      id: "UT-CLS-5b referral tracking off falls through to perfect",
      input: {
        wouldRecommend: true,
        unresolvedShop: false,
        csiResolve: 1,
        referralConsumer: true,
        referralTrackingEnabled: false,
        creditHold: false,
      },
      expected: "perfect",
    },
    {
      id: "UT-CLS-5c credit hold falls through to perfect",
      input: {
        wouldRecommend: true,
        unresolvedShop: false,
        csiResolve: 1,
        referralConsumer: true,
        referralTrackingEnabled: true,
        creditHold: true,
      },
      expected: "perfect",
    },
  ];

  it.each(cases)("$id", ({ input, expected }) => {
    expect(classifySurveyAlert(input)).toBe(expected);
  });

  it("keeps unresolved ahead of hotspot even when the score is below perfect", () => {
    expect(
      classifySurveyAlert({
        wouldRecommend: false,
        unresolvedShop: true,
        csiResolve: 0.2,
      }),
    ).toBe("unresolved");
  });

  it("does not classify a referral unless referral tracking is explicitly enabled", () => {
    expect(
      classifySurveyAlert({
        wouldRecommend: true,
        unresolvedShop: false,
        referralConsumer: true,
        csiResolve: 1,
      }),
    ).toBe("perfect");
  });

  it("labels duplicates before posting any FileMaker alert class again", () => {
    expect(
      classifySurveyAlert({
        duplicate: true,
        wouldRecommend: false,
        unresolvedShop: true,
        csiResolve: 0.1,
      }),
    ).toBe("duplicate");
  });

  it("coerces numeric strings from imports and fails closed on missing scores", () => {
    expect(classifySurveyAlert({ wouldRecommend: true, csiResolve: "0.75" })).toBe(
      "misfire",
    );
    expect(classifySurveyAlert({ wouldRecommend: true, csiResolve: "not-a-number" })).toBe(
      "none",
    );
  });
});
