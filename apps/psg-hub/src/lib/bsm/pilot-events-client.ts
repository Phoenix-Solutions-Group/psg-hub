import type { BsmPilotEventName, BsmPilotEventProperties } from "./pilot-events";

export function trackBsmPilotEvent(
  eventName: BsmPilotEventName,
  properties: BsmPilotEventProperties = {},
) {
  return fetch("/api/bsm/pilot-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventName, properties }),
  }).catch(() => null);
}
