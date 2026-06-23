// Wave 1A / PSG-225 — Collision-repair vertical content module.
//
// The spec's `collision-repair-content-system`: 8 buyer personas + a required-page
// coverage set that feed clustering and architecture for auto-body clients. When a
// brief's vertical is `collision_repair` the engine SEEDS the architecture with this
// coverage (so a thin brief still yields a complete, ICP-correct sitemap) and CHECKS
// the finished tree against it (coverage gaps surface in validation). For the
// `general` flow this module is inert.
//
// Pure data + pure helpers — no I/O. Personas are stable ids referenced by clusters
// and PageNodes (PageNode.personaIds), so the calendar and summary can show which
// buyer each page serves.

import type { PageType, SitemapVertical } from "./types";

/* -------------------------------------------------------------------------- */
/* The 8 personas                                                             */
/* -------------------------------------------------------------------------- */

export type CollisionPersona = {
  id: string;
  name: string;
  /** One-line buyer summary (shown in the summary deliverable). */
  description: string;
  /** What this buyer is searching for — grounds clustering + page assignment. */
  searchThemes: string[];
};

/**
 * Eight auto-body buyer personas. Drawn from the collision-repair buyer journey:
 * the insurance-steered path, the anxious first-timer, the price-driven self-pay,
 * the quality/OEM seeker, the luxury/EV owner, the fleet manager, the convenience
 * local, and the reputation researcher. Each maps to required pages below.
 */
export const COLLISION_PERSONAS: readonly CollisionPersona[] = [
  {
    id: "insurance_steered",
    name: "Insurance-Steered Customer",
    description: "Filed a claim; wants a shop that works directly with their insurer.",
    searchThemes: ["insurance approved body shop", "direct repair program", "claim assistance"],
  },
  {
    id: "first_time_claimant",
    name: "Anxious First-Time Claimant",
    description: "Never been in a wreck before; needs the process explained step by step.",
    searchThemes: ["what to do after a car accident", "how does collision repair work", "rental car while repaired"],
  },
  {
    id: "price_shopper",
    name: "Price-Conscious Self-Pay",
    description: "Paying out of pocket; comparing estimates and financing options.",
    searchThemes: ["free collision estimate", "cheap bumper repair", "auto body financing"],
  },
  {
    id: "quality_seeker",
    name: "Quality & Craftsmanship Seeker",
    description: "Wants OEM parts, certified technicians, and a lifetime warranty.",
    searchThemes: ["OEM certified collision repair", "I-CAR gold class", "lifetime warranty body shop"],
  },
  {
    id: "luxury_ev_owner",
    name: "Luxury & EV Owner",
    description: "Drives a high-end or electric vehicle needing make-specific expertise.",
    searchThemes: ["Tesla certified body shop", "aluminum repair", "EV collision repair"],
  },
  {
    id: "fleet_commercial",
    name: "Fleet & Commercial Manager",
    description: "Manages multiple vehicles; cares about turnaround time and volume pricing.",
    searchThemes: ["fleet collision repair", "commercial vehicle body shop", "fast turnaround auto body"],
  },
  {
    id: "convenience_local",
    name: "Convenience-Driven Local",
    description: "Wants the nearest reputable shop with loaners, towing, and easy hours.",
    searchThemes: ["body shop near me", "collision repair {city}", "towing after accident"],
  },
  {
    id: "reputation_driven",
    name: "Reputation-Driven Researcher",
    description: "Reads reviews and before/after work before trusting a shop.",
    searchThemes: ["best body shop reviews", "collision repair before and after", "{city} auto body reviews"],
  },
] as const;

export function personaById(id: string): CollisionPersona | undefined {
  return COLLISION_PERSONAS.find((p) => p.id === id);
}

/* -------------------------------------------------------------------------- */
/* Required-page coverage                                                     */
/* -------------------------------------------------------------------------- */

export type RequiredPage = {
  /** Stable key (also the default slug). */
  key: string;
  title: string;
  pageType: PageType;
  /** Where it lives in the hierarchy: a top-level page or under /services. */
  group: "top" | "services" | "resources";
  /** Personas this page primarily serves. */
  personaIds: string[];
  /** Seed keywords (used when the brief/keyword universe is thin). */
  seedKeywords: string[];
};

