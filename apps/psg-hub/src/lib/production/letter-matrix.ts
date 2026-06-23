/**
 * The full triggered-letter matrix (W2, PSG-304 / PSG-115).
 *
 * PSG-218 (./triggers.ts) decides WHICH letters a recipient earns and enforces
 * suppression; this module supplies the WHAT — the productized creative for every
 * piece in PSG's Master Follow-Up Program, wired so the dry-run (./dry-run.ts) can
 * resolve trigger → template + variant → merge → proof end-to-end.
 *
 * Design (faithful to PSG-219/PSG-220, "don't reinvent"): each letter is one
 * brand chassis (US-Letter, #10 window) filled from NAMED COPY BLOCKS
 * (`headline · body · warranty · surveyCta · signoff · footer`). Authoring a piece
 * is filling copy strings, not writing HTML; the chassis composes them into the
 * exact token-bearing `MailTemplate` the existing engine already renders
 * (`renderMailContent`) and the proof gate already hashes (`templateContentHash`).
 *
 * Every piece carries >= 2 creative VARIANTS. Variants are the per-recipient
 * anti-repeat rotation axis (AC2): a household that already received variant A of
 * a piece rotates to B on a later qualifying send (see ./variant-select.ts). The
 * `pieceCode` is the stable suppression / audit key; the per-variant piece code
 * (`pieceCode:variantId`) is what the dedup engine keys "already_mailed" on.
 *
 * PURE: no DB, no clock, no network — data + string composition only.
 */

import { defaultTemplate, letterDoc, type MailProduct, type MailTemplate } from "./templates";
import type { LetterCategory, LetterPiece, LetterRecipient } from "./triggers";

/* -------------------------------------------------------------------------- */
/* Copy blocks + variants                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The named copy blocks a letter is decomposed into (PSG-219 block model). All
 * are token-bearing HTML fragments resolved against `MailMergeData`; `body` is
 * required, the rest are optional and omitted blocks simply do not render.
 */
export interface LetterBlocks {
  /** Small uppercase kicker above the headline (optional). */
  eyebrow?: string;
  /** One-line lead statement (rendered emphasized). */
  headline?: string;
  /** Main body — one or more `<p>…</p>` paragraphs (required). */
  body: string;
  /** The PS105 warranty paragraph, when this piece carries it. */
  warranty?: string;
  /** Offer / coupon block (acquisition + win-back pieces only; NEVER recovery). */
  offer?: string;
  /** ACRB survey ask — typically a P.S. */
  surveyCta?: string;
  /** Sign-off line; defaults to "Sincerely," */
  signoff?: string;
  /** Footer override; defaults to the piece's `defaultFooter`. */
  footer?: string;
}

/** One creative direction for a piece — the unit the anti-repeat axis rotates. */
export interface LetterVariant {
  /** Stable id, unique within the piece (e.g. "A" / "B"). */
  id: string;
  /** Human / creative-direction label (UI + audit). */
  label: string;
  /**
   * Reuse an APPROVED W1 master from `DEFAULT_TEMPLATES` (PSG-308) verbatim,
   * instead of composing blocks. Set on the canonical variant of pieces that
   * already shipped an approved master (thank_you / warranty / service_recovery)
   * so the dry-run proof — and its content hash — is the approved template, with
   * no copy drift. When set, `blocks` is ignored.
   */
  useDefaultProduct?: MailProduct;
  /** Block copy for a composed variant. Required unless `useDefaultProduct` is set. */
  blocks?: LetterBlocks;
}

/** A piece in the matrix: trigger-engine identity + its creative variants. */
export interface LetterDefinition {
  piece: LetterPiece;
  /** Marketing name (mirrors the trigger rule). */
  name: string;
  /**
   * Stable piece code — the suppression/audit key. Grounded in the real library
   * where known (Thank-You PS682, warranty PS105, estimate PSG_P_016, win-back
   * "16", totaled "t"); otherwise a stable PSG-* code.
   */
  pieceCode: string;
  /** Suppression class — mirrors the trigger rule's category. */
  category: LetterCategory;
  /** Addressee — agent pieces survive consumer suppression. */
  recipient: LetterRecipient;
  /** Color print (letters default to color for the brand accent rule). */
  color: boolean;
  /** Chassis greeting line; defaults to "Dear {{customer.firstName}}," */
  greeting?: string;
  /** Default tri-part footer (piece code · tagline · job number). */
  defaultFooter: string;
  /** >= 2 creative directions — the anti-repeat rotation axis. */
  variants: readonly LetterVariant[];
}

