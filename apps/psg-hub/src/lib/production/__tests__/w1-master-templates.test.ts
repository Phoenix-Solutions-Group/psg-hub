/**
 * W1 master templates — productionization acceptance (PSG-115a / PSG-308).
 *
 * The two proof-gate-approved (A / A) W1 masters, authored into the print
 * pipeline as block-decomposed letters (PSG-219 design system → PSG-218
 * variability model):
 *
 *   Piece 1 — Thank-You + ACRB survey, Direction A "Faithful Letter".
 *   Piece 2 — Owner service-recovery, Direction A "The Owner's Direct Line".
 *
 * These tests are the §6 acceptance evidence: each master renders through the
 * REAL engine (`renderMailContent` / `buildMailDocument`) on the spec's sample
 * shop ("ABC Auto Body" / owner Steve Smith) with ZERO unresolved tokens,
 * exercises the per-shop skin (`program.*` ← customizations_jsonb), and proves
 * the documented variability (warranty variant block, logo + owner-signature
 * fallbacks) behaves per PSG-219 §1.4 / §3.
 */

import { describe, it, expect } from "vitest";
import {
  buildMailDocument,
  defaultTemplate,
  renderMailContent,
  type MailMergeData,
} from "@/lib/production/templates";
import type { MailAddress } from "@/lib/production/types";

/** Sample shop / owner from the spec, with every W1 skin + per-recipient field. */
const ABC: MailMergeData = {
  customer: {
    firstName: "Dana",
    lastName: "Whitfield",
    vehicle: "2022 Toyota Camry",
    vehicleShort: "Camry",
    serviceDate: "2026-06-10",
    letterDate: "June 2026",
    addressLine1: "118 Maple Avenue",
    city: "Springfield",
    state: "IL",
    zip: "62704",
    surveySecurityCode: "ABC-7731",
    surveyId: "SID-44120",
    roNumber: "RO-55120",
  },
  company: {
    name: "ABC Auto Body",
    phone: "(217) 555-0140",
    email: "service@abcautobody.example",
    websiteUrl: "abcautobody.example",
    city: "Springfield",
    state: "IL",
  },
  program: {
    logo: "https://cdn.example/abc-auto-body.png",
    addressLine1: "2300 N. Barrington Rd",
    addressLine2: "Springfield, IL 62704",
    ownerName: "Steve Smith",
    ownerFirstName: "Steve",
    ownerTitle: "Owner",
    ownerSignatureUrl: "https://cdn.example/steve-smith-sig.png",
    ownerDirectLine: "(217) 555-0199",
    surveyUrl: "www.theacrb.com",
    tagline: "We keep our customers by keeping our customers satisfied",
    pieceCode: "PS682",
    jobNumber: "5512.07",
    hasWarranty: "true",
  },
};

const TO: MailAddress = {
  name: "Dana Whitfield",
  addressLine1: "118 Maple Avenue",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};
