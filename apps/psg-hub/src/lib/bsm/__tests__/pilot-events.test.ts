import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordBsmPilotEvent } from "@/lib/bsm/pilot-events";

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function serviceWithError(error: { code?: string; message: string }): SupabaseClient {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(async () => ({ error })),
    })),
  } as unknown as SupabaseClient;
}

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  vi.restoreAllMocks();
});

describe("recordBsmPilotEvent", () => {
  it("keeps local stale-schema walkthrough runs quiet for the pilot events table", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54351";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await recordBsmPilotEvent(serviceWithError({
      code: "PGRST205",
      message: "Could not find the table 'public.bsm_pilot_events' in the schema cache",
    }), {
      eventName: "first_login_card_viewed",
      shopId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
    });

    expect(error).not.toHaveBeenCalled();
  });

  it("still reports production telemetry insert failures", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await recordBsmPilotEvent(serviceWithError({
      code: "42P01",
      message: 'relation "public.bsm_pilot_events" does not exist',
    }), {
      eventName: "first_login_card_viewed",
      shopId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
    });

    expect(error).toHaveBeenCalledWith(
      "[bsm-pilot-events] insert failed:",
      'relation "public.bsm_pilot_events" does not exist',
    );
  });
});
