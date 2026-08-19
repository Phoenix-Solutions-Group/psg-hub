import "server-only";
import { google, type calendar_v3 } from "googleapis";

export interface CalendarBusyInterval {
  start: string;
  end: string;
}

export interface CalendarFreeBusyInput {
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeZone: string;
}

export interface CalendarAvailabilityAdapter {
  listBusy(input: CalendarFreeBusyInput): Promise<CalendarBusyInterval[]>;
}

export type GoogleCalendarConfig =
  | {
      ok: true;
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      calendarId: string;
    }
  | { ok: false; reason: "missing_google_oauth" | "missing_google_calendar_refresh_token" };

function envValue(env: Record<string, string | undefined>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

export function loadGoogleCalendarConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleCalendarConfig {
  const refreshToken = envValue(env, [
    "GOOGLE_CALENDAR_PROPOSAL_PREP_REFRESH_TOKEN",
    "GOOGLE_CALENDAR_REFRESH_TOKEN",
  ]);
  if (!refreshToken) return { ok: false, reason: "missing_google_calendar_refresh_token" };

  const clientId = envValue(env, ["GOOGLE_CALENDAR_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"]);
  const clientSecret = envValue(env, [
    "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  ]);
  if (!clientId || !clientSecret) return { ok: false, reason: "missing_google_oauth" };

  return {
    ok: true,
    refreshToken,
    clientId,
    clientSecret,
    calendarId: envValue(env, ["GOOGLE_CALENDAR_PROPOSAL_PREP_CALENDAR_ID", "GOOGLE_CALENDAR_ID"]) || "primary",
  };
}

export function createGoogleCalendarAvailabilityAdapter(
  config: GoogleCalendarConfig = loadGoogleCalendarConfig(),
): CalendarAvailabilityAdapter {
  if (!config.ok) {
    return {
      async listBusy() {
        throw new Error(config.reason);
      },
    };
  }

  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  const calendar = google.calendar({ version: "v3", auth });

  return {
    async listBusy(input) {
      const result = await calendar.freebusy.query({
        requestBody: {
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          timeZone: input.timeZone,
          items: [{ id: input.calendarId }],
        },
      });
      return busyIntervals(result.data, input.calendarId);
    },
  };
}

function busyIntervals(
  data: calendar_v3.Schema$FreeBusyResponse,
  calendarId: string,
): CalendarBusyInterval[] {
  const busy = data.calendars?.[calendarId]?.busy ?? [];
  return busy
    .map((interval) => ({
      start: typeof interval.start === "string" ? interval.start : "",
      end: typeof interval.end === "string" ? interval.end : "",
    }))
    .filter((interval) => interval.start !== "" && interval.end !== "");
}
