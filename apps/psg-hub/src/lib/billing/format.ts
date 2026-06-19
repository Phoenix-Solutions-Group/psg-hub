// PSG-59 — presentation helpers for the Stripe-native invoice list + detail views.
// Stripe statuses (no "past_due" at the invoice level — that is a subscription state).

/** Integer minor units → localized currency string, e.g. 12345 → "$123.45". */
export function formatAmount(amount: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format((amount ?? 0) / 100);
}

/** ISO timestamp → "Mon D, YYYY", or "—" when absent. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Human label for a Stripe invoice status. */
export function statusLabel(status: string): string {
  switch (status) {
    case "uncollectible":
      return "Uncollectible";
    case "void":
      return "Void";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/** Map a Stripe invoice status onto a Badge variant. */
export function statusBadgeVariant(
  status: string
): "success" | "warning" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "paid":
      return "success";
    case "open":
      return "warning";
    case "uncollectible":
      return "destructive";
    case "void":
      return "secondary";
    default:
      return "outline";
  }
}

/** True when the invoice can still be paid via its Stripe-hosted page. */
export function isPayable(status: string): boolean {
  return status === "open" || status === "uncollectible";
}
