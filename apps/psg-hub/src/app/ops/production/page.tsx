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
  status: string;
  piece_type: string;
  vendor: string | null;
  external_id: string | null;
  expected_delivery_date: string | null;
  created_at: string;
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
      .select("id, status, piece_type, vendor, external_id, expected_delivery_date, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const batches = (batchData ?? []) as BatchRow[];
  const docs = (docData ?? []) as DocRow[];
  const queue = batches.filter((b) => ACTIVE.has(b.status));
  const historical = batches.filter((b) => b.status === "historical");

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Production</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mail production via Lob. {queue.length} active {queue.length === 1 ? "batch" : "batches"} ·{" "}
          {historical.length} historical.
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
          Historical
        </h2>
        <BatchTable rows={historical} emptyLabel="Nothing printed yet." />
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent documents
        </h2>
        <ProductionDocumentsTable rows={docs} />
      </section>
    </div>
  );
}

function BatchTable({ rows, emptyLabel }: { rows: BatchRow[]; emptyLabel: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Batch</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Vendor</th>
            <th className="px-4 py-3">Documents</th>
            <th className="px-4 py-3">Printed</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{b.name}</td>
                <td className="px-4 py-3">{b.status}</td>
                <td className="px-4 py-3 text-muted-foreground">{b.vendor ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{b.document_count}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {b.printed_at ? new Date(b.printed_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
