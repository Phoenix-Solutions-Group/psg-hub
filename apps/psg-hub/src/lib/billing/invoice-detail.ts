export type InvoiceLineItem = {
  id: string;
  description: string;
  quantity: number | null;
  unitAmount: number | null;
  amount: number;
};

type RawLine = {
  id?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit_amount?: unknown;
  amount?: unknown;
};

export type InvoiceDocumentData = {
  dueDate: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lines: InvoiceLineItem[];
};

export function invoiceRemainingBalance(
  status: string,
  amountDue: number,
  raw: unknown
): number {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawRemaining = finiteNumber(value.amount_remaining);

  if (rawRemaining != null) return Math.max(0, rawRemaining);
  if (status === "paid" || status === "void") return 0;
  return Math.max(0, amountDue);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function invoiceDocumentData(raw: unknown): InvoiceDocumentData {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawLines = Array.isArray(value.lines) ? value.lines as RawLine[] : [];

  return {
    dueDate: typeof value.due_date === "string" ? value.due_date : null,
    subtotal: finiteNumber(value.subtotal),
    tax: finiteNumber(value.tax),
    total: finiteNumber(value.total),
    lines: rawLines.map((line, index) => ({
      id: typeof line.id === "string" ? line.id : `line-${index}`,
      description:
        typeof line.description === "string" && line.description.trim()
          ? line.description
          : "Invoice item",
      quantity: finiteNumber(line.quantity),
      unitAmount: finiteNumber(line.unit_amount),
      amount: finiteNumber(line.amount) ?? 0,
    })),
  };
}
