"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  CartesianGrid,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

// Brand chart palette is defined in globals.css (--chart-1..5). Reference the
// tokens directly — never raw hex. Default = midnight (--chart-1).
const DEFAULT_COLOR = "var(--chart-1)";
const GRID = "var(--border)";
const AXIS_TEXT = "var(--muted-foreground)";
const CHART_HEIGHT = 240;

type Datum = Record<string, string | number>;

type ChartCardProps = {
  title: string;
  /** Story-led: a sentence above the chart. The number supports the sentence. */
  caption?: string;
  data: Datum[];
  /** Series value key. */
  dataKey: string;
  /** X-axis category key. */
  xKey: string;
  /** Accessible name for the chart (axe AA needs one — the SVG has none). */
  ariaLabel: string;
  color?: string;
};

function NoData() {
  return (
    <div
      className="flex min-h-[240px] w-full items-center justify-center text-sm text-muted-foreground"
      role="status"
    >
      No data yet.
    </div>
  );
}

function ChartFrame({
  title,
  caption,
  children,
  ariaLabel,
  empty,
}: {
  title: string;
  caption?: string;
  ariaLabel: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {caption ? (
          <p className="text-sm text-muted-foreground">{caption}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        {empty ? (
          <NoData />
        ) : (
          <div
            role="img"
            aria-label={ariaLabel}
            className="min-h-[240px] w-full"
          >
            {children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LineChartCard({
  title,
  caption,
  data,
  dataKey,
  xKey,
  ariaLabel,
  color = DEFAULT_COLOR,
}: ChartCardProps) {
  const empty = !data || data.length === 0;
  return (
    <ChartFrame title={title} caption={caption} ariaLabel={ariaLabel} empty={empty}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 12 }}
          />
          <Line
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function BarChartCard({
  title,
  caption,
  data,
  dataKey,
  xKey,
  ariaLabel,
  color = DEFAULT_COLOR,
}: ChartCardProps) {
  const empty = !data || data.length === 0;
  return (
    <ChartFrame title={title} caption={caption} ariaLabel={ariaLabel} empty={empty}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 12 }}
          />
          <Bar dataKey={dataKey} fill={color} radius={4} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function Sparkline({
  data,
  dataKey,
  ariaLabel,
  color = DEFAULT_COLOR,
}: {
  data: Datum[];
  dataKey: string;
  ariaLabel: string;
  color?: string;
}) {
  if (!data || data.length === 0) {
    return <div role="status" className="h-10 w-full" aria-label="No data" />;
  }
  return (
    <div role="img" aria-label={ariaLabel} className="h-10 w-full">
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={data}>
          <Line
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
