// PSG-668 / PSG-611 — New Website Build one-time delivery template (typed data).
//
// Source of truth: Noelle's board-signed-off doc on PSG-650
// (`/PSG/issues/PSG-650#document-web-build-template`), CTO-validated on PSG-661. This
// file is a faithful, machine-readable transcription — the SAME shape the deal-won
// provisioner already reads for onboarding (`projects.ts` → `provisionOnboardingBoard`),
// so a won deal that sold a website build gets this board instead of the onboarding one
// (the template selector lives in `template-registry.ts`).
//
// Scheduling convention (identical to the onboarding + recurring templates):
//   • Day 0 = deal-won date (project start).
//   • Every `dayOffset` below is CALENDAR DAYS from Day 0; a task's due date is
//     start + offset (via `dueDateFor`).
//   • `owner` is the single accountable ROLE (AS / UX / Web / QA). Contributors noted
//     in the doc's parentheses are NOT modelled — one accountable owner per task, per
//     Noelle's one-owner rule. UX + QA are the roles PSG-668 added to the model.
//   • `gate: true` marks the four hard phase gates (the real client-approval / QA stall
//     points) so the board and QA-smoke code stay gate-aware.
//
// One-time project (NOT recurring): at close it hands off to the monthly Website Care
// plan (the recurring board — PSG-582/PSG-607), exactly as the doc's project
// Definition-of-Done states. This file never touches the recurrence engine.

import type { OnboardingPhase } from "./onboarding-template";

/**
 * The CONFIRMED New Website Build template: 4 phases (Discovery → Design → Build →
 * Launch), 22 tasks (6 + 5 + 6 + 5), one accountable owner per task, explicit
 * day-offsets, 4 gate tasks. Transcribed 1:1 from the task table in PSG-650's
 * `web-build-template` doc.
 *
 * NOTE ON THE COUNT: the PSG-650 doc's prose (and the PSG-668/PSG-672 spec) headline
 * "23 tasks", but the doc's actual task table sums to 22. We transcribe the table
 * verbatim — it is the authoritative task graph — rather than invent a 23rd task. The
 * "23" headline is flagged to PMO/CTO on PSG-672 for a one-line doc correction (or, if a
 * task was genuinely dropped from the table, they add it to the doc and we mirror it).
 *
 * Do not reorder, renumber, or change owners/offsets without updating that doc first
 * (it is the board-approved source).
 */
export const NEW_WEBSITE_BUILD_TEMPLATE: readonly OnboardingPhase[] = [
  {
    key: "P1",
    name: "P1 — Discovery & Planning",
    tasks: [
      { title: "Kick-off call + welcome packet sent", owner: "AS", dayOffset: 2 },
      {
        title: "Requirements & goals intake (pages, features, integrations)",
        owner: "AS",
        dayOffset: 5,
      },
      { title: "Sitemap + content inventory", owner: "UX", dayOffset: 8 },
      { title: "Content & asset collection request sent to client", owner: "AS", dayOffset: 8 },
      { title: "Technical scope + hosting/stack decision", owner: "Web", dayOffset: 10 },
      {
        title: "GATE: requirements + sitemap client-approved (blocks Design)",
        owner: "AS",
        dayOffset: 10,
        gate: true,
      },
    ],
  },
  {
    key: "P2",
    name: "P2 — Design",
    tasks: [
      { title: "Moodboard / visual direction", owner: "UX", dayOffset: 14 },
      { title: "Homepage design (hi-fi)", owner: "UX", dayOffset: 18 },
      { title: "Interior page templates (hi-fi)", owner: "UX", dayOffset: 24 },
      { title: "Design QA + responsive review", owner: "UX", dayOffset: 26 },
      {
        title: "GATE: client design sign-off (blocks Build)",
        owner: "AS",
        dayOffset: 28,
        gate: true,
      },
    ],
  },
  {
    key: "P3",
    name: "P3 — Build",
    tasks: [
      { title: "Environment + repo/CMS setup", owner: "Web", dayOffset: 31 },
      { title: "Homepage build", owner: "Web", dayOffset: 36 },
      { title: "Interior pages build", owner: "Web", dayOffset: 43 },
      { title: "Integrations (forms, analytics, booking, etc.)", owner: "Web", dayOffset: 46 },
      { title: "Content population", owner: "AS", dayOffset: 47 },
      {
        title: "GATE: internal QA pass (functional + cross-browser + accessibility)",
        owner: "QA",
        dayOffset: 49,
        gate: true,
      },
    ],
  },
  {
    key: "P4",
    name: "P4 — Launch",
    tasks: [
      { title: "Client review / staging walkthrough", owner: "AS", dayOffset: 52 },
      { title: "Revision round", owner: "Web", dayOffset: 57 },
      {
        title: "Pre-launch checklist (SEO basics, redirects, SSL, backups, analytics)",
        owner: "Web",
        dayOffset: 60,
      },
      { title: "Go-live / DNS cutover", owner: "Web", dayOffset: 61 },
      {
        title: "GATE / PROJECT DONE: post-launch QA + client training/handoff",
        owner: "QA",
        dayOffset: 63,
        gate: true,
      },
    ],
  },
] as const;
