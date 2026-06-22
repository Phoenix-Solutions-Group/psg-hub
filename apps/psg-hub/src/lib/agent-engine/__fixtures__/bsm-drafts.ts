// BSM Phase 0 / PSG-193 — Nine real Content Writer drafts for the 3 test clients.
//
// Parent: PSG-191 (Content Writer run harness). This module is the *content* half
// of PSG-193: three hand-assembled `VerifiedFacts` records (with per-fact public
// provenance) and the nine assets — one blog post, one service page, one meta
// description per client — plus each asset's claims manifest. Ravi (Child B) owns
// the DB persistence; this file produces the content + facts + manifests only.
//
// WHY hand-assembled facts: the "verified-facts now back the 3 clients"
// precondition is NOT materialized in prod (the `verified_facts` table is
// unapplied, every `discovery_briefs.google_places_data` is NULL, `shops.
// certifications` is NULL, and there is no Tedesco row). So we assemble the facts
// ourselves from each shop's OWN authoritative public sources (their website /
// Google profile / published certifications pages) and record provenance per
// fact. We assert ONLY what an authoritative source confirms; anything
// unconfirmed (e.g. Tedesco/Wallace tenure, verbatim review quotes) is omitted
// rather than guessed — it stays "unverified — HOLD". `drpDisclosure.allowed`
// stays false for all three: none publicly names a carrier/DRP relationship.
//
// Every asset is built to clear `gateGeneratedAsset` (PSG-143 claim-integrity
// HARD-FAIL gate / PSG-173 publish-gate Check 3): every factual claim is mapped
// in the manifest to the verified-facts field that backs it, no competitor or
// carrier is named, and no absolute-cost / insurance-claim-implication phrasing
// appears. Each asset names exactly one conversion job (call / quote / directions).
//
// Pure data + a pure `gateAllBsmDrafts()` helper — node-testable, no I/O.

import {
  verifiedFactsSchema,
  type ClaimField,
  type ClaimManifestEntry,
  type VerifiedFacts,
} from "@/lib/claim-integrity";
import {
  gateGeneratedAsset,
  isShippable,
  type GatedAsset,
  type GeneratedAsset,
} from "../content-writer-run";

/* -------------------------------------------------------------------------- */
/* Provenance — every asserted fact traces to the shop's OWN public source.   */
/*                                                                            */
/* PSG-173 Check-3 precondition (Lee, CMO — handoff contract on PSG-173):     */
/*   1. Per-fact provenance is MANDATORY for every certification, warranty    */
/*      term, DRP/carrier relationship, and "years in business" claim.        */
/*   2. The source MUST be the shop's OWN site / own verified profile. Third-  */
/*      party directories or aggregators (Yelp, Carwise, Birdeye, …) do NOT   */
/*      satisfy Check 3 — that's the implied-certification trap the brand-     */
/*      voice charter forbids shipping.                                       */
/*   3. No soft→hard upgrades: a fact that can only be third-party-sourced is  */
/*      DROPPED from the record, never softened to fit.                       */
/*                                                                            */
/* `assertProvenanceIntegrity()` enforces (1) and (2) mechanically, and       */
/* `buildAssetProvenanceManifests()` emits, per asset, every claim mapped to  */
/* the shop's-own-site source that backs it — so each draft arrives at Lee's  */
/* gate with its provenance visible instead of bouncing as an unverifiable    */
/* badge. Provenance is keyed to the verified-facts data (exact cert label /  */
/* warranty / tenure) so a record edit that drops its source fails the runner */
/* here, not at the gate.                                                      */
/* -------------------------------------------------------------------------- */

/** The shop's own authoritative domain. Every provenance URL must live here. */
export const SHOP_OWN_DOMAINS: Record<string, string> = {
  "shop-tracys": "tracysbodyshop.com",
  "shop-tedesco": "tedescoautobody.com",
  "shop-wallace": "wallacecollisionrepair.com",
};

/**
 * Per-shop provenance, keyed to the verified-facts datum it backs:
 *  - `certifications[label]` — keyed by the EXACT cert label in the record.
 *  - `warranty` — source for the warranty terms (required when a warranty is set).
 *  - `yearsInBusiness` — source for the tenure claim (required when tenure is set).
 *  - `location` — SUPPLEMENTARY (street address). Not a Check-3 claim field, but
 *    still cited to the shop's own page rather than a directory.
 * Every URL must resolve to the shop's own domain (`SHOP_OWN_DOMAINS`).
 */
