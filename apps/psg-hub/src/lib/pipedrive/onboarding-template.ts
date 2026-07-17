// PSG-584 / PSG-576 Move 1 — WHM new-client onboarding template (typed data).
//
// Source of truth: Noelle's CONFIRMED template on PSG-580
// (`/PSG/issues/PSG-580#document-onboarding-template`). This file is a faithful,
// machine-readable transcription — the delivery-board builder (`projects.ts`) reads
// it to create one Pipedrive project + phases + tasks per won deal, with NO browser
// UI in the loop (the whole point of PSG-584).
//
// Scheduling convention (from the confirmed doc):
//   • Day 0 = deal-won date (project start).
//   • Every `dayOffset` below is CALENDAR DAYS from Day 0; a task's due date is
//     start + offset.
//   • `owner` is the single accountable ROLE (AS/Ads/Analytics/Web/CRO). Role→user
//     assignment in Pipedrive is a separate, PSG-confirmed mapping (see projects.ts);
//     tasks are created unassigned (role stays in the title) until that map exists.
//
// D6/D7 is intentionally OUT of scope here: the ongoing monthly recurring loop is a
// SEPARATE recurring board (Noelle's decision on PSG-580), tracked as its own
// follow-on. Onboarding must be able to reach "Done" at D5 sign-off (Day 55).

/**
 * Single accountable role for a task (per Noelle's one-owner rule).
 *
 * The first five roles are the original WHM onboarding roles (PSG-584/PSG-587). `UX`
 * and `QA` are added by PSG-668 because the net-new one-time templates authored under
 * PSG-611 (the Web family — New Website Build, Redesign, Landing Page — and others)
 * assign design and quality-assurance owners. Every role listed here MUST have a
 * matching entry in `ROLE_LABELS` (below) and `ROLE_USER_ENV` (role-user-map.ts), so
 * that adding a role here fails the build until its label + env mapping are supplied.
 */
export type OnboardingRole =
  | "AS"
  | "Ads"
  | "Analytics"
  | "Web"
  | "CRO"
  | "UX"
  | "QA";

/** Human-readable role names, for surfacing in task descriptions / titles. */
export const ROLE_LABELS: Record<OnboardingRole, string> = {
  AS: "Account Strategist",
  Ads: "Ads Engineer",
  Analytics: "Analytics Engineer",
  Web: "Web Engineer",
  CRO: "CRO Analyst",
  UX: "UX Designer",
  QA: "QA Analyst",
};

export interface OnboardingTask {
  /** Task title exactly as it should read on the board. */
  readonly title: string;
  /** Single accountable role. */
  readonly owner: OnboardingRole;
  /** Calendar days from Day 0 (deal-won date). Due date = start + dayOffset. */
  readonly dayOffset: number;
  /** True for the three hard gate tasks (real onboarding stall points). */
  readonly gate?: boolean;
}

export interface OnboardingPhase {
  /**
   * Stable phase key. The WHM onboarding template uses `D1..D5`; the net-new one-time
   * templates that reuse this shape (PSG-668 — e.g. New Website Build's `P1..P4`) carry
   * their own phase keys, so this is a free-form string rather than the onboarding-only
   * `D1..D5` union. Only ever surfaced in the phase parent-task description.
   */
  readonly key: string;
  /** Phase display name. */
  readonly name: string;
  readonly tasks: readonly OnboardingTask[];
}

/**
 * The CONFIRMED WHM onboarding template: 5 D-phases, one accountable owner per task,
 * explicit day-offsets, 3 gate tasks. Do not reorder or renumber without updating
 * PSG-580's confirmed doc first.
 */
