import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const logSpy = vi.fn();
vi.mock("@/lib/logging/llm-call", () => ({
  logLLMCall: (...a: unknown[]) => logSpy(...a),
}));

import { classifyPendingSentiment } from "../review-sentiment-sync";
import { sentimentBreaker, type ClassifyFn } from "../sentiment";
import { SENTIMENT_PROMPT_VERSION } from "../sentiment-prompt";

beforeEach(() => {
  logSpy.mockReset();
  sentimentBreaker.reset();
});

type Embed = {
  prompt_version: string | null;
  classified_updated_at: string | null;
  version: number | null;
};
type ItemRow = {
  id: string;
  shop_id: string;
  text: string | null;
  rating: number | null;
  updated_at: string | null;
  review_sentiment: Embed | Embed[] | null;
};

function item(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "ri-1",
    shop_id: "shop-1",
    text: "great paint job, fast turnaround",
    rating: 5,
    updated_at: "2026-06-10T00:00:00Z",
    review_sentiment: null,
    ...over,
  };
}

function makeService(opts: {
  items?: ItemRow[];
  itemsError?: { message: string };
  upsertError?: { message: string };
}) {
  const calls = { upserts: [] as { row: Record<string, unknown>; opts: unknown }[] };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "review_items") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.not = () => b;
        b.order = () => b;
        b.limit = async () =>
          opts.itemsError
            ? { data: null, error: opts.itemsError }
            : { data: opts.items ?? [], error: null };
        return b;
      }
      if (table === "review_sentiment") {
        return {
          upsert: async (row: Record<string, unknown>, o: unknown) => {
            calls.upserts.push({ row, opts: o });
            return { error: opts.upsertError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const okOutput = {
  polarity: "positive" as const,
  confidence: 0.9,
  themes: ["quality", "time"] as const,
  actionable_complaint: false,
};
function genOk(): ClassifyFn {
  return vi.fn(async () => ({
    output: { ...okOutput, themes: [...okOutput.themes] },
    usage: { inputTokens: 100, outputTokens: 12 },
  }));
}

describe("classifyPendingSentiment", () => {
  it("classifies an unclassified row, upserts with governance + the dirty-key, logs purpose", async () => {
    const { client, calls } = makeService({ items: [item()] });
    const res = await classifyPendingSentiment(client, { generate: genOk() });

    expect(res).toEqual({ classified: 1, skipped: 0, failed: 0 });
    expect(calls.upserts).toHaveLength(1);
    const { row, opts } = calls.upserts[0];
    expect(opts).toEqual({ onConflict: "review_item_id" });
    expect(row).toMatchObject({
      review_item_id: "ri-1",
      shop_id: "shop-1",
      polarity: "positive",
      prompt_version: SENTIMENT_PROMPT_VERSION,
      version: 1,
      classified_updated_at: "2026-06-10T00:00:00Z",
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "review_sentiment_classify",
        shopId: "shop-1",
        reviewId: "ri-1",
        result: "success",
      })
    );
  });

  it("skips a row already classified at the current prompt_version with no edit (re-run nets zero)", async () => {
    const current = item({
      review_sentiment: {
        prompt_version: SENTIMENT_PROMPT_VERSION,
        classified_updated_at: "2026-06-10T00:00:00Z",
        version: 1,
      },
    });
    const { client, calls } = makeService({ items: [current] });
    const res = await classifyPendingSentiment(client, { generate: genOk() });
    expect(res).toEqual({ classified: 0, skipped: 1, failed: 0 });
    expect(calls.upserts).toHaveLength(0);
  });

  it("re-classifies an edited review (updated_at > classified_updated_at), bumping version", async () => {
    const edited = item({
      updated_at: "2026-06-12T00:00:00Z", // newer than classified_updated_at
      review_sentiment: {
        prompt_version: SENTIMENT_PROMPT_VERSION,
        classified_updated_at: "2026-06-10T00:00:00Z",
        version: 2,
      },
    });
    const { client, calls } = makeService({ items: [edited] });
    const res = await classifyPendingSentiment(client, { generate: genOk() });
    expect(res.classified).toBe(1);
    expect(calls.upserts[0].row).toMatchObject({
      version: 3,
      classified_updated_at: "2026-06-12T00:00:00Z",
    });
  });

  it("re-classifies on a prompt_version bump", async () => {
    const stale = item({
      review_sentiment: {
        prompt_version: "2020-01-01.v0",
        classified_updated_at: "2026-06-10T00:00:00Z",
        version: 5,
      },
    });
    const { client, calls } = makeService({ items: [stale] });
    const res = await classifyPendingSentiment(client, { generate: genOk() });
    expect(res.classified).toBe(1);
    expect(calls.upserts[0].row).toMatchObject({ version: 6 });
  });

  it("contains a single row's failure (failed++, batch continues)", async () => {
    const failing: ClassifyFn = vi.fn(async ({ prompt }) => {
      if (prompt.includes("FAILROW")) throw new Error("gateway 500");
      return { output: { ...okOutput, themes: [...okOutput.themes] }, usage: { inputTokens: 1, outputTokens: 1 } };
    });
    const { client, calls } = makeService({
      items: [item({ id: "bad", text: "FAILROW please" }), item({ id: "good", text: "lovely" })],
    });
    const res = await classifyPendingSentiment(client, { generate: failing });
    expect(res).toEqual({ classified: 1, skipped: 0, failed: 1 });
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].row).toMatchObject({ review_item_id: "good" });
    // the failed row logged result='error' via the injected logCall
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: "bad", result: "error", purpose: "review_sentiment_classify" })
    );
  });

  it("caps the batch at the limit (drains over runs)", async () => {
    const { client, calls } = makeService({
      items: [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })],
    });
    const res = await classifyPendingSentiment(client, { generate: genOk(), limit: 2 });
    expect(res.classified).toBe(2);
    expect(calls.upserts).toHaveLength(2);
  });

  it("ignores a null-text row (defensive — DB filter already excludes it)", async () => {
    const { client, calls } = makeService({ items: [item({ id: "n", text: null })] });
    const res = await classifyPendingSentiment(client, { generate: genOk() });
    expect(res).toEqual({ classified: 0, skipped: 0, failed: 0 });
    expect(calls.upserts).toHaveLength(0);
  });

  it("throws if the candidate read fails (the cron contains it)", async () => {
    const { client } = makeService({ itemsError: { message: "db down" } });
    await expect(classifyPendingSentiment(client, { generate: genOk() })).rejects.toThrow(
      "review_items read failed: db down"
    );
  });
});
