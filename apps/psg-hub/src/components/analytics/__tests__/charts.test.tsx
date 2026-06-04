import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// Recharts 3 emits no SVG geometry in node SSR (geometry computes in effects/Redux
// that never run server-side), so we can't assert chart content here. Mock recharts
// to passthrough stubs and assert only the wrapper chrome (caption / role / aria /
// empty-state). Real chart render + axe AA live in Playwright (09-02).
vi.mock("recharts", () => {
  const P = ({ children }: { children?: ReactNode }) => <>{children ?? null}</>;
  return {
    ResponsiveContainer: P,
    LineChart: P,
    Line: P,
    BarChart: P,
    Bar: P,
    XAxis: P,
    CartesianGrid: P,
  };
});

import { LineChartCard, BarChartCard, Sparkline } from "../charts";

const DATA = [
  { month: "Jan", v: 10 },
  { month: "Feb", v: 20 },
];

describe("LineChartCard", () => {
  it("renders title, caption and an accessible chart region when data present", () => {
    const html = renderToStaticMarkup(
      <LineChartCard
        title="Organic traffic"
        caption="Up 12% this month."
        data={DATA}
        dataKey="v"
        xKey="month"
        ariaLabel="Organic traffic over time"
      />
    );
    expect(html).toContain("Organic traffic");
    expect(html).toContain("Up 12% this month.");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Organic traffic over time"');
    expect(html).not.toContain("No data yet.");
  });

  it("renders the no-data state when data is empty (no chart region)", () => {
    const html = renderToStaticMarkup(
      <LineChartCard title="Organic traffic" data={[]} dataKey="v" xKey="month" ariaLabel="x" />
    );
    expect(html).toContain("No data yet.");
    expect(html).not.toContain('role="img"');
  });
});

describe("BarChartCard", () => {
  it("renders chart region when data present", () => {
    const html = renderToStaticMarkup(
      <BarChartCard title="Keywords" data={DATA} dataKey="v" xKey="month" ariaLabel="Keyword count" />
    );
    expect(html).toContain("Keywords");
    expect(html).toContain('aria-label="Keyword count"');
  });

  it("shows no-data state when empty", () => {
    const html = renderToStaticMarkup(
      <BarChartCard title="Keywords" data={[]} dataKey="v" xKey="month" ariaLabel="x" />
    );
    expect(html).toContain("No data yet.");
  });
});

describe("Sparkline", () => {
  it("renders an accessible region with data", () => {
    const html = renderToStaticMarkup(
      <Sparkline data={DATA} dataKey="v" ariaLabel="Traffic trend" />
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Traffic trend"');
  });

  it("renders an empty status region without data", () => {
    const html = renderToStaticMarkup(<Sparkline data={[]} dataKey="v" ariaLabel="x" />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="img"');
  });
});
