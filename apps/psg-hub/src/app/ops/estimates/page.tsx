import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";

// Ops Estimates list (v1.1 / PSG-35, parent PSG-25). Read-only view onto the
// estimates spine table; gated by manage_companies like the rest of that side.

type EstimateRow = {
  id: string;
  estimate_number: string;
  company_id: string;
  repair_customer_id: string;
  created_at: string;
  companies: { name: string } | { name: string }[] | null;
  repair_customers:
    | { first_name: string; last_name: string }
    | { first_name: string; last_name: string }[]
    | null;
};

/** PostgREST may return an embedded relation as an object or a single-row array. */
function one<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function customerName(row: EstimateRow): string {
  const c = one(row.repair_customers);
  if (!c) return "—";
  return `${c.first_name} ${c.last_name}`.trim() || "—";
}

export default async function EstimatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  // Module-level gate: the /ops shell admits all staff, but Estimates needs the
  // manage_companies capability. Fail closed with an in-shell notice.
  if (!hasOpsFn(access, "manage_companies")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Estimates</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_companies</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data } = await service
    .from("estimates")
    .select(
      "id, estimate_number, company_id, repair_customer_id, created_at, companies(name), repair_customers(first_name, last_name)"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  const estimates = (data ?? []) as EstimateRow[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Estimates</h1>
        <p className="mt-1 text-sm text-muted-foreground">{estimates.length} on file</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Estimate #</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {estimates.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No estimates yet. Estimates sync from FileMaker during dual-entry.
                </td>
              </tr>
            ) : (
              estimates.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <a href={`/ops/estimates/${e.id}`} className="font-medium hover:text-ember">
                      {e.estimate_number}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {one(e.companies)?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{customerName(e)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
