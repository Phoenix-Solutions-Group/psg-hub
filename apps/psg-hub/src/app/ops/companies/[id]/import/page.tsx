import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { ImportWizard } from "@/components/ops/import-wizard";

// v1.1 / PSG-38 — Per-company RO/Estimate import wizard.
// /ops/companies/[id]/import?kind=ro|estimate
export default async function CompanyImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_companies")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Data Import</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_companies</code> capability.
        </p>
      </div>
    );
  }

  const { id } = await params;
  const { kind } = await searchParams;
  const initialKind = kind === "estimate" ? "estimate" : "ro";

  const service = createServiceClient();
  const { data: company } = await service
    .from("companies")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!company) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Company not found</h1>
        <Link href="/ops/companies" className="mt-2 inline-block text-sm text-primary underline">
          Back to Companies
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/ops/companies" className="text-sm text-muted-foreground hover:underline">
          ← Companies
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
          Import — {company.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload RO or estimate exports (csv, txt, xlsx, xlsb). Columns auto-map; save a template to reuse the mapping.
        </p>
      </div>
      <ImportWizard companyId={company.id} initialKind={initialKind} />
    </div>
  );
}
