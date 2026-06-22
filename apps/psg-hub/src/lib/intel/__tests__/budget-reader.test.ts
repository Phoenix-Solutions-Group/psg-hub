import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthToDateSpendUsd } from "../budget-reader";

/* -------------------------------------------------------------------------- */
/* Fake Supabase client                                                       */
/* -------------------------------------------------------------------------- */

type QueryCapture = {
  table?: string;
  selectCols?: string;
  gte?: { column: string; value: string };
  ilike?: { column: string; pattern: string };
};

/**
 * Minimal chainable fake for `from(...).select(...).gte(...).ilike(...)` then awaited to
 * `{ data, error }`. Records the filter args so the test can assert the month + prefix window.
 */
function fakeClient(
  rows: unknown[],
  capture: QueryCapture,
  error: { message: string } | null = null,
): SupabaseClient {
  const builder: Record<string, unknown> = {};
  builder.select = (cols: string) => {
    capture.selectCols = cols;
    return builder;
  };
  builder.gte = (column: string, value: string) => {
    capture.gte = { column, value };
    return builder;
  };
  builder.ilike = (column: string, pattern: string) => {
    capture.ilike = { column, pattern };
    return builder;
  };
  // Thenable: awaiting the terminal chain yields { data, error }.
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: error ? null : rows, error });
  const client = {
    from(table: string) {
      capture.table = table;
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

/* -------------------------------------------------------------------------- */

describe("monthToDateSpendUsd", () => {
  // haiku: $1/MTok in, $5/MTok out. gpt-5.1: $10/MTok in, $30/MTok out.
  // 1M haiku-in ($1) + 0.5M gpt-out ($15) + a null-model row ($0) => $16.
  const fixture = [
    { model_id: "anthropic/claude-haiku-4.5", input_tokens: 1_000_000, output_tokens: 0 },
    { model_id: "openai/gpt-5.1", input_tokens: 0, output_tokens: 500_000 },
    { model_id: null, input_tokens: null, output_tokens: null },
  ];

  it("sums the costed rows via totalSpendUsd (known fixture total)", async () => {
    const cap: QueryCapture = {};
    const total = await monthToDateSpendUsd(fakeClient(fixture, cap), {
      now: new Date("2026-06-22T12:00:00Z"),
    });
    expect(total).toBeCloseTo(16, 6);
  });

  it("filters to the current calendar month (UTC) and the intel: purpose prefix", async () => {
    const cap: QueryCapture = {};
    await monthToDateSpendUsd(fakeClient(fixture, cap), {
      now: new Date("2026-06-22T12:00:00Z"),
    });
    expect(cap.table).toBe("llm_call_log");
    expect(cap.gte).toEqual({ column: "created_at", value: "2026-06-01T00:00:00.000Z" });
    expect(cap.ilike).toEqual({ column: "purpose", pattern: "intel:%" });
  });

  it("honours a custom purposePrefix", async () => {
    const cap: QueryCapture = {};
    await monthToDateSpendUsd(fakeClient([], cap), {
      now: new Date("2026-06-22T12:00:00Z"),
      purposePrefix: "intel:writer",
    });
    expect(cap.ilike).toEqual({ column: "purpose", pattern: "intel:writer%" });
  });

  it("returns 0 for an empty month", async () => {
    expect(await monthToDateSpendUsd(fakeClient([], {}))).toBe(0);
  });

  it("throws (fail-closed) when the read errors", async () => {
    await expect(
      monthToDateSpendUsd(fakeClient([], {}, { message: "boom" })),
    ).rejects.toThrow(/failed to read llm_call_log/);
  });
});
