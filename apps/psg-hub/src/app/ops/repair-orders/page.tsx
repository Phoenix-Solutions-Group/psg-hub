import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  preview: "Preview",
  cancelled: "Cancelled",
  closed: "Closed",
};

type RORow = {
  id: string;
  ro_number: string;
  status: string;
  total_loss_flag: boolean;
  created_at: string;
  company_id: string;
  repair_customer_id: string;
  companies: { name: string } | { name: string }[] | null;
  repair_customers:
    | { first_name: string; last_name: string }
    | { first_name: string; last_name: string }[]
    | null;
};

function one<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

export default async function RepairOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ company_id?: string; status?: string }>;
}) {
  const { company_id, status } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_companies")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Repair Orders</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_companies</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  let query = service
    .from("repair_orders")
    .select(`
      id, ro_number, status, total_loss_flag, created_at, company_id, repair_customer_id,
      companies(name),
      repair_customers(first_name, last_name)
    `)
    .order("created_at", { ascending: false })
    .limit(200);

  if (company_id) query = query.eq("company_id", company_id);
  if (status) query = query.eq("status", status);

  const { data } = await query;
  const ros = (data ?? []) as unknown as RORow[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Repair Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ros.length} on file</p>
        </div>
        <div className="flex gap-2 text-sm">
          {["open", "preview", "cancelled", "closed"].map((s) => (
            <a
              key={s}
              href={`/ops/repair-orders?${company_id ? `company_id=${company_id}&` : ""}status=${s}`}
              className={`rounded-md border px-2.5 py-1 transition-colors ${
                status === s ? "border-ember bg-ember/10 text-ember" : "border-border hover:bg-accent/40"
              }`}
            >
              {STATUS_LABELS[s]}
            </a>
          ))}
          {status && (
            <a
              href={`/ops/repair-orders${company_id ? `?company_id=${company_id}` : ""}`}
              className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:bg-accent/40"
            >
              All
            </a>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">RO #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total Loss</th>
            </tr>
          </thead>
          <tbody>
            {ros.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No repair orders on file.
                </td>
              </tr>
            ) : (
              ros.map((ro) => {
                const cust = one(ro.repair_customers);
                const comp = one(ro.companies);
                return (
                  <tr key={ro.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <a href={`/ops/repair-customers/${ro.repair_customer_id}`} className="font-mono font-medium hover:text-ember">
                        {ro.ro_number}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {cust ? `${cust.last_name}, ${cust.first_name}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{comp?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${ro.status === "cancelled" ? "text-destructive" : ro.status === "closed" ? "text-muted-foreground" : ""}`}>
                        {STATUS_LABELS[ro.status] ?? ro.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{ro.total_loss_flag ? "Yes" : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
