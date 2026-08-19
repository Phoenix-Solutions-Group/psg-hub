import { afterEach, describe, expect, it } from "vitest";

import { HEAD, GET } from "../route";

const BASE = "https://hub.psgweb.me/api/health";

afterEach(() => {
  delete process.env.PSG_PREVIEW_SOURCE_SHA;
});

describe("GET /api/health", () => {
  it("returns a lightweight ok response for liveness checks", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "022869d3da982d7d52bf89dd0635820b7e77c123";

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "psg-hub",
      buildSha: "022869d3da982d7d52bf89dd0635820b7e77c123",
    });
    expect(typeof body.timestamp).toBe("string");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);

    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("handles HEAD requests for liveness probes", async () => {
    const res = await HEAD();

    expect(res.status).toBe(200);
  });

  it("reports the pinned source commit for an internal preview", async () => {
    process.env.PSG_PREVIEW_SOURCE_SHA = "225b9e90";

    const res = await GET();

    await expect(res.json()).resolves.toMatchObject({ buildSha: "225b9e90" });
  });
});
