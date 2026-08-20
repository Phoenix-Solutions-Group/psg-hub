import { describe, expect, it } from "vitest";
import { invoiceDocumentData } from "../invoice-detail";

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
