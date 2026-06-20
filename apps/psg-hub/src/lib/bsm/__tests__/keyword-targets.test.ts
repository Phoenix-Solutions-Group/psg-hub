import { describe, it, expect } from "vitest";
import {
  fetchKeywordTargets,
  parseArtifact,
  parseMarkdownKeywords,
  SEO_AUDITOR_ARTIFACT_TYPES,
} from "../keyword-targets";
import type { SupabaseClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/* Fake Supabase client                                                       */
/* -------------------------------------------------------------------------- */

type TableResult = { single?: unknown; list?: unknown[] };

/**
 * Minimal chainable fake. Per table it resolves `.maybeSingle()` to `single`
 * and an awaited terminal chain (`.eq()`/`.in()`) to `{ data: list }`.
 */
function fakeClient(tables: Record<string, TableResult>): SupabaseClient {
  const fromCalls: string[] = [];
  const client = {
    fromCalls,
    from(table: string) {
      fromCalls.push(table);
      const res = tables[table] ?? {};
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.maybeSingle = async () => ({ data: res.single ?? null, error: null });
      // Thenable: awaiting a terminal list chain yields { data: list }.
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: res.list ?? [], error: null });
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

const SHOP = "11111111-1111-1111-1111-111111111111";

function clientWithArtifacts(
  artifacts: Array<{ artifact_type: string; data: unknown }>,
): SupabaseClient {
  return fakeClient({
    shops: { single: { client_id: "client-1" } },
    campaigns: { list: [{ id: "camp-1" }, { id: "camp-2" }] },
    research_artifacts: { list: artifacts },
  });
}

/* -------------------------------------------------------------------------- */
/* parseArtifact — structured jsonb                                           */
/* -------------------------------------------------------------------------- */

describe("parseArtifact (structured jsonb)", () => {
  it("normalizes a keywords[] envelope with explicit fields", () => {
    const out = parseArtifact({
      artifact_type: "semrush_base",
      data: {
        keywords: [
          {
            keyword: "collision repair lincoln ne",
            search_volume: 1200,
            competitor_presence: 4,
            gap_opportunity: false,
            priority: "HIGH",
          },
        ],
      },
    });
    expect(out).toEqual([
      {
        keyword: "collision repair lincoln ne",
        search_volume: 1200,
        competitor_presence: 4,
        gap_opportunity: false,
        priority: "HIGH",
        source: "seo-auditor",
      },
    ]);
  });

  it("forces gap_opportunity=true for a semrush_gap artifact", () => {
    const out = parseArtifact({
      artifact_type: "semrush_gap",
      data: { keyword_targets: [{ keyword: "adas calibration", search_volume: 300 }] },
    });
    expect(out[0].gap_opportunity).toBe(true);
  });

  it("accepts a bare array and camelCase / alias fields", () => {
    const out = parseArtifact({
      artifact_type: "semrush_competitor",
      data: [{ phrase: "frame straightening", searchVolume: "2,400", competitors: 6 }],
    });
    expect(out[0]).toMatchObject({
      keyword: "frame straightening",
      search_volume: 2400,
      competitor_presence: 6,
    });
  });

  it("derives priority from volume + gap when none is given", () => {
    // gap + high volume → HIGH
    expect(
      parseArtifact({
        artifact_type: "semrush_gap",
        data: [{ keyword: "hail damage repair", search_volume: 1500 }],
      })[0].priority,
    ).toBe("HIGH");
    // no gap, mid volume → MEDIUM
    expect(
      parseArtifact({
        artifact_type: "semrush_base",
        data: [{ keyword: "car dent removal", search_volume: 600 }],
      })[0].priority,
    ).toBe("MEDIUM");
    // no gap, low volume → LOW
    expect(
      parseArtifact({
        artifact_type: "semrush_base",
        data: [{ keyword: "obscure term", search_volume: 10 }],
      })[0].priority,
    ).toBe("LOW");
  });

  it("buckets a numeric 0–100 priority", () => {
    expect(
      parseArtifact({
        artifact_type: "semrush_base",
        data: [{ keyword: "k", search_volume: 1, priority: 80 }],
      })[0].priority,
    ).toBe("HIGH");
  });

  it("drops rows with no keyword", () => {
    const out = parseArtifact({
      artifact_type: "semrush_base",
      data: [{ search_volume: 100 }, { keyword: "  " }],
    });
    expect(out).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* parseMarkdownKeywords — fallback                                           */
/* -------------------------------------------------------------------------- */

describe("parseMarkdownKeywords (fallback)", () => {
  const md = [
    "# Keyword Gap Analysis",
    "",
    "| Keyword | Volume | Competitors | Gap | Priority |",
    "| --- | --- | --- | --- | --- |",
    "| collision repair lincoln ne | 1,200 | 4 | yes | HIGH |",
    "| bumper repair | 480 | 2 | no | LOW |",
  ].join("\n");

  it("parses a markdown keyword table by header name", () => {
    const out = parseMarkdownKeywords(md, false);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      keyword: "collision repair lincoln ne",
      search_volume: 1200,
      competitor_presence: 4,
      gap_opportunity: true,
      priority: "HIGH",
      source: "seo-auditor",
    });
    expect(out[1].priority).toBe("LOW");
  });

  it("returns [] when there is no keyword column", () => {
    expect(parseMarkdownKeywords("| Volume |\n| --- |\n| 10 |", false)).toEqual([]);
  });

  it("parseArtifact falls back to markdown only when no structured rows exist", () => {
    const out = parseArtifact({ artifact_type: "semrush_gap", data: { markdown: md } });
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.gap_opportunity)).toBe(true); // gap artifact
  });
});

/* -------------------------------------------------------------------------- */
/* fetchKeywordTargets — loader                                               */
/* -------------------------------------------------------------------------- */

describe("fetchKeywordTargets", () => {
  it("loads, dedupes (highest priority wins) and sorts priority/volume desc", async () => {
    const client = clientWithArtifacts([
      {
        artifact_type: "semrush_base",
        data: [
          { keyword: "bumper repair", search_volume: 480, priority: "LOW" },
          { keyword: "frame straightening", search_volume: 900, priority: "MEDIUM" },
        ],
      },
      {
        artifact_type: "semrush_gap",
        data: [
          // duplicate keyword, higher priority → should win
          { keyword: "bumper repair", search_volume: 480, priority: "HIGH" },
          { keyword: "hail damage repair", search_volume: 1500 },
        ],
      },
    ]);

    const out = await fetchKeywordTargets(client, SHOP);
    const keywords = out.map((t) => t.keyword);
    // hail damage (HIGH, vol 1500) , bumper repair (HIGH, vol 480), frame (MEDIUM)
    expect(keywords).toEqual([
      "hail damage repair",
      "bumper repair",
      "frame straightening",
    ]);
    expect(out.find((t) => t.keyword === "bumper repair")?.priority).toBe("HIGH");
  });

  it("honors the topic filter (case-insensitive substring)", async () => {
    const client = clientWithArtifacts([
      {
        artifact_type: "semrush_base",
        data: [
          { keyword: "collision repair lincoln ne", search_volume: 1200 },
          { keyword: "bumper repair", search_volume: 480 },
        ],
      },
    ]);
    const out = await fetchKeywordTargets(client, SHOP, "LINCOLN");
    expect(out.map((t) => t.keyword)).toEqual(["collision repair lincoln ne"]);
  });

  it("returns [] when the shop has no client", async () => {
    const client = fakeClient({ shops: { single: null } });
    expect(await fetchKeywordTargets(client, SHOP)).toEqual([]);
  });

  it("returns [] when the client has no campaigns", async () => {
    const client = fakeClient({
      shops: { single: { client_id: "client-1" } },
      campaigns: { list: [] },
    });
    expect(await fetchKeywordTargets(client, SHOP)).toEqual([]);
  });

  it("returns [] when there are no auditor artifacts", async () => {
    const out = await fetchKeywordTargets(clientWithArtifacts([]), SHOP);
    expect(out).toEqual([]);
  });

  it("only queries the SEMrush/auditor artifact_type family", () => {
    expect(SEO_AUDITOR_ARTIFACT_TYPES).toEqual([
      "semrush_base",
      "semrush_geo",
      "semrush_competitor",
      "semrush_gap",
    ]);
  });
});
