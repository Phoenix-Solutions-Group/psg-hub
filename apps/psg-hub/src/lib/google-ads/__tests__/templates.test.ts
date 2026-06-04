import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_TEMPLATES,
  getTemplate,
  validateTemplate,
  TemplateValidationError,
} from "@/lib/google-ads/templates";

describe("campaign templates", () => {
  it("ships at least 3 templates", () => {
    expect(CAMPAIGN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it("required template IDs exist", () => {
    const ids = new Set(CAMPAIGN_TEMPLATES.map((t) => t.id));
    expect(ids.has("storm-damage-response")).toBe(true);
    expect(ids.has("insurance-approved-shops")).toBe(true);
    expect(ids.has("oem-certified-repair")).toBe(true);
  });

  it("every template passes Google char-limit validation", () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(() => validateTemplate(t)).not.toThrow();
    }
  });

  it("every template has ≥10 positive keywords", () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(t.keywords.positive.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("headline ≤30 chars enforced", () => {
    const t = {
      ...CAMPAIGN_TEMPLATES[0],
      ads: {
        ...CAMPAIGN_TEMPLATES[0].ads,
        headlines: ["x".repeat(31)],
      },
    };
    expect(() => validateTemplate(t)).toThrow(TemplateValidationError);
  });

  it("description ≤90 chars enforced", () => {
    const t = {
      ...CAMPAIGN_TEMPLATES[0],
      ads: {
        ...CAMPAIGN_TEMPLATES[0].ads,
        descriptions: ["y".repeat(91)],
      },
    };
    expect(() => validateTemplate(t)).toThrow(TemplateValidationError);
  });

  it("OEM brand name in positive keywords blocked outside OEM template", () => {
    const t = {
      ...CAMPAIGN_TEMPLATES[0],
      keywords: {
        ...CAMPAIGN_TEMPLATES[0].keywords,
        positive: [
          ...CAMPAIGN_TEMPLATES[0].keywords.positive,
          { text: "tesla body shop", match_type: "PHRASE" as const },
        ],
      },
    };
    expect(() => validateTemplate(t)).toThrow(/OEM brand name/);
  });

  it("getTemplate returns null for missing id", () => {
    expect(getTemplate("does-not-exist")).toBeNull();
  });

  it("getTemplate returns the template for each id", () => {
    for (const t of CAMPAIGN_TEMPLATES) {
      expect(getTemplate(t.id)?.id).toBe(t.id);
    }
  });

  it("snapshot catalog shape — catches unintended drift", () => {
    const shape = CAMPAIGN_TEMPLATES.map((t) => ({
      id: t.id,
      headlines: t.ads.headlines.length,
      descriptions: t.ads.descriptions.length,
      positives: t.keywords.positive.length,
      negatives: t.keywords.negative.length,
    }));
    expect(shape).toMatchInlineSnapshot(`
      [
        {
          "descriptions": 4,
          "headlines": 10,
          "id": "storm-damage-response",
          "negatives": 5,
          "positives": 12,
        },
        {
          "descriptions": 4,
          "headlines": 10,
          "id": "insurance-approved-shops",
          "negatives": 4,
          "positives": 12,
        },
        {
          "descriptions": 4,
          "headlines": 10,
          "id": "oem-certified-repair",
          "negatives": 4,
          "positives": 12,
        },
      ]
    `);
  });
});