/* -------------------------------------------------------------------------- */
/* Chassis: compose named blocks → a token-bearing letter MailTemplate         */
/* -------------------------------------------------------------------------- */

const DEFAULT_GREETING = "Dear {{customer.firstName}},";

/** Compose the ordered blocks of one variant into a full letter HTML body. */
export function composeLetterBody(def: LetterDefinition, variant: LetterVariant): string {
  const b = variant.blocks;
  if (!b) {
    throw new Error(
      `Variant "${variant.id}" of piece "${def.piece}" has no blocks and no useDefaultProduct`
    );
  }
  const parts: string[] = [];
  // Shop identity leads (never PSG) — PSG-219 reconciliation against the library.
  parts.push(`<div class="masthead">{{company.name}}</div>`);
  parts.push(`<div class="recipient">{{customer.fullName}}</div>`);
  const greeting = def.greeting ?? DEFAULT_GREETING;
  if (greeting) parts.push(`<p class="greeting">${greeting}</p>`);
  if (b.eyebrow) parts.push(`<p class="eyebrow">${b.eyebrow}</p>`);
  if (b.headline) parts.push(`<p class="headline"><strong>${b.headline}</strong></p>`);
  parts.push(b.body);
  if (b.warranty) parts.push(b.warranty);
  if (b.offer) parts.push(`<p class="offer">${b.offer}</p>`);
  if (b.surveyCta) parts.push(`<p class="survey-cta">${b.surveyCta}</p>`);
  const signoff = b.signoff ?? "Sincerely,";
  parts.push(
    `<p class="signoff">${signoff}<br /><span class="company">{{program.ownerName}}</span>` +
      `<br />{{program.ownerTitle}}</p>`
  );
  parts.push(`<p class="contact">${b.footer ?? def.defaultFooter}</p>`);
  return letterDoc(parts.join(""));
}

/**
 * Build the `MailTemplate` for one (piece, variant). The result feeds straight
 * into `renderMailContent` / `buildMailDocument` and `templateContentHash`. The
 * template `product` is set to the piece so existing engine code paths are
 * unaffected (it is a free-form label at the type level for matrix templates).
 */
export function templateForVariant(def: LetterDefinition, variant: LetterVariant): MailTemplate {
  // Canonical variants reuse the approved W1 master verbatim (PSG-308) — no drift.
  if (variant.useDefaultProduct) return defaultTemplate(variant.useDefaultProduct);
  return {
    // `product` is a label here; matrix pieces extend beyond the base products.
    product: def.piece as unknown as MailTemplate["product"],
    pieceType: "letter",
    color: def.color,
    bodyHtml: composeLetterBody(def, variant),
  };
}

/* -------------------------------------------------------------------------- */
/* Shared copy fragments (kept honest-claims clean)                            */
/* -------------------------------------------------------------------------- */

// Warranty TERM is per-shop, NOT universal (honest-claims gate, PSG-316 C1):
// `{{program.warrantyTerm}}` carries each shop's own duration clause (e.g. "for as
// long as you own the vehicle"). Fail-closed — a shop without a configured term
// leaves the token unresolved and the proof gate's missing-token report blocks it.
const WARRANTY_PARA =
  `<p>Your {{customer.vehicle}} is backed by our written workmanship warranty ` +
  `{{program.warrantyTerm}}. If anything related to our work is ever less than right, call ` +
  `{{company.phone}} and we will make it right at no charge to you.</p>`;

/** ACRB survey ask — uses the per-customer security code + survey id (PSG-219). */
const SURVEY_CTA =
  `P.S. Your feedback shapes everything we do. Please take two minutes for the ACRB ` +
  `survey at www.theacrb.com — Online Security Code <strong>{{customer.surveySecurityCode}}</strong>, ` +
  `Survey ID <strong>{{customer.surveyId}}</strong>.`;

/* -------------------------------------------------------------------------- */
/* The matrix                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every piece in the Master Follow-Up Program, each with two productized
 * creative directions. Copy is grounded in PSG's real library (PSG-219 §0
 * catalogue); the proof gate + CMO/designer review (PSG-219 owner) is the
 * authority on final brand-voice — this layer makes the matrix resolve and
 * rotate, deterministically, end-to-end.
 */
