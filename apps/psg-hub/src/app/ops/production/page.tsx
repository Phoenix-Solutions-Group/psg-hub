import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import {
  ProductionDocumentsTable,
  ProductionQueueTable,
} from "@/components/ops/production-actions";

// v1.3 / PSG-27 (PSG-41) — Production print queue + historical view. Server-
// rendered data over the v1.3 data model; gated by manage_production. The print
// queue and recent-documents surfaces are interactive client components that
// call the gated POST routes (batch print → printing→historical; single-doc
// print; reprint with audited reason). Historical is read-only.

type BatchRow = {
  id: string;
  name: string;
  company_id: string;
  status: string;
  vendor: string | null;
  document_count: number;
  printed_at: string | null;
  created_at: string;
};

type DocRow = {
  id: string;
  batch_id: string;
  company_id: string;
  repair_customer_id: string | null;
  status: string;
  piece_type: string;
  vendor: string | null;
  external_id: string | null;
  proof_url: string | null;
  rendered_url: string | null;
  expected_delivery_date: string | null;
  created_at: string;
  production_batches: { name: string | null } | { name: string | null }[] | null;
  companies: { name: string | null } | { name: string | null }[] | null;
  repair_customers:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
};

const ACTIVE = new Set(["draft", "queued", "printing"]);

export default async function ProductionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_production")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Production</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_production</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const [{ data: batchData }, { data: docData }] = await Promise.all([
    service
      .from("production_batches")
      .select("id, name, company_id, status, vendor, document_count, printed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    service
      .from("production_documents")
      .select(
        "id, batch_id, company_id, repair_customer_id, status, piece_type, vendor, external_id, proof_url, rendered_url, expected_delivery_date, created_at, production_batches(name), companies(name), repair_customers(first_name, last_name)"
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const batches = (batchData ?? []) as BatchRow[];
  const docs = (docData ?? []) as DocRow[];
  const queue = batches.filter((b) => ACTIVE.has(b.status));
  const historicalCount = batches.filter((b) => b.status === "historical").length;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Production</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mail production via Lob. {queue.length} active {queue.length === 1 ? "batch" : "batches"} ·{" "}
          {historicalCount} historical.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Print queue
        </h2>
        <ProductionQueueTable
          rows={queue.map((b) => ({
            id: b.id,
            name: b.name,
            status: b.status,
            vendor: b.vendor,
            document_count: b.document_count,
            printed_at: b.printed_at,
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent documents
        </h2>
        <ProductionDocumentsTable
          rows={docs.map((d) => {
            const company = one(d.companies);
            const customer = one(d.repair_customers);
            const batch = one(d.production_batches);
            const customerName = [customer?.first_name, customer?.last_name]
              .filter(Boolean)
              .join(" ");
            return {
              id: d.id,
              batch_id: d.batch_id,
              batch_name: batch?.name ?? null,
              company_id: d.company_id,
              shop_name: company?.name ?? null,
              repair_customer_id: d.repair_customer_id,
              customer_name: customerName || null,
              status: d.status,
              piece_type: d.piece_type,
              vendor: d.vendor,
              external_id: d.external_id,
              proof_url: d.proof_url,
              rendered_url: d.rendered_url,
              expected_delivery_date: d.expected_delivery_date,
              created_at: d.created_at,
            };
          })}
        />
      </section>
    </div>
  );
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
