/** Presentation helpers for invoices (shared by the list + detail views). */

export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "past_due"
  | "void"
  | "uncollectible";

/** Integer cents -> localized currency string, e.g. 12345 -> "$123.45". */
export function formatAmount(amountCents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format((amountCents ?? 0) / 100);
}

/** YYYY-MM-DD (or ISO) -> "Mon D, YYYY", or "—" when absent. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // Parse as UTC noon to avoid timezone day-shift on date-only strings.
  const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Human label for a status. */
export function statusLabel(status: string): string {
  switch (status) {
    case "past_due":
      return "Past due";
    case "uncollectible":
      return "Uncollectible";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/** Map an invoice status onto a Badge variant. */
export function statusBadgeVariant(
  status: string
): "success" | "warning" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "paid":
      return "success";
    case "open":
      return "warning";
    case "past_due":
    case "uncollectible":
      return "destructive";
    case "void":
      return "secondary";
    default:
      return "outline";
  }
}
