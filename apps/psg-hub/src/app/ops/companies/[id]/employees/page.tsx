import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { EmployeesManager, type Employee } from "@/components/ops/employees-manager";

export default async function CompanyEmployeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_companies")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Employees</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_companies</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data: company } = await service
    .from("companies")
    .select("id, name")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string }>();
  if (!company) notFound();

  const { data: employees } = await service
    .from("employees")
    .select("id, name, role, email, phone")
    .eq("company_id", id)
    .order("name");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a
          href={`/ops/companies/${company.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {company.name}
        </a>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Employees</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Staff contacts for {company.name}
        </p>
      </div>

      <EmployeesManager
        companyId={company.id}
        initialEmployees={(employees ?? []) as Employee[]}
      />
    </div>
  );
}
