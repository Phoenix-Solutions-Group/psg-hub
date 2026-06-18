import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import {
  ProgramsManager,
  type CompanyProgram,
  type ProductOption,
} from "@/components/ops/programs-manager";

type ProgramRow = {
  id: string;
  quantity: number;
  unit_price_cents: number;
  customizations_jsonb: Record<string, unknown> | null;
  products: { id: string; name: string; selling_price_cents: number } | null;
};

export default async function CompanyProgramsPage({
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
        <h1 className="font-heading text-lg font-semibold">Programs</h1>
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

  const [{ data: programRows }, { data: products }] = await Promise.all([
    service
      .from("company_programs")
      .select(
        `id, quantity, unit_price_cents, customizations_jsonb,
         products(id, name, selling_price_cents)`
      )
      .eq("company_id", id)
      .order("created_at"),
    service
      .from("products")
      .select("id, name, selling_price_cents")
      .order("name"),
  ]);

  // Supabase infers the to-one `products` embed pessimistically as an array; at
  // runtime it is a single object (FK is to-one). Cast through unknown.
  const programs: CompanyProgram[] = ((programRows ?? []) as unknown as ProgramRow[]).map((r) => ({
    id: r.id,
    quantity: r.quantity,
    unit_price_cents: r.unit_price_cents,
    customizations: (r.customizations_jsonb ?? {}) as CompanyProgram["customizations"],
    product: r.products
      ? {
          id: r.products.id,
          name: r.products.name,
          selling_price_cents: r.products.selling_price_cents,
        }
      : null,
  }));

  const enrolledProductIds = new Set(programs.map((p) => p.product?.id).filter(Boolean));
  const available: ProductOption[] = ((products ?? []) as ProductOption[]).filter(
    (p) => !enrolledProductIds.has(p.id)
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <a
          href={`/ops/companies/${company.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {company.name}
        </a>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Programs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Product enrollment & per-company overrides (logo, header, footer, greeting)
        </p>
      </div>

      <ProgramsManager
        companyId={company.id}
        initialPrograms={programs}
        availableProducts={available}
      />
    </div>
  );
}