/**
 * The pages an auto-body site MUST have to cover the 8 personas + core services.
 * `service_area` (per-city) pages are generated separately from brief.locations;
 * this is the fixed spine. `group` places each under the right parent so the
 * 3-click rule holds.
 */
export const COLLISION_REQUIRED_PAGES: readonly RequiredPage[] = [
  // Core services
  { key: "collision-repair", title: "Collision Repair", pageType: "service", group: "services", personaIds: ["insurance_steered", "quality_seeker"], seedKeywords: ["collision repair", "auto body repair", "car accident repair"] },
  { key: "auto-body-painting", title: "Auto Body Painting & Refinishing", pageType: "service", group: "services", personaIds: ["quality_seeker"], seedKeywords: ["auto body painting", "car paint repair", "color matching"] },
  { key: "frame-straightening", title: "Frame & Unibody Straightening", pageType: "service", group: "services", personaIds: ["quality_seeker", "insurance_steered"], seedKeywords: ["frame straightening", "unibody repair", "frame alignment"] },
  { key: "paintless-dent-repair", title: "Paintless Dent Repair (PDR)", pageType: "service", group: "services", personaIds: ["price_shopper", "convenience_local"], seedKeywords: ["paintless dent repair", "PDR", "dent removal"] },
  { key: "bumper-repair", title: "Bumper Repair & Replacement", pageType: "service", group: "services", personaIds: ["price_shopper"], seedKeywords: ["bumper repair", "bumper replacement"] },
  { key: "auto-glass", title: "Auto Glass & Windshield Replacement", pageType: "service", group: "services", personaIds: ["convenience_local"], seedKeywords: ["windshield replacement", "auto glass repair"] },
  { key: "ev-luxury-repair", title: "EV & Luxury Vehicle Repair", pageType: "service", group: "services", personaIds: ["luxury_ev_owner", "quality_seeker"], seedKeywords: ["EV collision repair", "Tesla certified repair", "aluminum repair"] },
  { key: "fleet-services", title: "Fleet & Commercial Services", pageType: "service", group: "services", personaIds: ["fleet_commercial"], seedKeywords: ["fleet collision repair", "commercial vehicle repair"] },
  // Conversion / resource
  { key: "free-estimate", title: "Free Estimate", pageType: "landing", group: "top", personaIds: ["price_shopper", "first_time_claimant"], seedKeywords: ["free collision estimate", "free auto body estimate"] },
  { key: "insurance-claims", title: "Insurance Claims Assistance", pageType: "resource", group: "resources", personaIds: ["insurance_steered", "first_time_claimant"], seedKeywords: ["insurance claim help", "direct repair program", "insurance approved body shop"] },
  { key: "what-to-expect", title: "What to Expect After an Accident", pageType: "resource", group: "resources", personaIds: ["first_time_claimant"], seedKeywords: ["what to do after a car accident", "collision repair process"] },
  { key: "financing", title: "Repair Financing Options", pageType: "resource", group: "resources", personaIds: ["price_shopper"], seedKeywords: ["auto body financing", "collision repair payment plans"] },
  { key: "certifications", title: "Certifications & Warranty", pageType: "resource", group: "resources", personaIds: ["quality_seeker", "luxury_ev_owner"], seedKeywords: ["I-CAR certified", "OEM certified body shop", "lifetime warranty"] },
  // Trust / structural
  { key: "gallery", title: "Before & After Gallery", pageType: "gallery", group: "top", personaIds: ["reputation_driven", "quality_seeker"], seedKeywords: ["collision repair before and after", "auto body work gallery"] },
  { key: "reviews", title: "Reviews & Testimonials", pageType: "reviews", group: "top", personaIds: ["reputation_driven"], seedKeywords: ["body shop reviews", "collision repair testimonials"] },
  { key: "about", title: "About Us", pageType: "about", group: "top", personaIds: [], seedKeywords: ["about", "our shop"] },
  { key: "contact", title: "Contact & Directions", pageType: "contact", group: "top", personaIds: ["convenience_local"], seedKeywords: ["contact body shop", "body shop directions"] },
  { key: "blog", title: "Blog", pageType: "blog_index", group: "top", personaIds: [], seedKeywords: ["auto body blog", "car care tips"] },
] as const;

/** True for the collision-repair vertical only. */
export function isCollisionVertical(vertical: SitemapVertical): boolean {
  return vertical === "collision_repair";
}
