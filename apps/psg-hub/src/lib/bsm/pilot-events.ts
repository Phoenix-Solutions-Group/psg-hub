import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BSM_PILOT_EVENT_NAMES = [
  "setup_started",
  "first_login_card_viewed",
  "connect_google_clicked",
  "audit_save_failed",
] as const;

export type BsmPilotEventName = (typeof BSM_PILOT_EVENT_NAMES)[number];

export type BsmPilotEventProperties = Record<string, string | number | boolean | null>;

export function isBsmPilotEventName(value: unknown): value is BsmPilotEventName {
  return (
    typeof value === "string" &&
    (BSM_PILOT_EVENT_NAMES as readonly string[]).includes(value)
  );
}

export function sanitizeBsmPilotEventProperties(
  properties: unknown,
): BsmPilotEventProperties {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties as Record<string, unknown>)
      .filter(([, value]) => {
        const t = typeof value;
        return value === null || t === "string" || t === "number" || t === "boolean";
      })
      .slice(0, 20),
  ) as BsmPilotEventProperties;
}

export async function recordBsmPilotEvent(
  service: SupabaseClient,
  input: {
    eventName: BsmPilotEventName;
    shopId?: string | null;
    userId?: string | null;
    properties?: BsmPilotEventProperties;
  },
): Promise<void> {
  const { error } = await service.from("bsm_pilot_events").insert({
    event_name: input.eventName,
    shop_id: input.shopId ?? null,
    user_id: input.userId ?? null,
    properties: input.properties ?? {},
  });

  if (error) {
    console.error("[bsm-pilot-events] insert failed:", error.message);
  }
}
