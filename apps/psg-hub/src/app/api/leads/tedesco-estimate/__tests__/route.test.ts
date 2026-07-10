import { describe, expect, it } from "vitest";

import { POST } from "../route";

describe("POST /api/leads/tedesco-estimate", () => {
  it("is permanently offline for the dropped Tedesco client", async () => {
    const res = await POST();

    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({
      error: "This Tedesco lead form is no longer available.",
    });
  });
});