export const WHM_ONBOARDING_TEMPLATE: readonly OnboardingPhase[] = [
  {
    key: "D1",
    name: "D1 — Onboard & Access",
    tasks: [
      { title: "Send welcome email + schedule kickoff call", owner: "AS", dayOffset: 1 },
      { title: "Send client intake questionnaire (structured intake form)", owner: "AS", dayOffset: 1 },
      { title: "Confirm billing, budget & contract terms logged in CRM", owner: "AS", dayOffset: 2 },
      { title: "Review Missing Access List with Delivery and assign follow-ups", owner: "AS", dayOffset: 2 },
      { title: "Review Asset Request List with Delivery and assign follow-ups", owner: "AS", dayOffset: 2 },
      { title: "Set up client folder/workspace + shared calendar", owner: "AS", dayOffset: 2 },
      { title: "Internal kickoff: assign core pod (AS + Analytics + Ads)", owner: "AS", dayOffset: 2 },
      {
        title:
          "Request access bundle: Google Ads (MCC invite), GA4, Google Business Profile, Meta/Facebook Ads, website/CMS, call tracking",
        owner: "AS",
        dayOffset: 3,
      },
      {
        title: "GATE: all access verified working (each platform test-loaded)",
        owner: "Analytics",
        dayOffset: 5,
        gate: true,
      },
    ],
  },
  {
    key: "D2",
    name: "D2 — Audit & Voice-of-Customer",
    tasks: [
      { title: "D2a Ads account audit → baseline Health Score", owner: "Ads", dayOffset: 12 },
      { title: "D2b SEMrush market + competitor scan", owner: "Analytics", dayOffset: 12 },
      { title: "D2c GA4 + conversion-tracking audit", owner: "Analytics", dayOffset: 12 },
      { title: "D2d Landing-page / CRO baseline review", owner: "CRO", dayOffset: 14 },
      {
        title: "D2e Review verbatims (Google/Yelp/Facebook) → persona / Voice-of-Customer",
        owner: "AS",
        dayOffset: 15,
      },
      {
        title: "Audit readout synthesized (all D2 findings into one brief for strategy)",
        owner: "AS",
        dayOffset: 17,
      },
    ],
  },
  {
    key: "D3",
    name: "D3 — Strategy (SOSTAC)",
    tasks: [
      { title: "Campaign architecture + KPI targets + budget guidelines", owner: "AS", dayOffset: 21 },
      { title: "Strategy deck prepared", owner: "AS", dayOffset: 22 },
      {
        title: "GATE: client approval on strategy (blocks all D4 build)",
        owner: "AS",
        dayOffset: 24,
        gate: true,
      },
    ],
  },
  {
    key: "D4",
    name: "D4 — Foundation Build",
    tasks: [
      { title: "D4a Analytics build (tracking + Looker Studio dashboard)", owner: "Analytics", dayOffset: 32 },
      { title: "D4b Landing-page build", owner: "Web", dayOffset: 35 },
      { title: "D4c CRO instrumentation (Clarity + experiment scaffolding)", owner: "CRO", dayOffset: 35 },
      { title: "D4d Campaign build in ad platform", owner: "Ads", dayOffset: 35 },
      {
        title: "Each stream owner signs their line on the pre-launch checklist",
        owner: "AS",
        dayOffset: 38,
      },
    ],
  },
  {
    key: "D5",
    name: "D5 — Launch & Stabilize",
    tasks: [
      {
        title:
          "GATE: pre-launch checklist sign-off (all streams green, conversions firing in test)",
        owner: "AS",
        dayOffset: 39,
        gate: true,
      },
      { title: "Enable campaigns / go live", owner: "Ads", dayOffset: 40 },
      {
        title: "14-day stabilization watch (monitor spend, conversions, anomalies)",
        owner: "Ads",
        dayOffset: 54,
      },
      { title: "Client sign-off → transition to ongoing recurring service", owner: "AS", dayOffset: 55 },
    ],
  },
] as const;

/** Total task count across all phases (excludes the phase parent rows). */
export function templateTaskCount(
  template: readonly OnboardingPhase[] = WHM_ONBOARDING_TEMPLATE,
): number {
  return template.reduce((n, p) => n + p.tasks.length, 0);
}

/**
 * Due date (YYYY-MM-DD) for an offset from Day 0. Pure UTC date math so it is
 * deterministic regardless of server timezone.
 * @param startISO Day-0 date as `YYYY-MM-DD` (the deal-won date).
 * @param dayOffset Calendar days to add.
 */
export function dueDateFor(startISO: string, dayOffset: number): string {
  const [y, m, d] = startISO.slice(0, 10).split("-").map(Number);
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const due = new Date(base + dayOffset * 86_400_000);
  return due.toISOString().slice(0, 10);
}
