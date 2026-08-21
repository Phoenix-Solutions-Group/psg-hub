---
name: "PSG Hub"
description: "A calm, premium-operational control desk for every customer-facing PSG service."
colors:
  midnight: "#1E3A52"
  midnight-deep: "#0A1822"
  midnight-raised: "#2A4A63"
  midnight-soft: "#F1F4F7"
  sidebar-foreground: "#DCE3EA"
  ember: "#B8483E"
  ember-deep: "#8C362D"
  ember-soft: "#FAEEEC"
  paper: "#FAFAFA"
  surface: "#FFFFFF"
  bone: "#F0F0F0"
  stone: "#E0E0E0"
  ink: "#161616"
  graphite: "#2A2A2A"
  accessible-mist: "#707070"
  success: "#526B51"
  warning: "#C28E3A"
typography:
  display:
    fontFamily: "Gotham, Helvetica Neue, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 3vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Gotham, Helvetica Neue, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Gotham, Helvetica Neue, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Didact Gothic, Gotham, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Gotham, Helvetica Neue, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.02em"
  eyebrow:
    fontFamily: "Gotham, Helvetica Neue, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.18em"
rounded:
  none: "0"
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "40px"
  8: "48px"
  9: "64px"
  12: "128px"
components:
  button-primary:
    backgroundColor: "{colors.midnight}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-accent:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-inverse:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.midnight}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  card-featured:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "32px"
  card-opportunity:
    backgroundColor: "{colors.midnight}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "24px"
  input-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  badge-ready:
    backgroundColor: "{colors.success}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
    height: "20px"
---

# Design System: PSG Hub

## Overview

**Creative North Star: “The PSG Control Desk”**

PSG Hub is the calm, authoritative place a collision repair owner or manager starts work with PSG. The landing page should feel like a premium editorial control desk: composed, precise, and clearly prioritized, with enough energy to feel intentional but never enough decoration to compete with the next action. This is an **Operate** surface. Scanability, honest status, and predictable navigation outrank spectacle.

The dashboard is both a portfolio summary and a central navigation system. It must show every customer-facing tool the user can access, explain the outcome of each tool in plain language, surface work that needs attention, and make differences between locations explicit before navigation. It is not a marketing dashboard, a vanity-metrics report, or a generic grid of equal cards.

