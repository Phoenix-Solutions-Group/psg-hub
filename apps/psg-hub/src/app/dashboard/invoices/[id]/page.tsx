import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatAmount,
  formatDate,
  statusLabel,
  statusBadgeVariant,
} from "@/lib/invoiced/format";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
};

/**
 * Invoice detail (v0.4): summary + status, PDF viewer, and the pay CTA.
 * RLS-clamped read (invoices_select) — a non-member gets no row -> notFound (IDOR-safe).
 * The pay CTA POSTs to the shop-scoped pay route, which mints a Stripe payment link.
 */
export default async function InvoiceDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { paid: paidFlag } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, shop_id, number, customer_name, amount_cents, currency, status, due_date, paid_at, pdf_url"
    )
    .eq("id", id)
    .maybeSingle();

  if (!invoice) notFound();

  const isPaid = invoice.status === "paid";
  const isPayable =
    !isPaid &&
    invoice.amount_cents > 0 &&
    invoice.status !== "void" &&
    invoice.status !== "uncollectible";
  const justPaid = paidFlag === "true";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/invoices"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Invoices
        </Link>
      </div>

      {(justPaid || isPaid) && (
        <div className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-sm text-foreground">
          {justPaid
            ? "Thank you — your payment is being confirmed and will appear here shortly."
            : `Paid${invoice.paid_at ? ` on ${formatDate(invoice.paid_at)}` : ""}.`}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Invoice {invoice.number ?? invoice.id.slice(0, 8)}
          </h1>
          <p className="text-muted-foreground">
            {invoice.customer_name ?? "—"}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(invoice.status)}>
          {statusLabel(invoice.status)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-5 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Amount
          </dt>
          <dd className="mt-1 text-lg font-medium tabular-nums">
            {formatAmount(invoice.amount_cents, invoice.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Due
          </dt>
          <dd className="mt-1 text-lg font-medium">
            {formatDate(invoice.due_date)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Status
          </dt>
          <dd className="mt-1 text-lg font-medium">
            {statusLabel(invoice.status)}
          </dd>
        </div>
      </dl>

      {isPayable && (
        <form
          action={`/api/shops/${invoice.shop_id}/invoices/${invoice.id}/pay`}
          method="post"
        >
          <Button type="submit">Pay invoice</Button>
        </form>
      )}

      {invoice.pdf_url ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-sm font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Invoice PDF
            </h2>
            <a
              href={invoice.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Open in new tab
            </a>
          </div>
          <iframe
            src={invoice.pdf_url}
            title={`Invoice ${invoice.number ?? invoice.id}`}
            className="h-[800px] w-full rounded-md border border-border"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          A PDF for this invoice is not available yet.
        </p>
      )}
    </div>
  );
}