export type ShopProvenance = {
  certifications: Record<string, string>;
  warranty?: string;
  yearsInBusiness?: string;
  location?: string;
};

export const BSM_FACT_PROVENANCE: Record<string, ShopProvenance> = {
  "shop-tracys": {
    certifications: {
      "I-CAR Gold Class": "https://www.tracysbodyshop.com/our-certifications/",
      "Honda Acura ProFirst Certified Collision Repair Facility": "https://www.tracysbodyshop.com/our-certifications/",
      "FCA US LLC Certified": "https://www.tracysbodyshop.com/our-certifications/",
      "Assured Performance Network Certified": "https://www.tracysbodyshop.com/our-certifications/",
    },
    warranty: "https://www.tracysbodyshop.com/our-services/",
    yearsInBusiness: "https://www.tracysbodyshop.com/about-tracys/",
  },
  "shop-tedesco": {
    certifications: {
      "I-CAR Gold Class": "https://www.tedescoautobody.com/certifications/",
      "ASE Certified": "https://www.tedescoautobody.com/certifications/",
      "FCA US LLC Certified Collision Repair Center": "https://www.tedescoautobody.com/certifications/fca/",
      "Hyundai Recognized Collision Repair Center": "https://www.tedescoautobody.com/certifications/",
      "Nissan Certified Collision Repair Network": "https://www.tedescoautobody.com/certifications/",
      "Porsche Approved Collision Center": "https://www.tedescoautobody.com/certifications/",
      "Tesla Approved": "https://www.tedescoautobody.com/certifications/",
    },
    warranty: "https://www.tedescoautobody.com/collision-services/",
    // Address (320 Main St, New Rochelle, NY 10801) stated on the shop's own
    // contact page. Repointed off Yelp per Lee's own-source mandate; the address
    // is not a Check-3 claim field (no `location` in VerifiedFacts), so it is not
    // asserted via the claims manifest — it only supports the "directions" CTA.
    location: "https://www.tedescoautobody.com/contact/",
  },
  "shop-wallace": {
    certifications: {
      "I-CAR Gold Class Certified": "https://wallacecollisionrepair.com/certifications/",
      "BMW Certified Collision Repair Center": "https://wallacecollisionrepair.com/certifications/",
      "Tesla Approved Body Shop": "https://wallacecollisionrepair.com/certifications/",
      "Subaru Certified Collision Center": "https://wallacecollisionrepair.com/certifications/",
      "Kia Certified Collision Repair Center": "https://wallacecollisionrepair.com/certifications/",
      "Ford National Body Shop Network": "https://wallacecollisionrepair.com/certifications/",
      "Rivian Certified Collision Center": "https://wallacecollisionrepair.com/certifications/",
    },
    warranty: "https://wallacecollisionrepair.com/certifications/",
  },
};

/* -------------------------------------------------------------------------- */
/* Verified-facts records — the ONLY source of assertable facts per shop.     */
/* Parsed through the schema so the fixtures are guaranteed schema-valid.      */
/* -------------------------------------------------------------------------- */

/**
 * Tracy's Collision Center — Lincoln, NE. Founded November 1969; as of June 2026
 * that is 56 full years, so `yearsInBusiness` is recorded as 56. The copy claims
 * "since 1969" and its manifest entries bind to the verified 56 (never over-claims).
 */
const tracysFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-tracys",
  certifications: [
    { kind: "i_car", label: "I-CAR Gold Class", level: "Gold Class", issuer: "I-CAR" },
    { kind: "oem", label: "Honda Acura ProFirst Certified Collision Repair Facility", issuer: "Honda" },
    { kind: "manufacturer", label: "FCA US LLC Certified", issuer: "FCA US LLC" },
    { kind: "other", label: "Assured Performance Network Certified", issuer: "Assured Performance" },
  ],
  warranty: {
    terms: "Lifetime warranty on metalwork and paint for as long as you own the vehicle",
    lifetime: true,
  },
  yearsInBusiness: 56,
  approvedReviewQuotes: [],
  drpDisclosure: { allowed: false, authorizedCarriers: [] },
  knownCompetitors: [],
});

/**
 * Tedesco Auto Body — New Rochelle, NY (320 Main St). Founding year is not
 * confirmed on an authoritative source, so `yearsInBusiness` is omitted.
 */
const tedescoFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-tedesco",
  certifications: [
    { kind: "i_car", label: "I-CAR Gold Class", level: "Gold Class", issuer: "I-CAR" },
    { kind: "other", label: "ASE Certified", issuer: "ASE" },
    { kind: "manufacturer", label: "FCA US LLC Certified Collision Repair Center", issuer: "FCA US LLC" },
    { kind: "oem", label: "Hyundai Recognized Collision Repair Center", issuer: "Hyundai" },
    { kind: "oem", label: "Nissan Certified Collision Repair Network", issuer: "Nissan" },
    { kind: "oem", label: "Porsche Approved Collision Center", issuer: "Porsche" },
    { kind: "oem", label: "Tesla Approved", issuer: "Tesla" },
  ],
  warranty: {
    terms: "Written lifetime warranty on labor and workmanship for as long as you own the vehicle",
    lifetime: true,
  },
  approvedReviewQuotes: [],
  drpDisclosure: { allowed: false, authorizedCarriers: [] },
  knownCompetitors: [],
});

/**
 * Wallace Collision Center — Bristol, TN. A deep OEM certification bench; the
 * record carries the subset the copy actually asserts. Founding year not
 * authoritatively stated, so `yearsInBusiness` is omitted.
 */
const wallaceFacts: VerifiedFacts = verifiedFactsSchema.parse({
  shopId: "shop-wallace",
  certifications: [
    { kind: "i_car", label: "I-CAR Gold Class Certified", level: "Gold Class", issuer: "I-CAR" },
    { kind: "oem", label: "BMW Certified Collision Repair Center", issuer: "BMW" },
    { kind: "oem", label: "Tesla Approved Body Shop", issuer: "Tesla" },
    { kind: "oem", label: "Subaru Certified Collision Center", issuer: "Subaru" },
    { kind: "oem", label: "Kia Certified Collision Repair Center", issuer: "Kia" },
    { kind: "oem", label: "Ford National Body Shop Network", issuer: "Ford" },
    { kind: "oem", label: "Rivian Certified Collision Center", issuer: "Rivian" },
  ],
  warranty: {
    terms: "Limited lifetime workmanship warranty covering our repairs for as long as you own the vehicle",
    lifetime: true,
  },
  approvedReviewQuotes: [],
  drpDisclosure: { allowed: false, authorizedCarriers: [] },
  knownCompetitors: [],
});

export const BSM_VERIFIED_FACTS: Record<string, VerifiedFacts> = {
  "shop-tracys": tracysFacts,
  "shop-tedesco": tedescoFacts,
  "shop-wallace": wallaceFacts,
};

/* -------------------------------------------------------------------------- */
/* The nine assets (3 per shop) + claims manifests.                           */
/* Conversion job per asset is recorded in CONVERSION_JOBS below.             */
/* -------------------------------------------------------------------------- */

/** The single conversion job each asset is built around (for QA visibility). */
export const CONVERSION_JOBS: Record<string, "call" | "quote" | "directions"> = {
  "tracys-blog": "call",
  "tracys-service": "quote",
  "tracys-meta": "call",
  "tedesco-blog": "directions",
  "tedesco-service": "call",
  "tedesco-meta": "directions",
  "wallace-blog": "quote",
  "wallace-service": "directions",
  "wallace-meta": "quote",
};

/** A generated asset tagged with a stable key for the runner/report. */
export type KeyedAsset = { key: string; asset: GeneratedAsset };

