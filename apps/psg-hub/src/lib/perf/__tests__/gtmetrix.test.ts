import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  fetchGtmetrix,
  gtmetrixConfigured,
  type GtmetrixPoll,
} from "@/lib/perf/gtmetrix";

function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
}

const URL = "https://wallacecollisionrepair.com";
const noSleep = async () => {};

const REPORT_ATTRS = {
  fully_loaded_time: 5200,
  time_to_first_byte: 480,
  backend_duration: 360,
  page_bytes: 2_400_000,
  page_requests: 78,
  largest_contentful_paint: 3100,
  total_blocking_time: 220,
  cumulative_layout_shift: 0.04,
  gtmetrix_grade: "B",
  performance_score: 84,
  structure_score: 91,
};

describe("fetchGtmetrix", () => {
  it("POSTs then polls queued->started->completed, then reads /reports/{id} attributes", async () => {
    const states = ["started", "completed"];
    const submitTest = vi.fn(async () => ({ id: "rpt-1", state: "queued" }));
    const pollTest = vi.fn(async () => ({ state: states.shift() ?? "completed" }));
    const getReport = vi.fn(async (id: string) => {
      expect(id).toBe("rpt-1"); // report id == test id
      return REPORT_ATTRS;
    });

    const out = await fetchGtmetrix(URL, {
      submitTest,
      pollTest,
      getReport,
      breaker: freshBreaker(),
      sleep: noSleep,
      maxPolls: 5,
    });

    expect(submitTest).toHaveBeenCalledTimes(1);
    expect(pollTest).toHaveBeenCalledTimes(2); // started, then completed
    expect(getReport).toHaveBeenCalledTimes(1);
    expect(out.fully_loaded_time).toBe(5200);
    expect(out.backend_duration).toBe(360);
    expect(out.gtmetrix_grade).toBe("B");
    expect(out.page_bytes).toBe(2_400_000);
    expect(out.time_to_interactive).toBeNull(); // absent in fixture -> null
  });

  it("throws on state=error (contained by perf-sync)", async () => {
    await expect(
      fetchGtmetrix(URL, {
        submitTest: async () => ({ id: "x", state: "error" }),
        breaker: freshBreaker(),
        sleep: noSleep,
      })
    ).rejects.toThrow(/state=error/);
  });

  it("throws after the max-poll ceiling rather than hanging", async () => {
    const pollTest: GtmetrixPoll = async () => ({ state: "started" }); // never completes
    await expect(
      fetchGtmetrix(URL, {
        submitTest: async () => ({ id: "x", state: "queued" }),
        pollTest,
        breaker: freshBreaker(),
        sleep: noSleep,
        maxPolls: 3,
      })
    ).rejects.toThrow(/poll timeout/);
  });

  it("gtmetrixConfigured() reflects the env key", () => {
    const prior = process.env.GTMETRIX_API_KEY;
    try {
      delete process.env.GTMETRIX_API_KEY;
      expect(gtmetrixConfigured()).toBe(false);
      process.env.GTMETRIX_API_KEY = "x";
      expect(gtmetrixConfigured()).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.GTMETRIX_API_KEY;
      else process.env.GTMETRIX_API_KEY = prior;
    }
  });
});
