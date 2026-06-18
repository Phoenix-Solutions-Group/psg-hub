import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  formatAmount,
  formatDate,
  statusLabel,
  statusBadgeVariant,
  isPayable,
} from "@/lib/billing/format";

/**
 * PSG-59 — Stripe-native invoice detail. RLS-clamped read (invoices_select); the
 * pay CTA opens the Stripe hosted-invoice page. Payment attempts are read from the
 * mirrored `payments` rows (brand + last4 only; never PAN).
 */
type Props = { params: Promise<{ shopId: string; id: string }> };

type InvoiceRow = {
  stripe_invoice_id: string;
  number: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  period_start: string | null;
  period_end: string | null;
  created: string | null;
};

type PaymentRow = {
  stripe_payment_intent_id: string;
  status: string;
  amount: number;
  amount_received: number;
  currency: string;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  created_at: string;
};

export default async function ShopInvoiceDetailPage({ params }: Props) {
  const { shopId, id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from("shop_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!membership) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "stripe_invoice_id, number, status, amount_due, amount_paid, currency, hosted_invoice_url, invoice_pdf, period_start, period_end, created"
    )
    .eq("shop_id", shopId)
    .eq("stripe_invoice_id", id)
    .maybeSingle<InvoiceRow>();

  if (!invoice) notFound();

  const { data: paymentRows } = await supabase
    .from("payments")
    .select(
      "stripe_payment_intent_id, status, amount, amount_received, currency, payment_method_brand, payment_method_last4, created_at"
    )
    .eq("shop_id", shopId)
    .eq("stripe_invoice_id", id)
    .order("created_at", { ascending: false });

  const payments = (paymentRows ?? []) as PaymentRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/dashboard/shop/${shopId}/invoices`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Invoices
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Invoice {invoice.number ?? invoice.stripe_invoice_id}
          </h1>
          <p className="text-muted-foreground">
            {formatDate(invoice.created)}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(invoice.status)}>
          {statusLabel(invoice.status)}
        </Badge>
      </div>

      <div className="grid gap-4 rounded-lg border border-border bg-card p-6 sm:grid-cols-2">
        <Field label="Amount due">
          {formatAmount(invoice.amount_due, invoice.currency)}
        </Field>
        <Field label="Amount paid">
          {formatAmount(invoice.amount_paid, invoice.currency)}
        </Field>
        <Field label="Billing period">
          {invoice.period_start || invoice.period_end
            ? `${formatDate(invoice.period_start)} – ${formatDate(
                invoice.period_end
              )}`
            : "—"}
        </Field>
        <Field label="Invoice ID">
          <span className="font-mono text-xs">{invoice.stripe_invoice_id}</span>
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        {isPayable(invoice.status) && invoice.hosted_invoice_url && (
          <a
            href={invoice.hosted_invoice_url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Pay invoice
          </a>
        )}
        {invoice.hosted_invoice_url && (
          <a
            href={invoice.hosted_invoice_url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            View on Stripe
          </a>
        )}
        {invoice.invoice_pdf && (
          <a
            href={invoice.invoice_pdf}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            Download PDF
          </a>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold tracking-tight">Payments</h2>
        {payments.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No payment attempts recorded yet.
          </div>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.stripe_payment_intent_id}>
                    <TableCell>{formatDate(p.created_at)}</TableCell>
                    <TableCell>
                      {p.payment_method_brand && p.payment_method_last4
                        ? `${p.payment_method_brand} •••• ${p.payment_method_last4}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.status === "succeeded" ? "success" : "outline"
                        }
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(p.amount_received || p.amount, p.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium">{children}</div>
    </div>
  );
}
