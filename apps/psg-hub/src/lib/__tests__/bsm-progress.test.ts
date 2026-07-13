import { afterEach, describe, expect, it, vi } from "vitest";
import { getBsmProgressConfig } from "@/lib/bsm-progress";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBsmProgressConfig", () => {
  it("uses the production Paperclip read token when no BSM-specific key is set", () => {
    vi.stubEnv("PAPERCLIP_API_URL", "https://paperclip.example");
    vi.stubEnv("PAPERCLIP_READ_TOKEN", "read-token");
    vi.stubEnv("PAPERCLIP_API_KEY", "run-token");
    vi.stubEnv("BSM_PROGRESS_PAPERCLIP_API_KEY", "");

    expect(getBsmProgressConfig()).toMatchObject({
      apiUrl: "https://paperclip.example",
      apiKey: "read-token",
    });
  });

  it("keeps a BSM-specific Paperclip key as the highest-priority override", () => {
    vi.stubEnv("PAPERCLIP_READ_TOKEN", "read-token");
    vi.stubEnv("BSM_PROGRESS_PAPERCLIP_API_KEY", "bsm-token");

    expect(getBsmProgressConfig().apiKey).toBe("bsm-token");
  });
});