const FROM: MailAddress = {
  name: "ABC Auto Body",
  addressLine1: "2300 N. Barrington Rd",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

describe("W1 Piece 1 — Thank-You + ACRB survey (Faithful Letter)", () => {
  it("renders clean (zero unresolved tokens) on the ABC Auto Body sample", () => {
    const out = renderMailContent(defaultTemplate("thank_you"), ABC);
    expect(out.missing).toEqual([]);
    expect(out.file).toBeDefined();
    expect(out.file).not.toContain("{{");
  });

  it("is a print-valid, self-contained US-Letter that leads with shop identity", () => {
    const file = renderMailContent(defaultTemplate("thank_you"), ABC).file!;
    expect(file).toContain("<!doctype html>");
    expect(file).toContain("@page { size: 8.5in 11in;");
    expect(file).toContain("print-color-adjust: exact");
    // Shop, never PSG.
    expect(file).toContain("ABC Auto Body");
    expect(file).not.toContain("Phoenix Solutions Group");
  });

  it("carries the personal owner thank-you, ACRB survey P.S., and tri-part footer", () => {
    const file = renderMailContent(defaultTemplate("thank_you"), ABC).file!;
    expect(file).toContain("Please accept my personal thanks");
    expect(file).toContain("Dear Dana,");
    expect(file).toContain("Automotive Customer Relations Bureau");
    expect(file).toContain("www.theacrb.com");
    expect(file).toContain("ABC-7731"); // online security code
    expect(file).toContain("SID-44120"); // survey id
    // Tri-part footer: piece code · tagline · per-recipient RO# (PSG-321).
    expect(file).toContain("PS682");
    expect(file).toContain("We keep our customers by keeping our customers satisfied");
    expect(file).toContain("RO-55120"); // recipient RO# wins the footer job slot
  });

  it("binds the footer job slot to the recipient RO#, falling back to the shop job number (PSG-321)", () => {
    // Recipient with an RO#: the footer shows their own repair-order number.
    const withRo = renderMailContent(defaultTemplate("thank_you"), ABC);
    expect(withRo.file).toContain('<span class="job">RO-55120</span>');
    expect(withRo.file).not.toContain("5512.07"); // shop job number suppressed
    expect(withRo.missing).toEqual([]);

    // Recipient with no RO#: fall back to the shop-level job number, no leftover tokens.
    const noRo = renderMailContent(defaultTemplate("thank_you"), {
      ...ABC,
      customer: { ...ABC.customer, roNumber: undefined },
    });
    expect(noRo.file).toContain('<span class="job">5512.07</span>');
    expect(noRo.file).not.toContain("RO-55120");
    expect(noRo.missing).toEqual([]);
  });

  it("shows the warranty variant block only when the shop offers a written warranty", () => {
    const withWarranty = renderMailContent(defaultTemplate("thank_you"), ABC).file!;
    expect(withWarranty).toContain("comprehensive warranty");

    const noWarranty = renderMailContent(defaultTemplate("thank_you"), {
      ...ABC,
      program: { ...ABC.program, hasWarranty: undefined },
    });
    expect(noWarranty.file).not.toContain("comprehensive warranty");
    // Hiding an optional block leaves no unresolved tokens.
    expect(noWarranty.missing).toEqual([]);
  });

  it("uses the shop logo when present and the typeset name fallback when absent (§1.4)", () => {
    const withLogo = renderMailContent(defaultTemplate("thank_you"), ABC).file!;
    expect(withLogo).toContain("https://cdn.example/abc-auto-body.png");

    const noLogo = renderMailContent(defaultTemplate("thank_you"), {
      ...ABC,
      program: { ...ABC.program, logo: undefined },
    });
    expect(noLogo.file).toContain('<div class="name">ABC Auto Body</div>');
    expect(noLogo.missing).toEqual([]);
  });

  it("uses the owner hand-signature when present and the typeset fallback when absent (§1.4)", () => {
    const signed = renderMailContent(defaultTemplate("thank_you"), ABC).file!;
    expect(signed).toContain("https://cdn.example/steve-smith-sig.png");

    const noSig = renderMailContent(defaultTemplate("thank_you"), {
      ...ABC,
      program: { ...ABC.program, ownerSignatureUrl: undefined },
    });
    expect(noSig.file).toContain('<div class="sig-fallback">Steve Smith</div>');
    expect(noSig.missing).toEqual([]);
  });

  it("flows through buildMailDocument as a single-asset letter", () => {
    const { document, missing } = buildMailDocument({
      template: defaultTemplate("thank_you"),
      data: ABC,
      documentId: "doc-thank-you",
      to: TO,
      from: FROM,
    });
    expect(document.pieceType).toBe("letter");
    expect(document.color).toBe(true);
    expect(document.front).toBeUndefined();
    expect(document.file).toContain("ABC Auto Body");
    expect(missing).toEqual([]);
  });

  it("HTML-escapes merged values (no injection through the skin)", () => {
    const out = renderMailContent(defaultTemplate("thank_you"), {
      ...ABC,
      program: { ...ABC.program, logo: undefined },
      company: { ...ABC.company, name: "A&B <Body> \"Shop\"" },
    });
    expect(out.file).toContain("A&amp;B &lt;Body&gt; &quot;Shop&quot;");
    expect(out.file).not.toContain("<Body>");
  });
});

describe("W1 Piece 2 — Owner service-recovery (The Owner's Direct Line)", () => {
  it("renders clean (zero unresolved tokens) on the ABC Auto Body sample", () => {
    const out = renderMailContent(defaultTemplate("service_recovery"), ABC);
    expect(out.missing).toEqual([]);
    expect(out.file).toBeDefined();
    expect(out.file).not.toContain("{{");
  });

  it("is an austere, sincere owner letter whose one job is the direct phone call", () => {
    const file = renderMailContent(defaultTemplate("service_recovery"), ABC).file!;
    expect(file).toContain("I am writing to you personally");
    expect(file).toContain("did not fully meet your expectations");
    expect(file).toContain("call me directly at (217) 555-0199");
    expect(file).toContain("Direct line: (217) 555-0199");
    expect(file).toContain("Personally,");
    expect(file).toContain("Steve Smith");
    // Zero marketing gloss: no survey ask, no promo.
    expect(file).not.toContain("Automotive Customer Relations Bureau");
    expect(file).not.toContain("www.theacrb.com");
  });

  it("reaffirms the guarantee only when the shop offers a written warranty", () => {
    const withWarranty = renderMailContent(defaultTemplate("service_recovery"), ABC).file!;
    expect(withWarranty).toContain("written workmanship warranty");

    const noWarranty = renderMailContent(defaultTemplate("service_recovery"), {
      ...ABC,
      program: { ...ABC.program, hasWarranty: undefined },
    });
    expect(noWarranty.file).not.toContain("written workmanship warranty");
    expect(noWarranty.missing).toEqual([]);
  });

  it("binds the footer job slot to the recipient RO#, falling back to the shop job number (PSG-321)", () => {
    const withRo = renderMailContent(defaultTemplate("service_recovery"), ABC);
    expect(withRo.file).toContain('<span class="job">RO-55120</span>');
    expect(withRo.file).not.toContain("5512.07");
    expect(withRo.missing).toEqual([]);

    const noRo = renderMailContent(defaultTemplate("service_recovery"), {
      ...ABC,
      customer: { ...ABC.customer, roNumber: undefined },
    });
    expect(noRo.file).toContain('<span class="job">5512.07</span>');
    expect(noRo.file).not.toContain("RO-55120");
    expect(noRo.missing).toEqual([]);
  });

  it("flows through buildMailDocument as a single-asset color letter", () => {
    const { document, missing } = buildMailDocument({
      template: defaultTemplate("service_recovery"),
      data: ABC,
      documentId: "doc-recovery",
      to: TO,
      from: FROM,
    });
    expect(document.pieceType).toBe("letter");
    expect(document.color).toBe(true);
    expect(document.file).toContain("ABC Auto Body");
    expect(missing).toEqual([]);
  });
});