export const BSM_GENERATED_ASSETS: KeyedAsset[] = [
  /* ----------------------------- Tracy's (Lincoln, NE) -------------------- */
  {
    key: "tracys-blog",
    asset: {
      shopId: "shop-tracys",
      contentType: "blog_post",
      title: "What “I-CAR Gold Class” Actually Means for Your Lincoln Repair",
      body: [
        "If you have never had to think about where your car gets fixed after a wreck, the certifications on a body shop's wall can read like noise. Here is the one that actually changes the repair on your bumper.",
        "**I-CAR Gold Class** is the training tier only a small share of shops in the country hold. At Tracy's, our technicians carry it — so the people welding your frame and blending your paint train on current vehicle construction, not on whatever was true a decade ago.",
        "It is not the only credential that matters for your specific car:",
        "- **Honda and Acura ProFirst** certified, so those models are repaired to the maker's own procedures.",
        "- **FCA US LLC** certified for Chrysler, Dodge, Jeep and Ram.",
        "- Certified through the **Assured Performance** network, the third-party audit behind most automaker programs.",
        "Why does that matter to you and not just to us? A modern unibody and its sensors only behave in a crash the way the engineer intended when the repair follows the engineer's steps. Guesswork shows up later — a panel gap, a warning light, a door that sits proud.",
        "We have been doing this for Lincoln drivers since 1969, and we back the work with a lifetime warranty on the metalwork and paint for as long as you own the vehicle.",
        "Car needs a look after a collision? **Call Tracy's and talk to a real estimator** — not a call center — about what your repair actually involves.",
      ].join("\n\n"),
      metaDescription:
        "I-CAR Gold Class collision repair in Lincoln, NE, trusted since 1969. Lifetime warranty on metalwork and paint. Call Tracy's to talk to a real estimator.",
      claimsManifest: [
        { claimText: "our technicians carry I-CAR Gold Class", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Honda and Acura ProFirst certified", field: "certifications", value: "Honda" },
        { claimText: "FCA US LLC certified", field: "certifications", value: "FCA" },
        { claimText: "Certified through the Assured Performance network", field: "certifications", value: "Assured Performance" },
        { claimText: "doing this for Lincoln drivers since 1969", field: "yearsInBusiness", value: "56" },
        { claimText: "lifetime warranty on the metalwork and paint for as long as you own the vehicle", field: "warranty", value: "lifetime" },
      ],
    },
  },
  {
    key: "tracys-service",
    asset: {
      shopId: "shop-tracys",
      contentType: "service_page",
      title: "Collision Repair in Lincoln, NE",
      body: [
        "# Collision Repair in Lincoln, NE",
        "Rear-ended on O Street? Hail come through? Tracy's has put Lincoln's cars back together since 1969, and the repair you get here is built to the automaker's spec — not improvised.",
        "## What you get",
        "- **I-CAR Gold Class** technicians on every repair — the top training tier in collision.",
        "- Manufacturer-certified work for **Honda and Acura**, and for **Chrysler, Dodge, Jeep and Ram** (FCA US LLC certified).",
        "- On-site color matching so the new paint meets the old without a halo.",
        "- A **lifetime warranty on metalwork and paint for as long as you own the car**, in writing.",
        "## How it works",
        "1. Bring the car in — or have it towed straight to us.",
        "2. We write a detailed estimate and, with your okay, work with all major insurance companies on your behalf.",
        "3. You approve the plan before a tool touches the car.",
        "4. We repair to certified procedure, then quality-check before you pick it up.",
        "You choose the shop, not your insurer — it is your car and your right.",
        "**Request your written estimate today.** Tell us what happened and we will tell you exactly what the repair takes.",
      ].join("\n\n"),
      metaDescription:
        "Certified collision repair in Lincoln, NE. I-CAR Gold Class technicians, lifetime warranty on metalwork and paint. Request your written estimate from Tracy's.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class technicians on every repair", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Manufacturer-certified work for Honda and Acura", field: "certifications", value: "Honda" },
        { claimText: "FCA US LLC certified", field: "certifications", value: "FCA" },
        { claimText: "put Lincoln's cars back together since 1969", field: "yearsInBusiness", value: "56" },
        { claimText: "lifetime warranty on metalwork and paint for as long as you own the car", field: "warranty", value: "lifetime" },
      ],
    },
  },
  {
    key: "tracys-meta",
    asset: {
      shopId: "shop-tracys",
      contentType: "meta_description",
      title: "",
      body:
        "I-CAR Gold Class collision repair in Lincoln, NE — trusted since 1969. Lifetime warranty on metalwork and paint. Call Tracy's for a straight estimate.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class collision repair", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "trusted since 1969", field: "yearsInBusiness", value: "56" },
        { claimText: "lifetime warranty on metalwork and paint", field: "warranty", value: "lifetime" },
      ],
    },
  },

  /* ----------------------------- Tedesco (New Rochelle, NY) --------------- */
  {
    key: "tedesco-blog",
    asset: {
      shopId: "shop-tedesco",
      contentType: "blog_post",
      title: "Tesla or Porsche Damage in New Rochelle? Why a Shop's Approvals Matter",
      body: [
        "When a manufacturer puts its name on a body shop — “Tesla Approved,” “Porsche Approved” — it is not marketing. It is the automaker confirming the shop has the specific tooling, training and parts access to repair that vehicle the way the factory built it.",
        "Tedesco Auto Body on Main Street holds several of those approvals, and they are not easy to keep:",
        "- **Tesla Approved** and **Porsche Approved Collision Center** — EV and high-line work to the maker's procedures.",
        "- **Nissan Certified** and **Hyundai Recognized** collision repair.",
        "- **FCA US LLC** certified for Chrysler, Dodge, Jeep and Ram.",
        "- **I-CAR Gold Class** and **ASE** certified technicians across the board.",
        "The practical difference: an aluminum-intensive or high-voltage vehicle repaired outside the maker's process can pass a glance and still be wrong underneath — a structural section bonded incorrectly, a battery enclosure that is not resealed to spec. Approved shops work to the document, not the eyeball.",
        "Every repair Tedesco delivers carries a written lifetime warranty on labor and workmanship for as long as you own the vehicle.",
        "If your car needs that level of repair, **get directions to 320 Main Street in New Rochelle** and bring it by for a look.",
      ].join("\n\n"),
      metaDescription:
        "Tesla- and Porsche-approved, I-CAR Gold Class collision repair in New Rochelle, NY. Written lifetime warranty on workmanship. Get directions to 320 Main St.",
      claimsManifest: [
        { claimText: "Tesla Approved", field: "certifications", value: "Tesla" },
        { claimText: "Porsche Approved Collision Center", field: "certifications", value: "Porsche" },
        { claimText: "Nissan Certified", field: "certifications", value: "Nissan" },
        { claimText: "Hyundai Recognized", field: "certifications", value: "Hyundai" },
        { claimText: "FCA US LLC certified", field: "certifications", value: "FCA" },
        { claimText: "I-CAR Gold Class", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "ASE certified technicians", field: "certifications", value: "ASE" },
        { claimText: "written lifetime warranty on labor and workmanship for as long as you own the vehicle", field: "warranty", value: "lifetime" },
      ],
    },
  },
  {
    key: "tedesco-service",
    asset: {
      shopId: "shop-tedesco",
      contentType: "service_page",
      title: "Collision & Auto Body Repair in New Rochelle, NY",
      body: [
        "# Collision & Auto Body Repair in New Rochelle, NY",
        "After a collision, where you take the car decides how it comes back. Tedesco Auto Body on Main Street repairs to manufacturer procedure — for everyday commuters and for the brands that demand certified shops.",
        "## Certified for the cars people actually drive here",
        "- **I-CAR Gold Class** and **ASE** certified technicians.",
        "- **Tesla Approved** and **Porsche Approved** for EV and high-line repair.",
        "- **Nissan Certified**, **Hyundai Recognized**, and **FCA US LLC** certified (Chrysler, Dodge, Jeep, Ram).",
        "## What you can count on",
        "- Genuine manufacturer parts and factory repair procedures.",
        "- A **written lifetime warranty on labor and workmanship** for as long as you own the vehicle.",
        "- A straight answer on what your repair needs — and what it does not.",
        "We work with all major insurance companies, and the choice of shop is always yours.",
        "**Call Tedesco to start your repair** and speak with the team that will actually do the work.",
      ].join("\n\n"),
      metaDescription:
        "Certified collision repair in New Rochelle, NY: I-CAR Gold Class, Tesla- and Porsche-approved. Written lifetime warranty on workmanship. Call Tedesco Auto Body.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class certified technicians", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "ASE certified technicians", field: "certifications", value: "ASE" },
        { claimText: "Tesla Approved", field: "certifications", value: "Tesla" },
        { claimText: "Porsche Approved", field: "certifications", value: "Porsche" },
        { claimText: "Nissan Certified", field: "certifications", value: "Nissan" },
        { claimText: "Hyundai Recognized", field: "certifications", value: "Hyundai" },
        { claimText: "FCA US LLC certified", field: "certifications", value: "FCA" },
        { claimText: "written lifetime warranty on labor and workmanship for as long as you own the vehicle", field: "warranty", value: "lifetime" },
      ],
    },
  },
  {
    key: "tedesco-meta",
    asset: {
      shopId: "shop-tedesco",
      contentType: "meta_description",
      title: "",
      body:
        "I-CAR Gold Class, Tesla- and Porsche-approved collision repair in New Rochelle, NY. Written lifetime warranty on workmanship. Get directions to 320 Main St.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Tesla approved", field: "certifications", value: "Tesla" },
        { claimText: "Porsche approved", field: "certifications", value: "Porsche" },
        { claimText: "written lifetime warranty on workmanship", field: "warranty", value: "lifetime" },
      ],
    },
  },

  /* ----------------------------- Wallace (Bristol, TN) ------------------- */
  {
    key: "wallace-blog",
    asset: {
      shopId: "shop-wallace",
      contentType: "blog_post",
      title: "EV and Late-Model Collision Repair in Bristol: What “Certified” Buys You",
      body: [
        "New cars are computers wrapped in aluminum and high-strength steel. Repairing one after a wreck is less about a hammer and more about following the manufacturer's exact procedure — which is the whole point of OEM certification.",
        "Wallace Collision Center in Bristol carries a deep bench of them:",
        "- **I-CAR Gold Class** — the top training standard in the trade.",
        "- **Tesla Approved** and **Rivian Certified** for EV structural and battery-adjacent work.",
        "- **BMW Certified**, **Subaru Certified**, and **Kia Certified** collision repair.",
        "- Part of the **Ford National Body Shop Network**.",
        "Each of those means the same thing in practice: factory procedures, approved parts, and the tooling the maker requires — so the repair restores the car's crash performance instead of just its looks.",
        "The work is backed by a limited lifetime workmanship warranty that covers our repairs for as long as you own the vehicle.",
        "Not sure whether your car needs a certified shop? It almost certainly does — **request an estimate from Wallace** and we will walk you through what your specific vehicle requires.",
      ].join("\n\n"),
      metaDescription:
        "I-CAR Gold Class, Tesla- and BMW-certified collision repair in Bristol, TN. Limited lifetime workmanship warranty. Request an estimate from Wallace Collision Center.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Tesla Approved", field: "certifications", value: "Tesla" },
        { claimText: "Rivian Certified", field: "certifications", value: "Rivian" },
        { claimText: "BMW Certified", field: "certifications", value: "BMW" },
        { claimText: "Subaru Certified", field: "certifications", value: "Subaru" },
        { claimText: "Kia Certified", field: "certifications", value: "Kia" },
        { claimText: "part of the Ford National Body Shop Network", field: "certifications", value: "Ford" },
        { claimText: "limited lifetime workmanship warranty that covers our repairs for as long as you own the vehicle", field: "warranty", value: "lifetime" },
      ],
    },
  },
  {
    key: "wallace-service",
    asset: {
      shopId: "shop-wallace",
      contentType: "service_page",
      title: "Certified Collision Repair in Bristol, TN",
      body: [
        "# Certified Collision Repair in Bristol, TN",
        "Wallace Collision Center repairs late-model and electric vehicles to the manufacturer's own standard — the kind of work a modern car actually needs after a collision.",
        "## OEM and EV certified",
        "- **I-CAR Gold Class** technicians.",
        "- **Tesla Approved** and **Rivian Certified** for electric vehicles.",
        "- **BMW Certified**, **Subaru Certified**, **Kia Certified**, and part of the **Ford National Body Shop Network**.",
        "## What that means for your repair",
        "- Factory repair procedures and manufacturer-approved parts.",
        "- A **limited lifetime workmanship warranty** covering our repairs for as long as you own the vehicle.",
        "- Honest scoping — we tell you what the car needs and what it does not.",
        "We work with all major insurance companies, and you always choose the shop.",
        "**Get directions to Wallace Collision Center in Bristol** and bring your vehicle in for a certified estimate.",
      ].join("\n\n"),
      metaDescription:
        "Certified collision repair in Bristol, TN: I-CAR Gold Class, Tesla and Rivian EV certified. Limited lifetime workmanship warranty. Get directions to Wallace.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class technicians", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Tesla Approved", field: "certifications", value: "Tesla" },
        { claimText: "Rivian Certified", field: "certifications", value: "Rivian" },
        { claimText: "BMW Certified", field: "certifications", value: "BMW" },
        { claimText: "Subaru Certified", field: "certifications", value: "Subaru" },
        { claimText: "Kia Certified", field: "certifications", value: "Kia" },
        { claimText: "part of the Ford National Body Shop Network", field: "certifications", value: "Ford" },
        { claimText: "limited lifetime workmanship warranty covering our repairs for as long as you own the vehicle", field: "warranty", value: "lifetime" },
      ],
    },
  },
  {
    key: "wallace-meta",
    asset: {
      shopId: "shop-wallace",
      contentType: "meta_description",
      title: "",
      body:
        "I-CAR Gold Class, Tesla- and BMW-certified collision repair in Bristol, TN. Limited lifetime workmanship warranty. Request your estimate from Wallace Collision Center.",
      claimsManifest: [
        { claimText: "I-CAR Gold Class", field: "certifications", value: "I-CAR Gold Class" },
        { claimText: "Tesla certified", field: "certifications", value: "Tesla" },
        { claimText: "BMW certified", field: "certifications", value: "BMW" },
        { claimText: "limited lifetime workmanship warranty", field: "warranty", value: "lifetime" },
      ],
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Runner — gate all nine assets against their shop's verified facts.         */
/* -------------------------------------------------------------------------- */

export type GatedDraft = {
  key: string;
  shopId: string;
  contentType: GeneratedAsset["contentType"];
  conversionJob: "call" | "quote" | "directions";
  gated: GatedAsset;
  shipped: boolean;
};

/**
 * Gate every asset against `BSM_VERIFIED_FACTS[shopId]`. Pure: returns the
 * per-asset verdict so a test or a CLI runner can assert/print `ship` for all 9.
 */
export function gateAllBsmDrafts(): GatedDraft[] {
  return BSM_GENERATED_ASSETS.map(({ key, asset }) => {
    const facts = BSM_VERIFIED_FACTS[asset.shopId];
    if (!facts) throw new Error(`No verified-facts record for ${asset.shopId} (asset ${key})`);
    const gated = gateGeneratedAsset(asset, facts);
    return {
      key,
      shopId: asset.shopId,
      contentType: asset.contentType,
      conversionJob: CONVERSION_JOBS[key],
      gated,
      shipped: isShippable(gated),
    };
  });
}

/** Render a human-readable ship table for the CLI runner / test output. */
export function formatGateReport(results: GatedDraft[]): string {
  const lines = results.map((r) => {
    const verdict = r.gated.result.verdict.toUpperCase();
    const codes = r.gated.result.violations.map((v) => v.code).join(", ");
    const status = r.shipped ? "SHIP" : `FAIL (${verdict}: ${codes})`;
    return `  ${r.key.padEnd(18)} ${r.contentType.padEnd(17)} job=${r.conversionJob.padEnd(11)} ${status}`;
  });
  const shipped = results.filter((r) => r.shipped).length;
  return [
    `BSM Content Writer drafts — claim-integrity gate (PSG-193):`,
    ...lines,
    `  ${"-".repeat(64)}`,
    `  ${shipped}/${results.length} ship`,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Provenance enforcement + per-asset provenance manifest (PSG-173 Check 3).  */
/* -------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** True when `sourceUrl`'s host is (or is a subdomain of) the shop's own domain. */
export function isOnOwnDomain(sourceUrl: string, ownDomain: string): boolean {
  let host: string;
  try {
    host = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const domain = ownDomain.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Enforce Lee's two Check-3 non-negotiables across all three records:
 *   1. Per-fact provenance is mandatory — every certification, every warranty
 *      term, and every years-in-business datum present in a record has a source.
 *   2. Every source is the shop's OWN site (`SHOP_OWN_DOMAINS`). A third-party
 *      directory/aggregator does not satisfy Check 3; a fact that can only be
 *      third-party-sourced must be dropped from the record, not kept.
 * Throws on the first gap so the runner fails HERE, not at the brand-voice gate.
 */
export function assertProvenanceIntegrity(): void {
  for (const [shopId, facts] of Object.entries(BSM_VERIFIED_FACTS)) {
    const ownDomain = SHOP_OWN_DOMAINS[shopId];
    const prov = BSM_FACT_PROVENANCE[shopId];
    if (!ownDomain) throw new Error(`No own-domain declared for ${shopId}`);
    if (!prov) throw new Error(`No provenance record for ${shopId}`);

    const requireOwnSource = (what: string, label: string, url: string | undefined) => {
      if (!url) {
        throw new Error(`${shopId}: missing provenance source for ${what} ("${label}")`);
      }
      if (!isOnOwnDomain(url, ownDomain)) {
        throw new Error(
          `${shopId}: provenance for ${what} ("${label}") cites "${url}", not the shop's own ` +
            `domain (${ownDomain}). Drop the fact or source it to the shop's own statement — ` +
            `third-party directories/aggregators do not satisfy Check 3.`,
        );
      }
    };

    for (const cert of facts.certifications) {
      requireOwnSource("certification", cert.label, prov.certifications[cert.label]);
    }
    if (facts.warranty) requireOwnSource("warranty", facts.warranty.terms, prov.warranty);
    if (facts.yearsInBusiness !== undefined) {
      requireOwnSource("years in business", String(facts.yearsInBusiness), prov.yearsInBusiness);
    }
    // DRP/carrier stays default-deny for all three (drpDisclosure.allowed=false),
    // so no carrier is named and no carrier provenance is required. If a shop ever
    // opts in, each authorized carrier would need its own own-source entry here.
    if (prov.location) requireOwnSource("location", "address", prov.location);
  }
}

/** One claim, annotated with the shop's-own-site source that backs it. */
export type ProvenancedClaim = {
  claimText: string;
  field: ClaimField;
  value?: string;
  /** The verified-facts datum the claim resolves to (cert label / warranty / tenure). */
  backingFact: string;
  /** Authoritative source URL on the shop's own domain. */
  sourceUrl: string;
};

/** A single asset's claims manifest, every entry linked to its own-site source. */
export type AssetProvenanceManifest = {
  key: string;
  shopId: string;
  contentType: GeneratedAsset["contentType"];
  claims: ProvenancedClaim[];
};

/**
 * Resolve one manifest entry to the verified fact it backs and that fact's
 * own-site source. The cert match mirrors the validator (`verifyClaim`) exactly,
 * so the annotation points at the SAME cert the gate accepted. Throws if a claim
 * cannot be resolved to a sourced fact — an asset that passes claim-integrity but
 * carries an unsourced claim is a Check-3 reject (Lee's contract).
 */
function resolveClaimProvenance(
  entry: ClaimManifestEntry,
  facts: VerifiedFacts,
  prov: ShopProvenance,
): ProvenancedClaim {
  const { field, value, claimText } = entry;
  const fail = (msg: string): never => {
    throw new Error(`${facts.shopId} claim "${claimText}": ${msg}`);
  };

  switch (field) {
    case "certifications": {
      const cert = facts.certifications.find(
        (c) =>
          value === undefined ||
          norm(c.label) === norm(value) ||
          (c.level !== undefined && norm(c.level) === norm(value)) ||
          norm(c.label).includes(norm(value)),
      );
      if (!cert) return fail(`no certification in the record backs value "${value ?? ""}"`);
      const src = prov.certifications[cert.label];
      if (!src) return fail(`certification "${cert.label}" has no own-site provenance source`);
      return { claimText, field, value, backingFact: cert.label, sourceUrl: src };
    }
    case "warranty": {
      if (!facts.warranty) return fail("record has no warranty");
      if (!prov.warranty) return fail("warranty has no own-site provenance source");
      return {
        claimText,
        field,
        value,
        backingFact: facts.warranty.terms,
        sourceUrl: prov.warranty,
      };
    }
    case "yearsInBusiness": {
      if (facts.yearsInBusiness === undefined) return fail("record has no tenure");
      if (!prov.yearsInBusiness) return fail("tenure has no own-site provenance source");
      return {
        claimText,
        field,
        value,
        backingFact: `${facts.yearsInBusiness} years in business`,
        sourceUrl: prov.yearsInBusiness,
      };
    }
    default:
      // approvedReviewQuotes / drpDisclosure are not used by these assets; a claim
      // on either would need its own sourced provenance before it could ship.
      return fail(`field "${field}" carries no provenance for these assets`);
  }
}

/**
 * Build, for every asset, its claims manifest with each entry linked to the
 * shop's-own-site source backing it. This is the artifact Lee runs Check 3
 * against: claim → verified fact → own-site URL.
 */
export function buildAssetProvenanceManifests(): AssetProvenanceManifest[] {
  return BSM_GENERATED_ASSETS.map(({ key, asset }) => {
    const facts = BSM_VERIFIED_FACTS[asset.shopId];
    const prov = BSM_FACT_PROVENANCE[asset.shopId];
    if (!facts || !prov) {
      throw new Error(`Missing facts/provenance for ${asset.shopId} (asset ${key})`);
    }
    return {
      key,
      shopId: asset.shopId,
      contentType: asset.contentType,
      claims: asset.claimsManifest.map((e) => resolveClaimProvenance(e, facts, prov)),
    };
  });
}

/** Render the per-asset provenance manifest for the CLI runner / gate handoff. */
export function formatProvenanceReport(manifests: AssetProvenanceManifest[]): string {
  const blocks = manifests.map((m) => {
    const rows = m.claims.map(
      (c) => `    - "${c.claimText}" → ${c.backingFact} [${c.sourceUrl}]`,
    );
    return [`  ${m.key} (${m.contentType}):`, ...rows].join("\n");
  });
  return [
    `BSM drafts — claim provenance (every claim → shop's own source, PSG-173 Check 3):`,
    ...blocks,
  ].join("\n");
}
