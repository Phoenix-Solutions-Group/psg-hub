import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { CompanyDetailForm } from "@/components/ops/company-detail-form";

type CompanyAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
};

type CompanyDetail = {
  id: string;
  name: string;
  phone: string | null;
  contact: string | null;
  status: "active" | "inactive" | "prospect";
  shop_id: string | null;
  address: CompanyAddress | null;
  created_at: string;
  updated_at: string;
};

function NoAccess() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
      <h1 className="font-heading text-lg font-semibold">Company</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your security profile does not grant the <code>manage_companies</code> capability.
      </p>
    </div>
  );
}

export default async function CompanyDetailPage({
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
  if (!hasOpsFn(access, "manage_companies")) return <NoAccess />;

  const service = createServiceClient();
  const { data: company } = await service
    .from("companies")
    .select("id, name, phone, contact, status, shop_id, address, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<CompanyDetail>();

  if (!company) notFound();

  // Summary counts for the sub-module cards.
  const [{ count: employeeCount }, { count: programCount }] = await Promise.all([
    service.from("employees").select("id", { count: "exact", head: true }).eq("company_id", id),
    service
      .from("company_programs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", id),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/ops/companies"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← All companies
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
          {company.name}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Updated {new Date(company.updated_at).toLocaleString()}
        </p>
      </div>

      <CompanyDetailForm company={company} />

      <div className="grid gap-4 sm:grid-cols-2">
        <a
          href={`/ops/companies/${company.id}/employees`}
          className="rounded-lg border border-border p-5 transition-colors hover:border-ember hover:bg-accent/40"
        >
          <h2 className="font-heading text-sm font-semibold">Employees</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {employeeCount ?? 0} on file — manage staff contacts
          </p>
        </a>
        <a
          href={`/ops/companies/${company.id}/programs`}
          className="rounded-lg border border-border p-5 transition-colors hover:border-ember hover:bg-accent/40"
        >
          <h2 className="font-heading text-sm font-semibold">Programs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {programCount ?? 0} enrolled — product enrollment & overrides
          </p>
        </a>
      </div>
    </div>
  );
}
