import { describe, expect, it } from "vitest";

import { HEAD, GET } from "../route";

const BASE = "https://hub.psgweb.me/api/health";

describe("GET /api/health", () => {
  it("returns a lightweight ok response for liveness checks", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "psg-hub",
    });
    expect(typeof body.timestamp).toBe("string");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("handles HEAD requests for liveness probes", async () => {
    const res = await HEAD();

    expect(res.status).toBe(200);
  });
});
