import { describe, it, expect } from "vitest";
import {
  renderMergeFields,
  renderMailContent,
  buildMailDocument,
  defaultTemplate,
  DEFAULT_TEMPLATES,
  type MailMergeData,
  type MailTemplate,
} from "@/lib/production/templates";
import type { MailAddress } from "@/lib/production/types";

const DATA: MailMergeData = {
  customer: {
    firstName: "Jane",
    lastName: "Doe",
    vehicle: "2021 Honda Accord",
    serviceDate: "2026-06-01",
  },
  company: {
    name: "Ace Body Shop",
    phone: "555-0100",
    email: "hi@acebody.com",
    websiteUrl: "https://acebody.com",
    city: "Austin",
    state: "TX",
  },
  program: {
    greeting: "We appreciate your business!",
    footer: "Licensed & insured.",
  },
};

const TO: MailAddress = {
  name: "Jane Doe",
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
};
const FROM: MailAddress = {
  name: "Ace Body Shop",
  addressLine1: "9 Shop Rd",
  city: "Austin",
  state: "TX",
  zip: "78702",
};

describe("renderMergeFields", () => {
  it("substitutes dotted-path tokens with their values", () => {
    const { html } = renderMergeFields(
      "Hi {{customer.firstName}} from {{company.name}}",
      DATA
    );
    expect(html).toBe("Hi Jane from Ace Body Shop");
  });

  it("tolerates whitespace inside the braces", () => {
    const { html } = renderMergeFields("{{  company.name  }}", DATA);
    expect(html).toBe("Ace Body Shop");
  });

  it("synthesises customer.fullName from first + last when absent", () => {
    const { html } = renderMergeFields("{{customer.fullName}}", DATA);
    expect(html).toBe("Jane Doe");
  });

  it("prefers an explicit fullName over the synthesised one", () => {
    const { html } = renderMergeFields("{{customer.fullName}}", {
      ...DATA,
      customer: { ...DATA.customer, fullName: "J. Doe Jr." },
    });
    expect(html).toBe("J. Doe Jr.");
  });

  it("HTML-escapes substituted values to prevent injection", () => {
    const { html } = renderMergeFields("{{company.name}}", {
      ...DATA,
      company: { ...DATA.company, name: `<script>alert("x")</script>` },
    });
    expect(html).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("collapses missing tokens to empty string and reports them once", () => {
    const { html, missing } = renderMergeFields(
      "A{{customer.middleName}}B{{customer.middleName}}C{{program.logo}}",
      DATA
    );
    expect(html).toBe("ABC");
    expect(missing).toEqual(["customer.middleName", "program.logo"]);
  });

  it("treats an empty-string value as missing", () => {
    const { html, missing } = renderMergeFields("{{program.header}}", {
      ...DATA,
      program: { ...DATA.program, header: "" },
    });
    expect(html).toBe("");
    expect(missing).toEqual(["program.header"]);
  });

  it("does not resolve object leaves", () => {
    const { missing } = renderMergeFields("{{customer}}", DATA);
    expect(missing).toEqual(["customer"]);
  });
});

describe("renderMailContent", () => {
  it("renders front + back for a postcard and no file", () => {
    const tpl: MailTemplate = {
      product: "thank_you",
      pieceType: "postcard",
      frontHtml: "front {{customer.firstName}}",
      backHtml: "back {{company.name}}",
    };
    const out = renderMailContent(tpl, DATA);
    expect(out.front).toBe("front Jane");
    expect(out.back).toBe("back Ace Body Shop");
    expect(out.file).toBeUndefined();
    expect(out.missing).toEqual([]);
  });

  it("renders only file for a letter", () => {
    const tpl: MailTemplate = {
      product: "warranty",
      pieceType: "letter",
      bodyHtml: "Dear {{customer.firstName}}",
    };
    const out = renderMailContent(tpl, DATA);
    expect(out.file).toBe("Dear Jane");
    expect(out.front).toBeUndefined();
    expect(out.back).toBeUndefined();
  });

  it("aggregates and dedupes missing tokens across surfaces", () => {
    const tpl: MailTemplate = {
      product: "thank_you",
      pieceType: "postcard",
      frontHtml: "{{program.logo}}",
      backHtml: "{{program.logo}} {{customer.middleName}}",
    };
    const out = renderMailContent(tpl, DATA);
    expect(out.missing).toEqual(["program.logo", "customer.middleName"]);
  });
});

describe("buildMailDocument", () => {
  it("wires front/back/size for a postcard", () => {
    const { document, missing } = buildMailDocument({
      template: {
        product: "thank_you",
        pieceType: "postcard",
        size: "4x6",
        frontHtml: "front {{customer.firstName}}",
        backHtml: "back",
      },
      data: DATA,
      documentId: "doc-1",
      to: TO,
      from: FROM,
      description: "Thank-you card",
      metadata: { batch: "b1" },
    });
    expect(document.pieceType).toBe("postcard");
    expect(document.front).toBe("front Jane");
    expect(document.back).toBe("back");
    expect(document.size).toBe("4x6");
    expect(document.file).toBeUndefined();
    expect(document.documentId).toBe("doc-1");
    expect(document.metadata).toEqual({ batch: "b1" });
    expect(missing).toEqual([]);
  });

  it("wires file/color for a letter and defaults color to false", () => {
    const { document } = buildMailDocument({
      template: {
        product: "warranty",
        pieceType: "letter",
        bodyHtml: "Dear {{customer.firstName}}",
      },
      data: DATA,
      documentId: "doc-2",
      to: TO,
      from: FROM,
    });
    expect(document.file).toBe("Dear Jane");
    expect(document.color).toBe(false);
    expect(document.front).toBeUndefined();
  });

  it("surfaces unresolved tokens so the caller can block an incomplete piece", () => {
    const { missing } = buildMailDocument({
      template: {
        product: "thank_you",
        pieceType: "postcard",
        frontHtml: "{{program.logo}}",
      },
      data: DATA,
      documentId: "doc-3",
      to: TO,
      from: FROM,
    });
    expect(missing).toEqual(["program.logo"]);
  });
});

describe("default templates", () => {
  it("exposes a default for every product", () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([
      "envelope",
      "service_recovery",
      "thank_you",
      "warranty",
    ]);
  });

  it("thank_you default is the faithful US-Letter (W1 master, color)", () => {
    const tpl = defaultTemplate("thank_you");
    expect(tpl.pieceType).toBe("letter");
    expect(tpl.color).toBe(true);
    // Block-decomposed faithful letter: shop masthead, the ACRB survey P.S.,
    // the warranty variant block, and the tri-part footer.
    expect(tpl.bodyHtml).toContain("block:masthead");
    expect(tpl.bodyHtml).toContain("block:survey-cta");
    expect(tpl.bodyHtml).toContain("{{#if program.hasWarranty}}");
    expect(tpl.bodyHtml).toContain("{{customer.surveySecurityCode}}");
    expect(tpl.bodyHtml).toContain("{{program.pieceCode}}");
  });

  it("service_recovery default is the austere owner letter (W1 master)", () => {
    const tpl = defaultTemplate("service_recovery");
    expect(tpl.pieceType).toBe("letter");
    expect(tpl.color).toBe(true);
    expect(tpl.bodyHtml).toContain("call me directly");
    expect(tpl.bodyHtml).toContain("{{program.ownerDirectLine}}");
    // No survey ask on the recovery piece — its one job is the owner phone call.
    expect(tpl.bodyHtml).not.toContain("block:survey-cta");
  });

  it("warranty default is a letter referencing the service date", () => {
    const tpl = defaultTemplate("warranty");
    expect(tpl.pieceType).toBe("letter");
    expect(tpl.bodyHtml).toContain("{{customer.serviceDate}}");
  });

  it("renders a complete, self-contained thank_you letter from the default + real data", () => {
    const { document } = buildMailDocument({
      template: defaultTemplate("thank_you"),
      data: DATA,
      documentId: "doc-default",
      to: TO,
      from: FROM,
    });
    // Letters carry a single `file`, not front/back.
    expect(document.front).toBeUndefined();
    expect(document.file).toContain("<!doctype html>");
    expect(document.file).toContain("Ace Body Shop");
    expect(document.file).toContain("Jane");
  });

  it("escapes merged values inside the default template HTML", () => {
    const { document } = buildMailDocument({
      template: defaultTemplate("thank_you"),
      data: {
        ...DATA,
        company: { ...DATA.company, name: "Bob & Sons <Auto>" },
      },
      documentId: "doc-escape",
      to: TO,
      from: FROM,
    });
    expect(document.file).toContain("Bob &amp; Sons &lt;Auto&gt;");
  });
});