Brand expression comes from the contrast between Midnight structure, Paper workspace surfaces, editorial Gotham headings, human Didact Gothic copy, fine hairlines, and rare Ember moments. The approved mockup establishes the visual ambition; the implemented dashboard and `src/lib/dashboard/tools.ts` establish behavioral truth. The public [PSG design-system repository](https://github.com/Phoenix-Solutions-Group/design-system) remains authoritative for brand assets and foundational tokens.

**Key Characteristics:**

- Premium editorial voice with operational clarity.
- Persistent Midnight navigation framing a light Paper workspace.
- One featured next action, supporting tool rows, and one distinct growth opportunity.
- Honest portfolio and per-location availability, never implied access.
- Restrained Ember used as a signal, not decoration.
- Precise 6px geometry, 1px borders, and subtle paper-like elevation.

## Colors

The palette is anchored by PSG Midnight, PSG Ember, and a true-neutral Paper system. Midnight carries trust and structure; Ember marks transformation, attention, and the most important action; neutrals keep dense information calm.

### Primary

- **PSG Midnight** (`#1E3A52`): Sidebar, opportunity card, primary buttons, headings, icons, and the strongest structural contrast.
- **Raised Midnight** (`#2A4A63`): Hovered navigation, dark-surface borders, and tonal separation inside Midnight regions.
- **Soft Midnight** (`#F1F4F7`): Quiet hover surfaces and cool-toned emphasis on Paper.

### Secondary

- **PSG Ember** (`#B8483E`): Priority action, active navigation marker, meaningful attention, focus, and the Phoenix mark.
- **Deep Ember** (`#8C362D`): Ember hover or pressed state.
- **Soft Ember** (`#FAEEEC`): Error and attention backgrounds that require dark Ember text.

### Neutral

- **Paper** (`#FAFAFA`): Default page background.
- **Surface** (`#FFFFFF`): Featured cards, inputs, and elevated work surfaces.
- **Bone** (`#F0F0F0`): Alternate panels, icon tiles, and quiet grouped regions.
- **Stone** (`#E0E0E0`): Hairlines, borders, dividers, and input strokes.
- **Ink** (`#161616`): Primary body text.
- **Graphite** (`#2A2A2A`): Supporting dark copy.
- **Accessible Mist** (`#707070`): Secondary copy in the Hub. This intentionally replaces the brand system's lighter Mist where WCAG AA contrast requires it.
- **Sidebar Foreground** (`#DCE3EA`): Body and navigation text on Midnight.

### Semantic

- **Success Sage** (`#526B51`): Ready or active status.
- **Warning Amber** (`#C28E3A`): Partial setup, setup-needed, or upgrade attention.
- **Danger Ember** (`#B8483E`): Failure, destructive action, and focus—not a separate competing red.

### Named Rules

**The Rare Signal Rule.** Ember should occupy less than roughly 10% of a screen and should always communicate priority, state, or focus. Do not scatter it across decorative headings, icons, borders, and buttons simultaneously.

**The Truth Beyond Color Rule.** Every status includes explicit text such as “Ready,” “Partially set up,” “Setup needed,” “Upgrade required,” or “Status unavailable.” Color reinforces meaning but never carries it alone.

## Typography

**Display Font:** Gotham, with Helvetica Neue and system UI fallback.

**Body Font:** Didact Gothic, with Gotham and system UI fallback.
**Utility Mono:** JetBrains Mono or SF Mono only when a technical identifier genuinely benefits from monospacing.

**Character:** Gotham gives the interface tailored authority; Didact Gothic keeps operational copy open and human. The premium editorial quality comes from measured scale, generous line height, and exact alignment—not thin type, oversized marketing headlines, or ornamental styling.

### Hierarchy

- **Display** (Gotham Bold 700, 30–36px, 1.1 line-height, `-0.02em`): The dashboard's single page title. Keep it to one line when possible.
- **Headline** (Gotham Bold 700, 24px, 1.2 line-height, `-0.01em`): Major regions such as “Your services.”
- **Title** (Gotham Bold or Medium 500–700, 20px, 1.25 line-height): Featured tool and opportunity-card names.
- **Body** (Didact Gothic Regular 400, 16px, 1.65 line-height): Descriptions and explanatory copy. Keep prose to approximately 65 characters per line on wide screens.
- **Small Body** (Didact Gothic Regular 400, 14px, 1.6 line-height): Status detail, helper copy, and secondary navigation context.
- **Label** (Gotham Medium 500, 14px, `0.02em`): Buttons, navigation, short state labels, and account utilities.
- **Eyebrow** (Gotham Medium 500, 12px, `0.18em`, uppercase): Rare category labels such as “CLIENT HUB.” Never use uppercase for body copy.

### Named Rules

**The One Editorial Voice Rule.** Use Gotham for hierarchy and action; use Didact Gothic for explanation. Gotham Rounded is reserved for marketing and must not appear in the Hub.

**The Weight Ceiling Rule.** Bold 700 is the maximum. Do not use Black 800 or Ultra 900 in the product interface.

## Layout

The desktop shell uses a fixed **240px Midnight sidebar**, a **64px utility header**, and a fluid main canvas. The desktop sidebar's first-touch brand area is 160px tall and holds the official reverse lockup at **200px wide**, the minimum legible width for the full lockup. Below 200px, step down to the simple reverse lockup rather than shrinking the full logo.

The dashboard canvas is capped at **1120px** (`70rem`) and follows an asymmetric **8/4 editorial split**. The wide column contains the page's next action and core services; the narrow column carries portfolio context or the Google Ads growth opportunity. Use **48px** between major columns, **48–64px** section padding, and a 4px base spacing grid.

The first viewport follows this order:

1. Page identity and personalized portfolio summary.
2. “Your services” instruction.
3. Featured Content Approvals card.
4. Reviews & Reputation and Marketing Analytics rows.
5. Google Ads opportunity card.
6. Account utilities: Plan & Billing, Shop Settings, and visible-location count.

At widths below `1280px`, the two-column tool area becomes one column. Below `1024px`, the fixed sidebar disappears and the mobile navigation plus PSG mark move into the 64px header. Mobile uses 16px horizontal padding, stacked cards and actions, 44px minimum targets, and the same content order. Do not hide a tool or its availability explanation merely to shorten the mobile page.

### Dashboard Information Contract

- Show each customer-facing tool once, with a plain outcome-oriented description.
- Current canonical tools are Content Approvals, Reviews & Reputation, Marketing Analytics, and Google Ads.
- Keep Plan & Billing and Shop Settings in a separate Account region; they support the workspace but are not customer services.
- Do not show internal-only Agents on the customer landing page.
- For multiple locations, summarize portfolio status first, then open a focused location chooser with search.
- If no shop membership exists, route to onboarding instead of rendering an empty control desk.

## Elevation & Depth

The Hub uses **tonal layering with restrained shadow**. Paper, white surfaces, Bone panels, Midnight fields, and 1px Stone hairlines create most hierarchy. Shadows are low-alpha and paper-like; they confirm surface separation rather than making cards float.

### Shadow Vocabulary

- **Hairline** (`0 0 0 1px rgba(30, 58, 82, 0.08)`): Extra separation when a border alone is insufficient.
- **Small Surface** (`0 1px 2px rgba(22, 21, 20, 0.04), 0 1px 1px rgba(22, 21, 20, 0.03)`): Featured tool and opportunity cards at rest.
- **Medium Lift** (`0 4px 12px rgba(22, 21, 20, 0.06), 0 1px 2px rgba(22, 21, 20, 0.04)`): Dialogs or temporary panels only.

### Named Rules

**The Tonal-First Rule.** Use color fields and borders before adding shadow. Never stack heavy drop shadows, glow, glassmorphism, or blur-backed cards inside the operational workspace.

## Shapes

The form language is precise and mostly square. The default radius is **6px** for cards, buttons, inputs, icon tiles, and navigation items. Use **10px** only for a true hero-scale or modal surface. Use pill geometry only for compact tags, status badges, and avatar masks.

Borders are 1px Stone on light surfaces and Raised Midnight on dark surfaces. Tool icons sit inside 44px or 48px square tiles with 6px corners. Do not use oversized bubbles, decorative blobs, or inconsistent corner radii to manufacture personality.

The PSG logo must always come from the official assets. Use `psg-logo-reverse.svg` on Midnight, preserve its proportions and clear space, and never recreate, redraw, recolor, crop, or add “HUB” to the lockup.

## Components

Components should feel **precise and restrained**. Every interactive state must remain obvious without adding visual noise.

### Brand and App Shell

- **Desktop:** Official full reverse lockup on the 240px Midnight sidebar, 200px wide with clear space.
- **Mobile:** PSG mark in the utility header; the full brand must already appear in the login or onboarding journey.
- **Navigation:** Gotham Medium 14px, 6px corners, 12px horizontal padding, and a minimum 40px row. Hover uses Raised Midnight; active state adds an Ember indicator and stronger contrast.
- **Top bar:** 64px, Paper background, 1px Stone bottom border. It carries mobile navigation, location/account context, and sign-out—never product marketing.

### Buttons

- **Shape:** 6px radius, minimum 44px target height on the dashboard.
- **Primary:** Midnight background, Paper text, 8px × 16px padding. Use for ordinary “Open,” “Choose location,” “Set up,” and request actions.
- **Accent:** Ember background, white text. Reserve for the single highest-priority actionable item, usually the featured Content Approvals task.
- **Inverse:** White background and Midnight text inside a Midnight opportunity card.
- **Hover / Press:** Darken within the same color family over 140–220ms; press moves down 1px without scaling.
- **Focus:** 2px Ember outline with 2px offset. Never remove focus visibility.
- **Disabled:** 50% opacity with native disabled behavior; retain the label so users understand what is unavailable.

### Status Badges

- **Shape:** Pill only because the badge is compact metadata.
- **Ready:** Sage with white text.
- **Partial / Setup / Upgrade:** Amber or Bone treatment plus explicit text.
- **Unavailable / Error:** Soft Ember surface with dark Ember text; destructive red is not used as decoration.
- **Counts:** Use direct nouns—“7 awaiting review,” not a contextless red number.

### Featured Tool Card

The featured card represents the most likely next useful action, not the most profitable product.

- White surface, Stone border, 6px radius, Small Surface shadow, 24px mobile / 32px desktop padding.
- 48px Midnight icon tile, tool name, one-sentence outcome, one primary action, and a bottom status summary.
- Content Approvals is featured when review work is central; the component may feature another tool only when product truth supports the priority.

### Supporting Tool Rows

- Use bordered rows rather than equal elevated cards.
- Each row includes a 44px Bone icon tile, title, outcome description, portfolio status, and one action.
- Preserve generous vertical rhythm—24px top and bottom—so the list remains scannable without becoming a dense table.

### Growth Opportunity Card

- Midnight background, Paper title, Sidebar Foreground copy, 6px radius, and Small Surface shadow.
- The eyebrow says “Growth opportunity”; the copy explains the service outcome without hard-sell language.
- Availability and upgrade requirements appear before the inverse action.
- Use one opportunity card at most. Do not turn the right rail into an ad stack.

### Location Chooser

- Opens inline as a full-width Bone panel so the user does not lose dashboard context.
- Focus moves to the location search field on open.
- Search filters visible shop names; results report “X of Y locations” in an `aria-live` region.
- Each location row shows name, textual status, status detail, attention count where relevant, and the permitted action.
- Owner-only setup and upgrade actions say “Owner action required” or “Owner or manager action required.” Unavailable data says “Try again later.”

### Portfolio Access Request

- Explain exactly what PSG receives and state that the request does not change the plan or begin checkout.
- Show pending, sent, and error states in place.
- Use “Contact PSG” or “Send request,” never an ambiguous “Upgrade now” when no checkout will occur.

### Inputs / Fields

- White or transparent surface, 1px Stone border, 6px radius, and 44px minimum height in task panels.
- Placeholder and helper text use Accessible Mist.
- Focus uses Ember border/ring; errors use Ember with text, not color alone.

### Tool Copy

- **Content Approvals:** “Review and approve PSG-created content before it goes live.”
- **Reviews & Reputation:** “Monitor customer feedback and approve prepared response drafts.”
- **Marketing Analytics:** “See search, website, business profile, and paid performance in one place.”
- **Google Ads:** “View and manage paid search campaigns built for collision repair.”

## Do's and Don'ts

### Do:

- **Do** make the first useful action visually dominant and keep every other tool clearly reachable.
- **Do** explain availability as a result of plan, setup, reporting data, location, and role.
- **Do** use the official PSG SVG assets and the full reverse lockup at 200px or wider on the desktop sidebar.
- **Do** preserve the asymmetric 8/4 composition and balanced operational density.
- **Do** use direct, editorial microcopy with specific nouns and calm states.
- **Do** maintain WCAG 2.2 AA contrast, visible focus, semantic headings, keyboard access, and 44px task targets.
- **Do** respect reduced-motion preferences; functional state changes must not depend on animation.

### Don't:

- **Don't** build a generic grid of equal SaaS cards or hide tools behind a “More” menu.
- **Don't** present decorative metrics, invented portfolio claims, or unavailable features as live.
- **Don't** use Ember everywhere; its rarity creates the hierarchy.
- **Don't** add gradients, glassmorphism, heavy shadows, floating decoration, bounce, or confetti.
- **Don't** use Gotham Rounded, emoji, exclamation points, all-caps body copy, or headings heavier than 700.
- **Don't** rely on color alone for readiness, setup, upgrade, error, or inactive states.
- **Don't** show internal Agents, implementation terms, or staff workflows to customer users.
- **Don't** stretch, redraw, recolor, crop, or append text to the PSG logo.
