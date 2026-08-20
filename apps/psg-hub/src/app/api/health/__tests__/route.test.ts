import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, HEAD } from "../route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("returns public-safe health and deployment details without caching", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "022869d3da982d7d52bf89dd0635820b7e77c123");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "psg-hub",
      buildSha: "022869d3da982d7d52bf89dd0635820b7e77c123",
      timestamp: expect.any(String),
    });
  });

  it("uses the explicit fallback when no build identifier is available", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("GIT_COMMIT_SHA", "");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ buildSha: "unknown" });
  });

  it("uses the generic commit identifier outside Vercel", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("GIT_COMMIT_SHA", "local-build-123");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ buildSha: "local-build-123" });
  });

  it("supports HEAD health probes with the same status and cache policy", async () => {
    const response = await HEAD();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
