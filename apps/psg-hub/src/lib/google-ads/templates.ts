import "server-only";

export type KeywordMatchType = "EXACT" | "PHRASE" | "BROAD";

export type TemplateKeyword = {
  text: string;
  match_type: KeywordMatchType;
};

export type CampaignTemplate = {
  id: string;
  name: string;
  description: string;
  campaign_type: "SEARCH";
  ad_group_name: string;
  keywords: {
    positive: TemplateKeyword[];
    negative: TemplateKeyword[];
  };
  ads: {
    headlines: string[]; // ≤30 chars each, ≤15 total
    descriptions: string[]; // ≤90 chars each, ≤4 total
  };
  defaults: {
    daily_budget_micros: number; // 1_000_000 micros = $1
    ad_schedule: {
      days: Array<
        "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY"
      >;
      start_hour: number;
      end_hour: number;
    };
  };
};

const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "storm-damage-response",
    name: "Storm and hail damage response",
    description:
      "Post-storm surge campaign targeting drivers with hail and weather damage. Runs when severe weather hits the service area.",
    campaign_type: "SEARCH",
    ad_group_name: "Storm damage core",
    keywords: {
      positive: [
        { text: "hail damage repair near me", match_type: "PHRASE" },
        { text: "hail dent repair", match_type: "PHRASE" },
        { text: "paintless dent repair", match_type: "PHRASE" },
        { text: "pdr near me", match_type: "EXACT" },
        { text: "storm damage body shop", match_type: "PHRASE" },
        { text: "car hail damage quote", match_type: "PHRASE" },
        { text: "hail claim body shop", match_type: "PHRASE" },
        { text: "hail damage insurance claim", match_type: "PHRASE" },
        { text: "fix hail damage on car", match_type: "PHRASE" },
        { text: "tree fell on car repair", match_type: "PHRASE" },
        { text: "fast hail damage repair", match_type: "PHRASE" },
        { text: "weather damage auto body", match_type: "PHRASE" },
      ],
      negative: [
        { text: "diy", match_type: "BROAD" },
        { text: "kit", match_type: "BROAD" },
        { text: "how to", match_type: "BROAD" },
        { text: "remove yourself", match_type: "BROAD" },
        { text: "free", match_type: "BROAD" },
      ],
    },
    ads: {
      headlines: [
        "Hail damage repair fast",
        "Free hail damage estimate",
        "PDR and body repair",
        "We handle the claim",
        "Insurance approved shop",
        "Back on the road quickly",
        "Paintless dent specialists",
        "Storm damage body shop",
        "Hail repair done right",
        "Rental help available",
      ],
      descriptions: [
        "Skilled techs, quick turnaround, and direct communication with your insurer.",
        "Free estimates. Most hail claims finished in days, not weeks.",
        "We document the damage and work your claim so you don't chase paperwork.",
        "Real people, real phones. Call the shop and talk to someone who fixes cars.",
      ],
    },
    defaults: {
      daily_budget_micros: 50_000_000, // $50/day
      ad_schedule: {
        days: [...WEEKDAYS, "SATURDAY"],
        start_hour: 7,
        end_hour: 19,
      },
    },
  },

  {
    id: "insurance-approved-shops",
    name: "Insurance claim and DRP targeting",
    description:
      "Evergreen campaign for drivers filing claims who want a shop that works directly with their insurer.",
    campaign_type: "SEARCH",
    ad_group_name: "Insurance claim core",
    keywords: {
      positive: [
        { text: "insurance approved body shop", match_type: "PHRASE" },
        { text: "direct repair body shop", match_type: "PHRASE" },
        { text: "body shop that works with insurance", match_type: "PHRASE" },
        { text: "collision repair insurance claim", match_type: "PHRASE" },
        { text: "file insurance claim body shop", match_type: "PHRASE" },
        { text: "auto body shop near me", match_type: "PHRASE" },
        { text: "car accident repair near me", match_type: "PHRASE" },
        { text: "fender bender repair", match_type: "PHRASE" },
        { text: "rear end damage repair", match_type: "PHRASE" },
        { text: "deductible body shop", match_type: "PHRASE" },
        { text: "drp body shop", match_type: "EXACT" },
        { text: "insurance claim repair shop", match_type: "PHRASE" },
      ],
      negative: [
        { text: "cheap", match_type: "BROAD" },
        { text: "diy", match_type: "BROAD" },
        { text: "part time", match_type: "BROAD" },
        { text: "junkyard", match_type: "BROAD" },
      ],
    },
    ads: {
      headlines: [
        "Insurance claim body shop",
        "We work with your insurer",
        "Collision repair specialists",
        "Deductible options available",
        "Free repair estimate",
        "Rental assistance too",
        "From claim to keys",
        "Straightforward process",
        "Same-day estimates",
        "Real people answer the phone",
      ],
      descriptions: [
        "We handle the back and forth with your insurer so the repair stays on schedule.",
        "Most major insurers accepted. Call the shop and we'll walk you through the claim.",
        "Honest timelines. Clear pricing. No surprises at pickup.",
        "Decades of collision repair experience. OEM specs where it matters.",
      ],
    },
    defaults: {
      daily_budget_micros: 40_000_000, // $40/day
      ad_schedule: {
        days: [...WEEKDAYS, "SATURDAY"],
        start_hour: 7,
        end_hour: 19,
      },
    },
  },

  {
    id: "oem-certified-repair",
    name: "OEM-certified repair (luxury and EV)",
    description:
      "Targeted campaign for luxury, performance, and EV owners who need factory-standard repair.",
    campaign_type: "SEARCH",
    ad_group_name: "OEM certified core",
    keywords: {
      positive: [
        { text: "oem certified body shop", match_type: "PHRASE" },
        { text: "factory certified collision repair", match_type: "PHRASE" },
        { text: "tesla certified body shop", match_type: "PHRASE" },
        { text: "bmw certified collision repair", match_type: "PHRASE" },
        { text: "mercedes certified body shop", match_type: "PHRASE" },
        { text: "audi certified body shop", match_type: "PHRASE" },
        { text: "luxury car body shop", match_type: "PHRASE" },
        { text: "aluminum body repair", match_type: "PHRASE" },
        { text: "ev body shop", match_type: "EXACT" },
        { text: "electric vehicle collision repair", match_type: "PHRASE" },
        { text: "factory spec collision repair", match_type: "PHRASE" },
        { text: "high-end auto body repair", match_type: "PHRASE" },
      ],
      negative: [
        { text: "cheap", match_type: "BROAD" },
        { text: "budget", match_type: "BROAD" },
        { text: "used parts", match_type: "BROAD" },
        { text: "aftermarket only", match_type: "BROAD" },
      ],
    },
    ads: {
      headlines: [
        "OEM certified collision",
        "Factory spec repair",
        "EV and hybrid certified",
        "Aluminum body experts",
        "Genuine OEM parts used",
        "Certified technicians",
        "Precision you can see",
        "Repairs matched to spec",
        "ADAS calibration onsite",
        "Built for high-end cars",
      ],
      descriptions: [
        "Trained, certified, and equipped for OEM-spec repair on luxury and EV platforms.",
        "Frame, body, and electronics restored to factory standard. Verified with scan reports.",
        "ADAS calibration and OEM parts handled in-house, not outsourced.",
        "Transparent documentation. Every step matches manufacturer procedure.",
      ],
    },
    defaults: {
      daily_budget_micros: 75_000_000, // $75/day
      ad_schedule: {
        days: [...WEEKDAYS],
        start_hour: 8,
        end_hour: 18,
      },
    },
  },
];

