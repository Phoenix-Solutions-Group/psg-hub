import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifyInvoicedSignature,
  mapInvoicedStatus,
  mapInvoicedInvoice,
  extractInvoiceObject,
  toCents,
} from "@/lib/invoiced/webhook";

const SECRET = "whsec_test";
function sign(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyInvoicedSignature", () => {
  it("accepts a correct HMAC-SHA256 hex digest", () => {
    const body = JSON.stringify({ id: "event_1" });
    expect(verifyInvoicedSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts a sha256=-prefixed digest", () => {
    const body = JSON.stringify({ id: "event_1" });
    expect(verifyInvoicedSignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    const body = JSON.stringify({ id: "event_1" });
    expect(verifyInvoicedSignature(body, sign("tampered"), SECRET)).toBe(false);
  });

  it("rejects a missing signature or secret", () => {
    expect(verifyInvoicedSignature("{}", null, SECRET)).toBe(false);
    expect(verifyInvoicedSignature("{}", sign("{}"), "")).toBe(false);
  });

  it("rejects a non-hex / wrong-length signature without throwing", () => {
    expect(verifyInvoicedSignature("{}", "not-hex!!", SECRET)).toBe(false);
  });
});

describe("mapInvoicedStatus", () => {
  it("maps paid flag to paid regardless of status", () => {
    expect(mapInvoicedStatus({ status: "sent", paid: true })).toBe("paid");
  });
  it("maps unpaid invoiced statuses into our domain", () => {
    expect(mapInvoicedStatus({ status: "not_sent" })).toBe("draft");
    expect(mapInvoicedStatus({ status: "sent" })).toBe("open");
    expect(mapInvoicedStatus({ status: "viewed" })).toBe("open");
    expect(mapInvoicedStatus({ status: "past_due" })).toBe("past_due");
    expect(mapInvoicedStatus({ status: "voided" })).toBe("void");
    expect(mapInvoicedStatus({ status: "bad_debt" })).toBe("uncollectible");
  });
  it("defaults unknown statuses to open", () => {
    expect(mapInvoicedStatus({ status: "weird" })).toBe("open");
  });
});

describe("toCents", () => {
  it("converts dollars to integer cents without float drift", () => {
    expect(toCents(123.45)).toBe(12345);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30
    expect(toCents("99.99")).toBe(9999);
    expect(toCents(undefined)).toBe(0);
  });
});

describe("extractInvoiceObject", () => {
  it("pulls the invoice out of an event envelope", () => {
    const inv = { id: 7, total: 10 };
    expect(extractInvoiceObject({ id: "event_1", type: "invoice.created", object: inv })).toBe(inv);
  });
  it("accepts a bare invoice", () => {
    const bare = { id: 7, total: 10 };
    expect(extractInvoiceObject(bare)).toBe(bare);
  });
  it("returns null for a non-invoice payload", () => {
    expect(extractInvoiceObject({ id: "event_1", type: "customer.created" })).toBeNull();
  });
});

describe("mapInvoicedInvoice", () => {
  it("maps an invoiced invoice to an invoices row", () => {
    const row = mapInvoicedInvoice({
      id: 42,
      number: "INV-0042",
      total: 250,
      currency: "USD",
      status: "sent",
      due_date: 1735689600,
      customer: { id: 9, name: "Wallace Collision" },
      pdf_url: "https://invoiced.example/inv/42.pdf",
    });
    expect(row).toMatchObject({
      external_id: "42",
      number: "INV-0042",
      customer_name: "Wallace Collision",
      amount_cents: 25000,
      currency: "usd",
      status: "open",
      pdf_url: "https://invoiced.example/inv/42.pdf",
    });
    expect(row?.due_date).toBe("2025-01-01");
  });

  it("sets paid_at when paid", () => {
    const row = mapInvoicedInvoice({ id: 1, total: 10, paid: true, updated_at: 1735689600 });
    expect(row?.status).toBe("paid");
    expect(row?.paid_at).toBe(new Date(1735689600 * 1000).toISOString());
  });

  it("returns null without an id", () => {
    expect(mapInvoicedInvoice({ total: 10 })).toBeNull();
  });
});
