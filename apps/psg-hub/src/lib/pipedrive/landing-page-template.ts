// PSG-655 / PSG-2814 — Landing Page / Campaign Page one-time delivery template.
//
// Source of truth: Noelle's board-approved PSG-655 `landing-page-template` doc,
// CTO-signed on PSG-670. This is a compressed, single-page sibling of the New
// Website Build template: Discovery -> Design -> Build -> Launch, with hard gates
// around scope, design sign-off, internal QA, and post-launch handoff.

import type { OnboardingPhase } from "./onboarding-template";

/**
 * The confirmed Landing Page / Campaign Page task graph.
 *
 * Day 0 = deal-won date. Offsets are calendar days from Day 0, matching the
 * existing onboarding and web-build templates. The PSG-655 doc's acceptance text
 * says "14 tasks incl. 4 gates", but the approved task table contains 17 rows
 * (4 + 4 + 4 + 5). This transcribes the signed-off table, not the summary count.
 */
export const LANDING_PAGE_TEMPLATE: readonly OnboardingPhase[] = [
  {
    key: "P1",
    name: "P1 — Discovery & Planning",
    tasks: [
      {
        title:
          "Kick-off call + campaign brief intake (goal, offer, target audience, single primary CTA / conversion event, launch date)",
        owner: "AS",
        dayOffset: 1,
      },
      {
        title:
          "Content, assets & tracking requirements collected (copy, brand assets, form fields, analytics/pixel IDs, where a submitted lead must go)",
        owner: "AS",
        dayOffset: 3,
      },
      {
        title:
          "Page scope + hosting + integrations decision (form-to-CRM/email destination, analytics events, ad pixels, A/B test if any)",
        owner: "Web",
        dayOffset: 4,
      },
      {
        title: "GATE: campaign brief + single-page scope client-approved (blocks Design)",
        owner: "AS",
        dayOffset: 4,
        gate: true,
      },
    ],
  },
  {
    key: "P2",
    name: "P2 — Design",
    tasks: [
      {
        title: "Conversion-focused wireframe (hero, offer, proof/social proof, CTA placement, form)",
        owner: "UX",
        dayOffset: 6,
      },
      {
        title: "Hi-fi single-page design (desktop + mobile)",
        owner: "UX",
        dayOffset: 8,
      },
      {
        title: "Design + responsive / accessibility review",
        owner: "UX",
        dayOffset: 9,
      },
      {
        title: "GATE: client design sign-off (blocks Build)",
        owner: "AS",
        dayOffset: 9,
        gate: true,
      },
    ],
  },
  {
    key: "P3",
    name: "P3 — Build",
    tasks: [
      {
        title: "Environment + single-page build (markup, styling, responsive)",
        owner: "Web",
        dayOffset: 12,
      },
      {
        title:
          "Form + conversion-tracking integration (form to CRM/email destination, analytics events, ad conversion pixel, thank-you / redirect)",
        owner: "Web",
        dayOffset: 13,
      },
      {
        title: "Content population + SEO/meta basics (page title, meta description, social/OG share image, favicon)",
        owner: "AS",
        dayOffset: 13,
      },
      {
        title:
          "GATE: internal QA pass (functional + form delivery + tracking fires + cross-browser + accessibility)",
        owner: "QA",
        dayOffset: 14,
        gate: true,
      },
    ],
  },
  {
    key: "P4",
    name: "P4 — Launch",
    tasks: [
      {
        title: "Client review / staging walkthrough",
        owner: "AS",
        dayOffset: 15,
      },
      {
        title: "Revision round",
        owner: "Web",
        dayOffset: 16,
      },
      {
        title: "Pre-launch checklist (SSL, redirects, live form test, analytics live, backups)",
        owner: "Web",
        dayOffset: 17,
      },
      {
        title: "Go-live / publish + campaign-ready confirmation",
        owner: "Web",
        dayOffset: 18,
      },
      {
        title: "GATE / PROJECT DONE: post-launch QA + campaign hand-off",
        owner: "QA",
        dayOffset: 18,
        gate: true,
      },
    ],
  },
] as const;
