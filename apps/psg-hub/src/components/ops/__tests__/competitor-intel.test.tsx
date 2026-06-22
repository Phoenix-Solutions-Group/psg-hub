import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CompetitorIntel,
  runStateFromResponse,
  type IntelShopOption,
} from "@/components/ops/competitor-intel";

const shops = (n: number): IntelShopOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Shop ${i + 1}` }));

describe("runStateFromResponse (pure)", () => {
  it("404 → no-data, using the route's error string when present", () => {
    expect(runStateFromResponse(404, { error: "No competitor scores found for this shop" })).toEqual({
      kind: "no-data",
      message: "No competitor scores found for this shop",
    });
  });

  it("404 with no body → no-data with a default message", () => {
    expect(runStateFromResponse(404, null).kind).toBe("no-data");
  });

  it("403 → error surfacing the route's message", () => {
    expect(runStateFromResponse(403, { error: "Forbidden" })).toEqual({
      kind: "error",
      message: "Forbidden",
    });
  });

  it("5xx with no body → error with a status-derived message", () => {
    const s = runStateFromResponse(500, null);
    expect(s.kind).toBe("error");
    expect(s.kind === "error" && s.message).toContain("500");
  });
});

describe("CompetitorIntel render branches", () => {
  it("no shops: shows the empty-state, no picker/run control", () => {
    const html = renderToStaticMarkup(<CompetitorIntel shops={[]} />);
    expect(html).toContain("No shops have scored competitors yet");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Run report");
  });

  it("with shops: metered notice + shop picker with all options + run button", () => {
    const list = shops(2);
    const html = renderToStaticMarkup(<CompetitorIntel shops={list} />);
    expect(html).toContain("Metered");
    expect(html).toContain('aria-label="Shop"');
    expect((html.match(/<option/g) ?? []).length).toBe(2);
    expect(html).toContain("Run report");
    // Idle: none of the result states are rendered yet.
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("No competitor data");
  });
});
