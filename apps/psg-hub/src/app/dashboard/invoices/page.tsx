import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveShopContext } from "@/lib/shop/context";
import { Badge } from "@/components/ui/badge";
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
} from "@/lib/invoiced/format";

/**
 * Invoice list (v0.4). Scoped to the ACTIVE shop (switcher), RLS-clamped via invoices_select.
 * Mirrors the reviews page shape: server component, active-shop context, read-only table.
 */
export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { activeShopId } = user
    ? await getActiveShopContext(user.id)
    : { activeShopId: null as string | null };

  const { data: invoices } = activeShopId
    ? await supabase
        .from("invoices")
        .select(
          "id, number, customer_name, amount_cents, currency, status, due_date"
        )
        .eq("shop_id", activeShopId)
        .order("due_date", { ascending: false, nullsFirst: false })
        .limit(200)
    : { data: [] };

  const rows = invoices ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="text-muted-foreground">
          View and pay your PSG invoices.
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
                <TableHead>Customer</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">
                    {inv.number ?? inv.id.slice(0, 8)}
                  </TableCell>
                  <TableCell>{inv.customer_name ?? "—"}</TableCell>
                  <TableCell>{formatDate(inv.due_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(inv.amount_cents, inv.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(inv.status)}>
                      {statusLabel(inv.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/invoices/${inv.id}`}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      View
                    </Link>
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
