# Research: Recharts on Next 16.2 / React 19.2 / Tailwind 4 (verified)

**Agent:** general-purpose (web + empirical install spike) · **Date:** 2026-06-04

## Install
```bash
pnpm add recharts@3.8.1 react-is@19.2.4
```
- Pin **recharts@3.8.1** (latest 3.x). Recharts 3 lists React `^19.0.0` in peerDeps → 19.2.4 satisfies. **Empirically verified clean install, zero peer warnings.**
- Add **react-is@19.2.4** explicitly (Recharts peer-deps it; pin to React 19 major).
- **No `--legacy-peer-deps`** (npm-only flag; irrelevant under pnpm + React 19 in range).
- Recharts 3 pulls in `@reduxjs/toolkit` + `react-redux@9` (client JS, heavy) — keep charts in small client islands.

## Repo state (verified)
- `--chart-1..5` brand tokens ALREADY in `globals.css` (`:root` + `.dark`), wired via `@theme inline` as `--color-chart-1..5`. Mapping: chart-1 midnight `#1E3A52` · chart-2 ember `#B8483E` · chart-3 dark-ash `#4B5058` · chart-4 sage `#526B51` · chart-5 amber `#C28E3A`. **Do NOT re-add.**
- **NO `src/components/ui/chart.tsx`** (shadcn chart NOT installed). → build thin wrappers, reference `var(--chart-N)` directly (Option B), no shadcn ChartContainer dep.

## RSC / "use client"
- Recharts is **client-only** (effects + context + internal Redux) → must live behind `"use client"`. Import the client chart island into a Server Component page; fetch data server-side, pass as props.
- **`ResponsiveContainer` 0-height trap (#1 real bug):** renders blank until it measures a non-zero parent. Always give the wrapper `min-h-[Npx]` / fixed height / `aspect-*`. Never rely on `height="100%"` in an unsized flex/grid cell.

## Node unit-test reality (DECISIVE — changes the plan)
- **Recharts 3 emits an EMPTY wrapper in node `renderToStaticMarkup`, even with fixed `width`/`height`** — no SVG, no `<path>`, no axes (geometry computes in effects/Redux that never run server-side). Verified empirically. (This is a v2→v3 change; v2 emitted geometry with fixed dims.)
- → **Chart content CANNOT be unit-tested via `renderToStaticMarkup`.** Approach:
  1. Unit-test pure logic in node (formatters, series-shaping, axis-domain math, config objects).
  2. Mock `recharts` (Proxy passthrough stub) for any card-chrome smoke test (title/caption/empty-state copy).
  3. Real chart render + axe → **Playwright E2E** (09-02), where a browser produces the SVG.
- Mock pattern:
  ```ts
  vi.mock("recharts", () => new Proxy({}, { get: () => ({ children }: any) => children ?? null }));
  ```

## Theming (Tailwind 4, zero raw hex)
- Recharts `stroke`/`fill` accept `var(...)`. Direct-token (Option B):
  ```tsx
  <Line dataKey="v" stroke="var(--chart-1)" dot={false} />
  <Bar  dataKey="v" fill="var(--chart-2)" radius={4} />
  <CartesianGrid stroke="var(--border)" vertical={false} />
  <XAxis tick={{ fill: "var(--muted-foreground)" }} stroke="var(--border)" />
  ```
- `.dark` overrides resolve automatically at paint. Sparkline = `<LineChart>` with only a `<Line>`, no axes/grid/tooltip, in a small fixed container.

## Accessibility (axe WCAG AA gate)
- `accessibilityLayer` is **default `true` in v3** (keyboard/arrow nav + focus tooltip) — but **axe does NOT test keyboard nav**. For the AA gate add what axe checks:
  1. **Accessible name** — SVG has none → add `role="img"` + `aria-label` on the chart container (else axe flags it).
  2. **Contrast 4.5:1** — ticks/legend use `--muted-foreground` (already `#707070` for AA); verify `--chart-5` amber on white.
  3. **Scan in the browser (Playwright), not node** — SSR HTML has no SVG, an SSR axe pass would falsely pass on an empty div.
- Don't rely on color alone for series (AA use-of-color): add `strokeDasharray`/labels/legend.

## Pitfalls (Next 16 / React 19)
- Hydration: server emits stable empty wrapper, client emits SVG → reconciles cleanly IF chart data is deterministic (no `Math.random()`/`new Date()` in the client island; pass data as props).
- Animation pop-in: `isAnimationActive={false}` for above-the-fold KPI charts; fixed `min-h` to avoid CLS.
- `ResponsiveContainer` ref `.current.current` removed (v3); `<Cell>` deprecated (3.7) → use `shape` prop.
- Bundle: Recharts 3 heavy (+redux) — client islands only; `next/dynamic` for below-the-fold (note: `ssr:false` not allowed in a Server Component in Next 16 → the `dynamic()` call must live in a `"use client"` wrapper).

## Phase-9 application
- **09-01 Task 3 revised:** thin `"use client"` wrappers (LineChartCard/BarChartCard/Sparkline) with `var(--chart-N)`; `role="img"`+`aria-label`; `min-h`; `isAnimationActive={false}`; explicit empty-state. Tests = pure helpers in node + recharts-mock card-chrome smoke. NO chart-content SSR assertions.
- **09-02:** real chart render + axe AA + LCP gate via Playwright (browser).
