// Client-safe subset of campaign templates.
// Kept in sync with src/lib/google-ads/templates.ts — drift test at
// src/lib/ads/__tests__/campaign-templates-drift.test.ts
//
// This module MUST NOT import "server-only". Full keyword lists + ad copy
// stay on the server; only picker metadata lives here.

export type ClientCampaignTemplate = {
  id: string;
  name: string;
  description: string;
  default_daily_budget_micros: number;
  positive_keyword_count: number;
  negative_keyword_count: number;
  headline_count: number;
  description_count: number;
};

export const CLIENT_CAMPAIGN_TEMPLATES: ClientCampaignTemplate[] = [
  {
    id: "storm-damage-response",
    name: "Storm and hail damage response",
    description:
      "Post-storm surge campaign targeting drivers with hail and weather damage. Runs when severe weather hits the service area.",
    default_daily_budget_micros: 50_000_000,
    positive_keyword_count: 12,
    negative_keyword_count: 5,
    headline_count: 10,
    description_count: 4,
  },
  {
    id: "insurance-approved-shops",
    name: "Insurance claim and DRP targeting",
    description:
      "Evergreen campaign for drivers filing claims who want a shop that works directly with their insurer.",
    default_daily_budget_micros: 40_000_000,
    positive_keyword_count: 12,
    negative_keyword_count: 4,
    headline_count: 10,
    description_count: 4,
  },
  {
    id: "oem-certified-repair",
    name: "OEM-certified repair (luxury and EV)",
    description:
      "Targeted campaign for luxury, performance, and EV owners who need factory-standard repair.",
    default_daily_budget_micros: 75_000_000,
    positive_keyword_count: 12,
    negative_keyword_count: 4,
    headline_count: 10,
    description_count: 4,
  },
];

export function getClientTemplate(
  id: string
): ClientCampaignTemplate | null {
  return CLIENT_CAMPAIGN_TEMPLATES.find((t) => t.id === id) ?? null;
}
