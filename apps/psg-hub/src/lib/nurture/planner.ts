import { normalizeContact } from "@/lib/ops/solicitation/contact";
import { NURTURE_PATHS } from "./sequences";
import type {
  NurtureContext,
  NurturePath,
  NurtureStepDecision,
  NurtureStepDefinition,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function dueAt(anchor: Date, dayOffset: number): string {
  return new Date(anchor.getTime() + dayOffset * DAY_MS).toISOString();
}

function decideChannel(
  context: NurtureContext,
  step: NurtureStepDefinition,
  channel: "email" | "sms"
): NurtureStepDecision {
  const contact = context.contact;
  const raw = channel === "email" ? contact.email : contact.phone;
  const normalized = normalizeContact(channel, raw);
  const base = {
    stepId: step.id,
    dueAt: dueAt(context.now ?? new Date(), step.dayOffset),
    channel,
  };

  if (contact.doNotContact === true) {
    return { ...base, action: "skip", reason: "do_not_contact" };
  }
  if (normalized === "") {
    return { ...base, action: "skip", reason: "no_contact" };
  }
  if (contact.optedOut?.[channel] === true) {
    return { ...base, action: "skip", reason: "opted_out" };
  }
  if (channel === "sms" && contact.smsConsent !== true) {
    return { ...base, action: "skip", reason: "no_consent" };
  }
  return { ...base, action: "send" };
}

export function buildNurturePlan(context: NurtureContext): NurtureStepDecision[] {
  const definition = NURTURE_PATHS[context.path];
  return definition.steps.flatMap((step) =>
    step.channels.map((channel) => decideChannel(context, step, channel))
  );
}

export function isWave1Path(path: NurturePath): boolean {
  return path === "hot_inbound" || path === "stalled_deal" || path === "onboarding_retention";
}
