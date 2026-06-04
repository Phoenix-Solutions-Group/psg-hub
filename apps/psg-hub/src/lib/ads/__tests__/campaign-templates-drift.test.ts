import { describe, it, expect } from "vitest";
import { CAMPAIGN_TEMPLATES } from "@/lib/google-ads/templates";
import { CLIENT_CAMPAIGN_TEMPLATES } from "@/lib/ads/campaign-templates";

describe("client template drift detection", () => {
  it("same count of templates", () => {
    expect(CLIENT_CAMPAIGN_TEMPLATES.length).toBe(CAMPAIGN_TEMPLATES.length);
  });

  it("same ids in both lists", () => {
    const serverIds = new Set(CAMPAIGN_TEMPLATES.map((t) => t.id));
    const clientIds = new Set(CLIENT_CAMPAIGN_TEMPLATES.map((t) => t.id));
    expect(clientIds).toEqual(serverIds);
  });

  it("name + description match per id", () => {
    for (const server of CAMPAIGN_TEMPLATES) {
      const client = CLIENT_CAMPAIGN_TEMPLATES.find((c) => c.id === server.id);
      expect(client).toBeDefined();
      expect(client!.name).toBe(server.name);
      expect(client!.description).toBe(server.description);
      expect(client!.default_daily_budget_micros).toBe(
        server.defaults.daily_budget_micros
      );
      expect(client!.positive_keyword_count).toBe(
        server.keywords.positive.length
      );
      expect(client!.negative_keyword_count).toBe(
        server.keywords.negative.length
      );
      expect(client!.headline_count).toBe(server.ads.headlines.length);
      expect(client!.description_count).toBe(server.ads.descriptions.length);
    }
  });
});
