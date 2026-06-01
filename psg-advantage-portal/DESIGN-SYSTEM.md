# PSG Advantage Portal — Design System

> **⚠️ SUPERSEDED (2026-06-01).** This local doc is no longer the brand source of truth. The PSG design system now lives as a git submodule at `apps/psg/packages/ui/psg-brand/` (`colors_and_type.css` is canonical). This doc has **drifted** from it — it shows teal success `#0EA5A5` (brand = sage `#526B51`), slate `#4A4257` (brand = `#4B5058`), and radius `0` (brand = `6px`). **Do NOT copy values from here.** Kept only as reference until psg-advantage-portal is ported into psg-hub in v0.3.

Operating manual for the design tokens, components, and patterns used in this portal. Anchored to the [PSG Brand Guidelines](https://phoenixsolutionsgroup.net/psg-brand-guidelines/).

> **Philosophy**: Understated luxury. Precision craft. Measured confidence. Refinement as discipline, not decoration.

## Token sources

There are exactly **two** files that define design tokens. They MUST stay in sync.

1. **`src/app/globals.css`** — `@theme` block. Powers all Tailwind utilities (`bg-navy`, `text-success`, etc.).
2. **`src/lib/psgTokens.ts`** — JS mirror. Use for Recharts props, MapLibre paint, raw SVG, inline styles.

If you change a value in one, change it in the other. There is no other place to define a color.

## Color

### Brand primary

| Token | Hex | Use |
|-------|-----|-----|
| `navy` | #1E3A52 | Headers, primary CTAs, body emphasis |
| `navy-deep` | #142838 | Navy hover/active |
| `phoenix-red` | #B8483E | Single focal accent per view. Limit: 1 eyebrow, 1 active state, 1 alert. |
| `phoenix-red-deep` | #8C362D | Phoenix red text on light tint |
| `slate` | #4A4257 | Secondary text, muted headings |

### Neutrals

| Token | Hex | Use |
|-------|-----|-----|
| `paper` | #FAFAFA | Page background |
| `bone` | #F0F0F0 | Card surface tint, input bg |
| `stone` | #E0E0E0 | Borders, dividers, chart grid |
| `fog` | #C4C4C4 | Inactive, placeholder |
| `mist` | #949494 | Tertiary text, captions |
| `graphite` | #2A2A2A | Body text default |
| `iron` | #161616 | Strongest text |

### Semantic state

Always use semantic tokens for state. Never use a brand primary for status.

| Token | Hex | Use |
|-------|-----|-----|
| `success` | #0EA5A5 | Positive trend, KPI delta+, ground-truth indicator |
| `success-bg` | #E6F7F7 | Success tint surface |
| `success-deep` | #0A7F7F | Success text on tint |
| `grove` | #4A6B4D | "Improving" trend badge |
| `grove-bg` | #EEF3EE | Grove tint surface |
| `warning` | #C28E3A | Warning, model estimate, review needed |
| `warning-bg` | #FBF3E4 | Warning tint surface |
| `warning-deep` | #8E6620 | Warning text on tint |
| `danger` | #B8483E | Error, urgent, declining |
| `danger-bg` | #FAEEEC | Error tint surface |
| `danger-deep` | #8C362D | Error text on tint |
| `info` | #FF8700 | High-visibility alert |

### Phoenix-red rule

The brand says: "single focal moment per view." Phoenix-red MUST be reserved for:
1. The active navigation indicator
2. Alert/negative states (use `danger` token instead where possible)
3. ONE page-level eyebrow

Do NOT use phoenix-red for hover states, focus rings on neutral elements, or generic link hovers. Use `navy` for those.

## Typography

Two families. Gotham leads. Didact Gothic reads.

| Family | Weights | Use |
|--------|---------|-----|
| Gotham | 300 Light, 400 Book, 500 Medium | Headings, eyebrows, buttons, navigation, labels, numerals |
| Didact Gothic | 400 Regular | Body copy, long-form reading |

### Type scale

Fixed rem ladder. No fluid clamp (this is a product UI, not a marketing site).

| Token | Size | Use |
|-------|------|-----|
| `text-eyebrow` | 11px | UPPERCASE eyebrows above headings |
| `text-caption` | 12px | Captions, helper text, footnotes |
| `text-label` | 13px | Form labels, table headers |
| `text-body` | 14px | Body text, table cells, button text |
| `text-base` | 16px | Default reading size |
| `text-h3` | 18px | Panel/section heading |
| `text-h2` | 24px | Page subhead |
| `text-h1` | 30px | Page heading |
| `text-display-*` | 36-60px | Login titles only |

### Composition patterns

```tsx
// Eyebrow
<p className="font-heading text-xs font-medium uppercase text-phoenix-red">
  Network performance
</p>

// Page heading
<h2 className="mt-3 font-heading text-3xl font-light text-navy">
  Network Dashboard
</h2>

// Section heading (inside a Panel)
<h3 className="font-heading text-base font-medium text-navy">
  EMI Trend
</h3>

// Metric value
<p className="font-heading text-3xl font-light text-navy tabular-nums">
  91.4%
</p>

// Form label
<label className="font-heading text-xs font-medium uppercase text-slate">
  Email address
</label>

// Body text
<p className="text-sm text-slate">Welcome, {name}.</p>
```

Always use `tabular-nums` on numeric values that change (KPI deltas, table cells, counters).

## Spacing

4pt scale via CSS custom properties. Tailwind defaults map cleanly.

| Token | Value | Tailwind class |
|-------|-------|----------------|
| `space-xs` | 4px | `gap-1`, `p-1` |
| `space-sm` | 8px | `gap-2`, `p-2` |
| `space-md` | 12px | `gap-3`, `p-3` |
| `space-lg` | 16px | `gap-4`, `p-4` |
| `space-xl` | 24px | `gap-6`, `p-6` |
| `space-2xl` | 32px | `gap-8`, `p-8` |
| `space-3xl` | 48px | `gap-12`, `p-12` |

**Default container padding**: `p-5` (20px) for panels and metric cards. `p-4` for table cells.
**Default grid gap**: `gap-4` for KPI rows, `gap-6` for major sections.

## Shape

**Sharp corners are the brand's most visible differentiator.** All containers, panels, cards, inputs, buttons, and badges use sharp corners (`border-radius: 0`).

Two documented exceptions:
- **Map pins and status dots**: `rounded-full` (circle)
- **Progress bar fills**: `rounded` (2px) — for thin h-2 bars only

If you find yourself reaching for `rounded-lg`, you are violating the brand. Stop.

## Components

Import from `@/components/ui`:

```tsx
import { Metric, Panel, Badge, Button, Input, EmptyState } from '@/components/ui'
```

### Metric

The canonical KPI display. Replaces 6 previous ad-hoc Metric implementations.

```tsx
<Metric label="Total Surveys" value={12846} delta={8.2} size="lg" />
<Metric label="Avg EMI" value="91.4%" delta={1.1} tone="success" />
<Metric label="Alerts" value={5} tone="accent" detail="Below 88% threshold" />
```

Sizes: `sm` (text-xl), `md` (text-2xl), `lg` (text-3xl).
Tones: `default`, `accent`, `success`, `warning`, `danger`.

### Panel

The canonical container for grouped content. Replaces ad-hoc `<section className="border border-stone bg-white">`.

```tsx
<Panel kicker="Network performance" title="EMI Trend">
  <EmiTrendChart data={trend} />
</Panel>
```

### Badge

Status pill. Sharp corners. Three variants: `solid`, `soft` (default), `outline`. Seven tones.

```tsx
<Badge tone="grove">↑ Improving</Badge>
<Badge tone="danger" variant="solid">Urgent</Badge>
```

### Button

Sharp-cornered button with brand focus ring. Variants: `primary`, `secondary` (default), `ghost`, `danger`.

```tsx
<Button variant="primary" size="lg">Continue to dashboard</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

### Input

Form input with built-in label, hint, and error states.

```tsx
<Input
  label="Email address"
  type="email"
  placeholder="you@company.com"
  hint="We'll never share your email"
/>

<Input label="Password" type="password" error="Incorrect password" />
```

### EmptyState

Always use this for zero-data scenarios. Never just print "No results."

```tsx
<EmptyState
  title="No shops in this view"
  description="Adjust your date range or check that your filter matches at least one location."
  action={<Button onClick={resetFilters}>Reset filters</Button>}
/>
```

## Anti-patterns

These are the things this portal must NEVER do.

| Anti-pattern | Why it's banned |
|--------------|-----------------|
| Gradient text (background-clip + linear-gradient) | AI design tell #1 |
| Side-stripe borders on cards (border-left > 1px) | AI design tell #2 |
| Glassmorphism (decorative blur + glow) | AI design tell #3 |
| `rounded-lg` on containers/panels/inputs/buttons | Brand violation (sharp corners) |
| Generic Tailwind colors (`bg-green-500`, `text-amber-600`) | Off-brand. Use semantic tokens. |
| Hardcoded hex in component files | Bypasses token system. Use `var(--color-*)` or `PSG_TOKENS.*`. |
| Pure black (`#000`) or pure white (`#fff`) text | Always tint. Use `iron` or `paper`. |
| Inter, Roboto, Open Sans, system defaults | Brand requires Gotham + Didact Gothic. |
| Bouncy/elastic animations | Use `cubic-bezier(0.22, 0.61, 0.36, 1)` (ease-out-quart). |
| Modals when alternatives exist | Inline or slide-over preferred. |
| Phoenix-red on more than 1-2 elements per view | Defeats accent purpose. |

## Motion

All transitions: `duration-[220ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]`.
Active state on interactive elements: `active:translate-y-px` for tactile feedback.
Animate only `transform` and `opacity`. Never width, height, padding, or margin.

## Accessibility minimums

- Every interactive element has a visible focus ring (`focus-visible:ring-2 focus-visible:ring-phoenix-red`)
- Text contrast meets WCAG AA (4.5:1 for body, 3:1 for large text)
- All sortable table headers use `aria-sort`
- All toggle buttons use `aria-pressed`
- Form errors use `aria-invalid` and `aria-describedby`
- Color is never the only indicator of state (pair with icon or text)
