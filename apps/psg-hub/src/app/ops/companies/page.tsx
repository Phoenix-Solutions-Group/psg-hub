import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { NewCompanyForm } from "@/components/ops/new-company-form";

type CompanyRow = {
  id: string;
  name: string;
  phone: string | null;
  contact: string | null;
  status: string;
};

export default async function CompaniesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  // Module-level gate: the /ops shell admits all staff, but Companies needs the
  // manage_companies capability. Fail closed with an in-shell notice.
  if (!hasOpsFn(access, "manage_companies")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Companies</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_companies</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data } = await service
    .from("companies")
    .select("id, name, phone, contact, status")
    .order("name", { ascending: true })
    .limit(200);
  const companies = (data ?? []) as CompanyRow[];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="mt-1 text-sm text-muted-foreground">{companies.length} on file</p>
        </div>
      </div>

      <NewCompanyForm />

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No companies yet. Add the first one above.
                </td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <a href={`/ops/companies/${c.id}`} className="font-medium hover:text-ember">
                      {c.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.contact ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