export class TemplateValidationError extends Error {}

// Trademark-like patterns we don't want in positive keywords outside the OEM template.
const BRAND_NAME_PATTERNS = [
  /\btesla\b/i,
  /\bbmw\b/i,
  /\bmercedes\b/i,
  /\baudi\b/i,
  /\bporsche\b/i,
  /\blexus\b/i,
];

export function validateTemplate(t: CampaignTemplate): void {
  if (t.ads.headlines.length > 15) {
    throw new TemplateValidationError(
      `${t.id}: too many headlines (${t.ads.headlines.length} > 15)`
    );
  }
  for (const h of t.ads.headlines) {
    if (h.length > 30) {
      throw new TemplateValidationError(
        `${t.id}: headline exceeds 30 chars: "${h}"`
      );
    }
  }
  if (t.ads.descriptions.length > 4) {
    throw new TemplateValidationError(
      `${t.id}: too many descriptions (${t.ads.descriptions.length} > 4)`
    );
  }
  for (const d of t.ads.descriptions) {
    if (d.length > 90) {
      throw new TemplateValidationError(
        `${t.id}: description exceeds 90 chars: "${d}"`
      );
    }
  }
  if (t.keywords.positive.length < 10) {
    throw new TemplateValidationError(
      `${t.id}: needs ≥10 positive keywords`
    );
  }
  if (t.id !== "oem-certified-repair") {
    for (const k of t.keywords.positive) {
      for (const pat of BRAND_NAME_PATTERNS) {
        if (pat.test(k.text)) {
          throw new TemplateValidationError(
            `${t.id}: positive keyword "${k.text}" contains OEM brand name; only allowed in oem-certified-repair template`
          );
        }
      }
    }
  }
}

export function getTemplate(id: string): CampaignTemplate | null {
  return CAMPAIGN_TEMPLATES.find((t) => t.id === id) ?? null;
}

// Validate all templates at module load — fail-fast on bad bundle.
for (const t of CAMPAIGN_TEMPLATES) {
  validateTemplate(t);
}