export const LETTER_MATRIX: Readonly<Record<LetterPiece, LetterDefinition>> = {
  thank_you: {
    piece: "thank_you",
    name: "Thank You + ACRB Survey",
    pieceCode: "PS682",
    category: "relationship",
    recipient: "customer",
    color: true,
    defaultFooter: `PS682 &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "Faithful Letter (PSG-308 approved master)",
        // Canonical: the approved W1 Thank-You + ACRB survey master (PSG-308).
        useDefaultProduct: "thank_you",
      },
      {
        id: "B",
        label: "Backed in Writing",
        blocks: {
          headline: "Your repair is done right — and guaranteed in writing.",
          body:
            `<p>Thank you for choosing {{company.name}} to repair your {{customer.vehicle}}. ` +
            `We do not consider a job finished until it is finished right.</p>` +
            `<p>That is why every repair we hand back carries our written guarantee.</p>`,
          warranty: WARRANTY_PARA,
          surveyCta: SURVEY_CTA,
        },
      },
    ],
  },

  warranty: {
    piece: "warranty",
    name: "Workmanship Warranty",
    pieceCode: "PS105",
    category: "relationship",
    recipient: "customer",
    color: true,
    defaultFooter: `PS105 &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "Workmanship Warranty (PSG-308 approved master)",
        // Canonical: the approved W1 warranty letter (PSG-308). Its warranty-term
        // claim is tokenized as {{program.warrantyTerm}} in DEFAULT_TEMPLATES (PSG-316 C1).
        useDefaultProduct: "warranty",
      },
      {
        id: "B",
        label: "One Call Away",
        blocks: {
          headline: "If anything is ever less than right, we are one call away.",
          body:
            `<p>The repairs we completed on your {{customer.vehicle}} on {{customer.serviceDate}} are ` +
            `guaranteed. You should never have to worry about the quality of our work.</p>`,
          warranty: WARRANTY_PARA,
        },
      },
    ],
  },

  perfect_score: {
    piece: "perfect_score",
    name: "Perfect Score",
    pieceCode: "PS-PERF",
    category: "relationship",
    recipient: "customer",
    color: true,
    defaultFooter: `PS-PERF &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "A Perfect 100",
        blocks: {
          headline: "A perfect score — thank you for making our day.",
          body:
            `<p>You rated your experience with {{company.name}} a perfect 100%. That means the ` +
            `world to our whole team, and we do not take it for granted.</p>` +
            `<p>If you would be willing to share your experience with others` +
            `{{#if program.reviewLink}} at {{program.reviewLink}}{{else}} online{{/if}}, it would help ` +
            `more of your neighbors find a shop they can trust.</p>`,
        },
      },
      {
        id: "B",
        label: "Would You Tell a Neighbor",
        blocks: {
          headline: "You gave us a perfect score. Would you tell a neighbor?",
          body:
            `<p>Thank you for rating your repair on your {{customer.vehicle}} a perfect 100%. ` +
            `Reviews from customers like you are the best compliment we can receive.</p>` +
            `<p>A few words about your experience` +
            `{{#if program.reviewLink}} at {{program.reviewLink}}{{else}} online{{/if}} would mean a ` +
            `great deal to us.</p>`,
        },
      },
    ],
  },

  recommend_agent: {
    piece: "recommend_agent",
    name: "Recommend An Agent",
    pieceCode: "PS-RECA",
    category: "recovery",
    recipient: "customer",
    color: true,
    defaultFooter: `PS-RECA &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "An Agent Who Works For You",
        blocks: {
          headline: "Your insurance should work as hard for you as we did.",
          body:
            `<p>A claim should leave you feeling supported, not stressed. If your recent experience ` +
            `fell short of that, you deserve an agent who is truly in your corner.</p>` +
            `<p>If you would ever like an introduction to an independent agent we trust, just call ` +
            `{{company.phone}} — there is never any pressure.</p>`,
        },
      },
      {
        id: "B",
        label: "Here If You Need Us",
        blocks: {
          headline: "A good agent makes all the difference.",
          body:
            `<p>Handling a claim can be stressful, and not every agent makes it easier. If you are ` +
            `rethinking your coverage after this experience, we are glad to help.</p>` +
            `<p>Call {{company.phone}} and we will point you to agents who treat people right.</p>`,
        },
      },
    ],
  },

  agent_acknowledgement: {
    piece: "agent_acknowledgement",
    name: "Agent Customer Acknowledgement",
    pieceCode: "PS-AGAK",
    category: "agent",
    recipient: "agent",
    color: true,
    greeting: "Dear Agent,",
    defaultFooter: `PS-AGAK &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "Your Client Is In Good Hands",
        blocks: {
          headline: "Your client chose us — and they are in good hands.",
          body:
            `<p>Your client {{customer.fullName}} has entrusted {{company.name}} with the repair of ` +
            `their {{customer.vehicle}}. We will keep them informed and return the vehicle to ` +
            `pre-accident condition, backed by our written warranty.</p>` +
            `<p>Thank you for the confidence you place in us. Reach us any time at {{company.phone}}.</p>`,
        },
      },
      {
        id: "B",
        label: "A Partner You Can Count On",
        blocks: {
          headline: "A repair partner who makes you look good.",
          body:
            `<p>We are completing the repair of your client {{customer.fullName}}'s ` +
            `{{customer.vehicle}}. Our goal is a smooth, transparent process that reflects well on ` +
            `the coverage you placed.</p>` +
            `<p>If there is anything we can do to support you, call {{company.phone}}.</p>`,
        },
      },
    ],
  },

  call_your_agent: {
    piece: "call_your_agent",
    name: "Customer Call Your Agent",
    pieceCode: "PS-CYA",
    category: "relationship",
    recipient: "customer",
    color: true,
    defaultFooter: `PS-CYA &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "Thank Your Agent",
        blocks: {
          headline: "A quick thank-you to the agent who had your back.",
          body:
            `<p>We are glad we could restore your {{customer.vehicle}} for you. Your agent helped ` +
            `make the process possible — a short call to thank them goes a long way.</p>` +
            `<p>And know that {{company.name}} is always here for your next repair.</p>`,
        },
      },
      {
        id: "B",
        label: "Keep a Good Thing Going",
        blocks: {
          headline: "Two people had your back — your agent, and us.",
          body:
            `<p>Your repair is complete, and we hope your {{customer.vehicle}} feels good as new. ` +
            `If your agent made the claim easier, they would appreciate hearing it from you.</p>` +
            `<p>We will be right here whenever you need us again.</p>`,
        },
      },
    ],
  },

  totaled_vehicle: {
    piece: "totaled_vehicle",
    name: "Totaled Vehicle",
    pieceCode: "t",
    category: "relationship",
    recipient: "customer",
    color: true,
    defaultFooter: `t &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "With You Through the Loss",
        blocks: {
          headline: "We are sorry your {{customer.vehicle}} could not be saved.",
          body:
            `<p>Learning a vehicle is a total loss is never easy, and we are sorry you are going ` +
            `through it. Although we were not able to repair your {{customer.vehicle}}, we would be ` +
            `honored to help however we can.</p>` +
            `<p>When you are ready, call {{company.phone}} — we can walk you through the valuation ` +
            `process and answer any questions, with no obligation.</p>`,
        },
      },
      {
        id: "B",
        label: "A Steady Hand Next",
        blocks: {
          headline: "When you are ready for what is next, we are here.",
          body:
            `<p>We know a total loss brings a lot of decisions at once. We have helped many ` +
            `neighbors through this exact moment, and we are glad to be a steady, no-pressure ` +
            `resource for you.</p>` +
            `<p>Reach us at {{company.phone}} whenever the time is right.</p>`,
        },
      },
    ],
  },

  estimate_followup: {
    piece: "estimate_followup",
    name: "Estimate Follow Up",
    pieceCode: "PSG_P_016",
    category: "upsell",
    recipient: "customer",
    color: true,
    defaultFooter: `PSG_P_016 &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "Still Here to Help",
        blocks: {
          headline: "Your estimate is ready when you are.",
          body:
            `<p>We recently prepared an estimate for your {{customer.vehicle}} and wanted you to ` +
            `know our offer still stands. Quality repairs and a written guarantee — that is what ` +
            `you get with {{company.name}}.</p>`,
          offer:
            `As a thank-you for considering us, present this letter for ` +
            `<strong>{{program.offer}}</strong> on your scheduled repair.`,
        },
      },
      {
        id: "B",
        label: "Let's Get You Scheduled",
        blocks: {
          headline: "Let's get your {{customer.vehicle}} taken care of.",
          body:
            `<p>It is not too late to move forward on the estimate we prepared for you. Call ` +
            `{{company.phone}} and we will find a time that works and get your vehicle back to ` +
            `its best.</p>`,
          offer:
            `Bring this letter in for <strong>{{program.offer}}</strong> when you schedule — ` +
            `our way of saying we appreciate the opportunity.`,
        },
      },
    ],
  },

  cycle_anniversary: {
    piece: "cycle_anniversary",
    name: "Cycle Anniversary Win-Back",
    pieceCode: "16",
    category: "upsell",
    recipient: "customer",
    color: true,
    defaultFooter: `16 &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "It's Been a While",
        blocks: {
          headline: "It has been a while — we would love to see you again.",
          body:
            `<p>It has been some time since we cared for your {{customer.vehicle}} at ` +
            `{{company.name}}, and we wanted to reach out. Whether it is a fresh dent, a touch-up, ` +
            `or a question, we are here for you.</p>`,
          offer:
            `As a welcome-back, present this letter for <strong>{{program.offer}}</strong> on ` +
            `your next service.`,
        },
      },
      {
        id: "B",
        label: "Your Shop Remembers You",
        blocks: {
          headline: "Your trusted shop is still right here.",
          body:
            `<p>A lot can happen on the road in a year. If your {{customer.vehicle}} needs anything ` +
            `at all, remember that {{company.name}} already knows you — and stands behind our ` +
            `work in writing.</p>`,
          offer:
            `Come back and save: this letter is good for <strong>{{program.offer}}</strong> on ` +
            `your next visit.`,
        },
      },
    ],
  },

  seasonal_greeting: {
    piece: "seasonal_greeting",
    name: "Birthday / Seasonal Greeting",
    pieceCode: "PS-SEAS",
    category: "relationship",
    recipient: "customer",
    color: true,
    defaultFooter: `PS-SEAS &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "Warm Wishes",
        blocks: {
          headline: "Thinking of you — with warm wishes from all of us.",
          body:
            `<p>From everyone at {{company.name}}, we are sending warm wishes your way. Customers ` +
            `like you are the reason we love what we do.</p>` +
            `<p>No reason for this note other than to say thank you for being part of our family.</p>`,
        },
      },
      {
        id: "B",
        label: "Just to Say Thanks",
        blocks: {
          headline: "A little note, just to say we appreciate you.",
          body:
            `<p>We were thinking of our customers today and wanted you to be one of them. Thank ` +
            `you for trusting {{company.name}} — it means more than you know.</p>` +
            `<p>Wishing you safe miles and good things ahead.</p>`,
        },
      },
    ],
  },

  service_recovery: {
    piece: "service_recovery",
    name: "Owner Service-Recovery",
    pieceCode: "PS-RECOV",
    category: "recovery",
    recipient: "customer",
    color: true,
    // Recovery is relationship-only — NO offer/coupon block ever (validateRecoveryContent).
    defaultFooter: `PS-RECOV &middot; <em>We keep our customers by keeping our customers satisfied.</em> &middot; Job {{program.jobNumber}}`,
    variants: [
      {
        id: "A",
        label: "The Owner's Direct Line (PSG-308 approved master)",
        // Canonical: the approved W1 owner service-recovery master (PSG-308).
        useDefaultProduct: "service_recovery",
      },
      {
        id: "B",
        label: "Here's What Happens Next",
        blocks: {
          headline: "Your concern has my full attention.",
          body:
            `<p>As the owner of {{company.name}}, I want you to know your feedback reached the top. ` +
            `Here is what happens next: I will personally review your repair, and I will call you ` +
            `to listen and make things right.</p>` +
            `<p>If you would rather reach me first, my direct line is {{company.phone}}.</p>`,
          signoff: "Personally,",
        },
      },
    ],
  },
};

/** Every piece in the matrix, as an array (stable order = LetterPiece order). */
export const LETTER_DEFINITIONS: readonly LetterDefinition[] = Object.values(LETTER_MATRIX);

/** Look up a definition by piece (throws on an unknown piece — a wiring bug). */
export function definitionForPiece(piece: LetterPiece): LetterDefinition {
  const def = LETTER_MATRIX[piece];
  if (!def) throw new Error(`No letter definition registered for piece "${piece}"`);
  return def;
}

/** The per-variant piece code used as the anti-repeat / suppression dedup key. */
export function variantPieceCode(def: LetterDefinition, variantId: string): string {
  return `${def.pieceCode}:${variantId}`;
}
