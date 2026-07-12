import type { SolicitationChannel } from "@/lib/ops/solicitation/types";

export type NurturePath = "hot_inbound" | "stalled_deal" | "onboarding_retention";
export type NurtureTrigger =
  | "web_lead"
  | "inbound_call"
  | "deal_stale_14_days"
  | "deal_won";

export type NurtureExitReason =
  | "call_booked"
  | "reply_received"
  | "deal_won"
  | "deal_lost"
  | "do_not_contact"
  | "unsubscribed"
  | "completed"
  | "inactive";

export interface NurtureContact {
  firstName?: string | null;
  shopName?: string | null;
  email?: string | null;
  phone?: string | null;
  smsConsent?: boolean;
  emailConsent?: boolean;
  optedOut?: Partial<Record<SolicitationChannel, boolean>>;
  doNotContact?: boolean;
}

export interface NurtureContext {
  path: NurturePath;
  contact: NurtureContact;
  now?: Date;
}

export interface NurtureStepDefinition {
  id: string;
  dayOffset: number;
  channels: SolicitationChannel[];
  intent: string;
  humanTask?: "call" | "voicemail" | "zoom";
}

export interface NurturePathDefinition {
  path: NurturePath;
  name: string;
  triggers: NurtureTrigger[];
  goal: string;
  advance: NurtureExitReason[];
  exit: NurtureExitReason[];
  steps: NurtureStepDefinition[];
}

export type NurtureSkipReason =
  | "not_due"
  | "no_contact"
  | "no_consent"
  | "opted_out"
  | "do_not_contact";

export interface NurtureStepDecision {
  stepId: string;
  dueAt: string;
  channel: SolicitationChannel;
  action: "send" | "skip";
  reason?: NurtureSkipReason;
}
