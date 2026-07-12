import { afterEach, describe, expect, it, vi } from "vitest";
import { readAnalyticsSection } from "../safe-read";

describe("readAnalyticsSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns loaded data without warning", async () => {
    const warnings: { section: string; message: string }[] = [];
    const res = await readAnalyticsSection(
      "Google Ads",
      async () => ["row"],
      [],
      warnings
    );

    expect(res).toEqual(["row"]);
    expect(warnings).toEqual([]);
  });

  it("logs the failed section and returns the fallback", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings: { section: string; message: string }[] = [];

    const res = await readAnalyticsSection(
      "Local Falcon",
      async () => {
        throw new Error("relation does not exist");
      },
      null,
      warnings
    );

    expect(res).toBeNull();
    expect(warnings).toEqual([
      { section: "Local Falcon", message: "relation does not exist" },
    ]);
    expect(error).toHaveBeenCalledWith(
      "[analytics-page] Local Falcon read failed: relation does not exist"
    );
  });
});
