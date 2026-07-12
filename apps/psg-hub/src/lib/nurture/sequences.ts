import type { NurturePath, NurturePathDefinition } from "./types";

export const WAVE_1_NURTURE_PATHS = ["hot_inbound", "stalled_deal", "onboarding_retention"] as const;

export const NURTURE_PATHS: Record<NurturePath, NurturePathDefinition> = {
  hot_inbound: {
    path: "hot_inbound",
    name: "Path A - Hot Inbound",
    triggers: ["web_lead", "inbound_call"],
    goal: "Book a discovery call within 48 hours.",
    advance: ["call_booked", "reply_received", "deal_won"],
    exit: ["inactive", "do_not_contact", "unsubscribed"],
    steps: [
      {
        id: "a-005m-email-sms",
        dayOffset: 0,
        channels: ["email", "sms"],
        intent: "Confirm the request and ask for a same-day 10-minute call.",
      },
      {
        id: "a-day1-email",
        dayOffset: 1,
        channels: ["email"],
        intent: "Send short value note with the booking link if there is no reply.",
      },
      {
        id: "a-day2-sms",
        dayOffset: 2,
        channels: ["sms"],
        intent: "Offer two booking slots and keep the reply lightweight.",
      },
      {
        id: "a-day7-breakup",
        dayOffset: 7,
        channels: ["email"],
        intent: "Ask whether to close the request or follow up later.",
      },
    ],
  },
  stalled_deal: {
    path: "stalled_deal",
    name: "Path C - Stalled Deal Rescue",
    triggers: ["deal_stale_14_days"],
    goal: "Revive a quiet proposal or cleanly close it so the forecast stays honest.",
    advance: ["reply_received", "deal_won"],
    exit: ["deal_lost", "do_not_contact", "unsubscribed"],
    steps: [
      {
        id: "c-day14-email",
        dayOffset: 14,
        channels: ["email"],
        intent: "Ask where the proposal landed and whether price or timing needs adjustment.",
      },
      {
        id: "c-day17-sms",
        dayOffset: 17,
        channels: ["sms"],
        intent: "Send a quick quote-question nudge.",
      },
      {
        id: "c-day25-breakup",
        dayOffset: 25,
        channels: ["email"],
        intent: "Close-the-loop message before marking the deal lost.",
      },
    ],
  },
  onboarding_retention: {
    path: "onboarding_retention",
    name: "Path E - New-Client Onboarding to Retention",
    triggers: ["deal_won"],
    goal: "Deliver first value fast and prevent early churn in the first 90 days.",
    advance: ["completed", "deal_won"],
    exit: ["do_not_contact", "unsubscribed", "inactive"],
    steps: [
      {
        id: "e-day0-welcome",
        dayOffset: 0,
        channels: ["email"],
        intent: "Welcome the client and set expectations for kickoff and first results.",
      },
      {
        id: "e-day2-kickoff",
        dayOffset: 2,
        channels: ["email", "sms"],
        intent: "Confirm kickoff logistics and make it easy to reply with issues.",
      },
      {
        id: "e-day30-results",
        dayOffset: 30,
        channels: ["email"],
        intent: "Share the first-results recap and invite questions.",
      },
      {
        id: "e-day90-qbr",
        dayOffset: 90,
        channels: ["email"],
        intent: "Send a light quarterly review and satisfaction check.",
      },
    ],
  },
};

export function pathForTrigger(trigger: string): NurturePath | null {
  for (const definition of Object.values(NURTURE_PATHS)) {
    if (definition.triggers.includes(trigger as never)) return definition.path;
  }
  return null;
}
