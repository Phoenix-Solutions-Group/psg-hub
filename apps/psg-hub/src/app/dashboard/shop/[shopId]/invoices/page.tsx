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
 * PSG-59 — Stripe-native invoice list, scoped to a shop via the path param.
 * Server component; the read is RLS-clamped (invoices_select: shop_id IN
 * user_shop_ids()), so a shop the user does not belong to returns no rows — we
 * confirm membership explicitly and 404 otherwise. The pay CTA is the Stripe
 * hosted-invoice URL (no in-app charge route).
 */
type Props = { params: Promise<{ shopId: string }> };

type InvoiceListRow = {
  stripe_invoice_id: string;
  number: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  hosted_invoice_url: string | null;
  created: string | null;
};

export default async function ShopInvoicesPage({ params }: Props) {
  const { shopId } = await params;
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

  const { data } = await supabase
    .from("invoices")
    .select(
      "stripe_invoice_id, number, status, amount_due, amount_paid, currency, hosted_invoice_url, created"
    )
    .eq("shop_id", shopId)
    .order("created", { ascending: false, nullsFirst: false })
    .limit(200);

  const rows = (data ?? []) as InvoiceListRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground">
          View and pay your PSG invoices. Payments are processed securely by
          Stripe.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No invoices yet.
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((inv) => (
                <TableRow key={inv.stripe_invoice_id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/shop/${shopId}/invoices/${inv.stripe_invoice_id}`}
                      className="hover:underline"
                    >
                      {inv.number ?? inv.stripe_invoice_id}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(inv.created)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(inv.status)}>
                      {statusLabel(inv.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(inv.amount_due, inv.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {isPayable(inv.status) && inv.hosted_invoice_url ? (
                      <a
                        href={inv.hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ size: "sm" })}
                      >
                        Pay
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
