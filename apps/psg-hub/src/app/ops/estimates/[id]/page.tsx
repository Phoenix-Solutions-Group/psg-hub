import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";

// Ops Estimate detail (v1.1 / PSG-35). Read-only; surfaces the spine columns
// plus the raw payload_jsonb so staff can inspect imported estimate data.

type EstimateDetail = {
  id: string;
  estimate_number: string;
  company_id: string;
  repair_customer_id: string;
  payload_jsonb: unknown;
  created_at: string;
  updated_at: string;
  companies: { id: string; name: string } | { id: string; name: string }[] | null;
  repair_customers:
    | { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }
    | { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }[]
    | null;
};

/** PostgREST may return an embedded relation as an object or a single-row array. */
function one<T>(rel: T | T[] | null): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="font-heading text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default async function EstimateDetailPage({
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
        <h1 className="font-heading text-lg font-semibold">Estimate</h1>
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
      "id, estimate_number, company_id, repair_customer_id, payload_jsonb, created_at, updated_at, companies(id, name), repair_customers(id, first_name, last_name, phone, email)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const estimate = data as EstimateDetail;
  const company = one(estimate.companies);
  const customer = one(estimate.repair_customers);
  const payload = estimate.payload_jsonb;
  const hasPayload =
    payload != null && typeof payload === "object" && Object.keys(payload as object).length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/ops/estimates"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← All estimates
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
          Estimate {estimate.estimate_number}
        </h1>
      </div>

      <dl className="grid gap-5 rounded-lg border border-border p-6 sm:grid-cols-2">
        <Field
          label="Company"
          value={
            company ? (
              <a href={`/ops/companies/${company.id}`} className="hover:text-ember">
                {company.name}
              </a>
            ) : (
              "—"
            )
          }
        />
        <Field
          label="Customer"
          value={customer ? `${customer.first_name} ${customer.last_name}`.trim() : "—"}
        />
        <Field label="Customer phone" value={customer?.phone} />
        <Field label="Customer email" value={customer?.email} />
        <Field label="Created" value={new Date(estimate.created_at).toLocaleString()} />
        <Field label="Updated" value={new Date(estimate.updated_at).toLocaleString()} />
      </dl>

      <div className="rounded-lg border border-border p-6">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Payload
        </h2>
        {hasPayload ? (
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted/40 p-4 text-xs leading-relaxed">
            {JSON.stringify(payload, null, 2)}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No payload data on this estimate.</p>
        )}
      </div>
    </div>
  );
}
