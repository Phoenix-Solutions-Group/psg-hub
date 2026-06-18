import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { resolveSort, type RepairCustomerSortColumn } from "@/lib/ops/repair";
import { NewRepairCustomerForm } from "@/components/ops/new-repair-customer-form";
import { RepairCustomerFilters } from "@/components/ops/repair-customer-filters";

type CustomerRow = {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
};

type CompanyOption = { id: string; name: string };

const COLUMN_LABELS: Record<RepairCustomerSortColumn, string> = {
  last_name: "Last name",
  first_name: "First name",
  created_at: "Created",
  updated_at: "Updated",
};

function NoAccess() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
      <h1 className="font-heading text-lg font-semibold">Repair Customers</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your security profile does not grant the <code>manage_companies</code> capability.
      </p>
    </div>
  );
}

type Props = {
  searchParams: Promise<{ q?: string; company_id?: string; sort?: string; dir?: string }>;
};

export default async function RepairCustomersPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_companies")) return <NoAccess />;

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const companyId = sp.company_id?.trim() ?? "";
  const { column, ascending } = resolveSort(sp.sort, sp.dir);

  const service = createServiceClient();

  let custQuery = service
    .from("repair_customers")
    .select("id, company_id, first_name, last_name, phone, email, created_at")
    .order(column, { ascending })
    .limit(200);
  if (companyId) custQuery = custQuery.eq("company_id", companyId);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    custQuery = custQuery.or(`last_name.ilike.%${safe}%,first_name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const [{ data: companyData }, { data: custData }] = await Promise.all([
    service.from("companies").select("id, name").order("name").limit(500),
    custQuery,
  ]);

  const companies = (companyData ?? []) as CompanyOption[];
  const companyNames = new Map(companies.map((c) => [c.id, c.name]));
  const customers = (custData ?? []) as CustomerRow[];

  // Sortable column-header link that toggles direction, preserving filters.
  function sortHref(col: RepairCustomerSortColumn) {
    const nextDir = column === col && ascending ? "desc" : "asc";
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (companyId) params.set("company_id", companyId);
    params.set("sort", col);
    params.set("dir", nextDir);
    return `/ops/repair-customers?${params.toString()}`;
  }

  function sortHeader(col: RepairCustomerSortColumn) {
    return (
      <a href={sortHref(col)} className="inline-flex items-center gap-1 hover:text-foreground">
        {COLUMN_LABELS[col]}
        {column === col ? <span>{ascending ? "▲" : "▼"}</span> : null}
      </a>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Repair Customers</h1>
        <p className="mt-1 text-sm text-muted-foreground">{customers.length} shown</p>
      </div>

      <NewRepairCustomerForm companies={companies} defaultCompanyId={companyId || undefined} />

      <RepairCustomerFilters companies={companies} q={q} companyId={companyId} />

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{sortHeader("last_name")}</th>
              <th className="px-4 py-3">{sortHeader("first_name")}</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">{sortHeader("created_at")}</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No repair customers match. Add one above.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <a href={`/ops/repair-customers/${c.id}`} className="font-medium hover:text-ember">
                      {c.last_name}
                    </a>
                  </td>
                  <td className="px-4 py-3">{c.first_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{companyNames.get(c.company_id) ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
