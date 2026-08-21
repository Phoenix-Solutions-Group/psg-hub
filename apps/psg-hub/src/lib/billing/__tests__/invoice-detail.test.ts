import { describe, expect, it } from "vitest";
import { invoiceDocumentData, invoiceRemainingBalance } from "../invoice-detail";

describe("invoiceDocumentData", () => {
  it("extracts safe PDF-style financial detail", () => {
    expect(invoiceDocumentData({
      due_date: "2026-09-01T00:00:00.000Z",
      subtotal: 120000,
      tax: 6000,
      total: 126000,
      lines: [{ id: "il_1", description: "Marketing services", quantity: 2, unit_amount: 60000, amount: 120000 }],
    })).toEqual({
      dueDate: "2026-09-01T00:00:00.000Z",
      subtotal: 120000,
      tax: 6000,
      total: 126000,
      lines: [{ id: "il_1", description: "Marketing services", quantity: 2, unitAmount: 60000, amount: 120000 }],
    });
  });

  it("handles legacy invoices without inventing detail", () => {
    expect(invoiceDocumentData(null)).toEqual({
      dueDate: null, subtotal: null, tax: null, total: null, lines: [],
    });
  });
});

describe("invoiceRemainingBalance", () => {
  it("shows zero for paid and void invoices instead of the original invoice amount", () => {
    expect(invoiceRemainingBalance("paid", 250000, {})).toBe(0);
    expect(invoiceRemainingBalance("void", 75000, {})).toBe(0);
  });

  it("uses Stripe's remaining amount when it is present", () => {
    expect(
      invoiceRemainingBalance("open", 125000, { amount_remaining: 50000 })
    ).toBe(50000);
  });
});
