import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { RepairOrdersPanel } from "@/components/ops/repair-orders-panel";
import type { RoStatus } from "@/lib/ops/repair";

type CustomerDetail = {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: Record<string, string> | null;
  created_at: string;
  updated_at: string;
};

export type RepairOrderRow = {
  id: string;
  ro_number: string;
  status: RoStatus;
  total_loss_flag: boolean;
  vehicle_id: string | null;
  insurance_company_id: string | null;
  insurance_agent_id: string | null;
  payload_jsonb: { documents?: unknown[] } | null;
  created_at: string;
};

function NoAccess() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
      <h1 className="font-heading text-lg font-semibold">Repair Customer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your security profile does not grant the <code>manage_companies</code> capability.
      </p>
    </div>
  );
}

export default async function RepairCustomerDetailPage({
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
  const { data: customer } = await service
    .from("repair_customers")
    .select("id, company_id, first_name, last_name, phone, email, address, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<CustomerDetail>();

  if (!customer) notFound();

  // Repair orders for this customer + the SysConfig master data that the
  // Add-New-RO form links to (vehicle / insurance_company / insurance_agent).
  const [{ data: roData }, { data: vehicles }, { data: insCompanies }, { data: insAgents }, { data: company }] =
    await Promise.all([
      service
        .from("repair_orders")
        .select("id, ro_number, status, total_loss_flag, vehicle_id, insurance_company_id, insurance_agent_id, payload_jsonb, created_at")
        .eq("repair_customer_id", id)
        .order("created_at", { ascending: false }),
      service.from("vehicles").select("id, make, model").order("make"),
      service.from("insurance_companies").select("id, name").order("name"),
      service.from("insurance_agents").select("id, name").order("name"),
      service.from("companies").select("name").eq("id", customer.company_id).maybeSingle<{ name: string }>(),
    ]);

  const orders = (roData ?? []) as RepairOrderRow[];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/ops/repair-customers" className="text-xs text-muted-foreground hover:text-foreground">
          ← All repair customers
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
          {customer.first_name} {customer.last_name}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {company?.name ?? "Unknown company"} · Updated {new Date(customer.updated_at).toLocaleString()}
        </p>
      </div>

      <div className="grid gap-4 rounded-lg border border-border p-5 sm:grid-cols-2">
        <Field label="Phone" value={customer.phone} />
        <Field label="Email" value={customer.email} />
        <Field
          label="Address"
          value={
            customer.address && Object.keys(customer.address).length
              ? [customer.address.line1, customer.address.city, customer.address.state, customer.address.postal_code]
                  .filter(Boolean)
                  .join(", ")
              : null
          }
        />
      </div>

      <RepairOrdersPanel
        repairCustomerId={customer.id}
        companyId={customer.company_id}
        orders={orders}
        vehicles={(vehicles ?? []) as { id: string; make: string; model: string }[]}
        insuranceCompanies={(insCompanies ?? []) as { id: string; name: string }[]}
        insuranceAgents={(insAgents ?? []) as { id: string; name: string }[]}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="font-heading text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value || "—"}</div>
    </div>
  );
}
