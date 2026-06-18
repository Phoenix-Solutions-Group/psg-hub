import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";

// v1.1 / PSG-38 — Shared landing for /ops/data-import/{ros,estimates}.
// Pick a company to launch the import wizard for the given kind.
type ImportKind = "ro" | "estimate";

const LABELS: Record<ImportKind, { title: string; noun: string }> = {
  ro: { title: "Import Repair Orders", noun: "RO" },
  estimate: { title: "Import Estimates", noun: "estimate" },
};

export async function DataImportLanding({ kind }: { kind: ImportKind }) {
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

  const service = createServiceClient();
  const { data } = await service
    .from("companies")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);
  const companies = (data ?? []) as Array<{ id: string; name: string }>;
  const labels = LABELS[kind];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{labels.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a company to upload its {labels.noun} export. Mappings are saved per company as reusable templates.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-3">{c.name}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/ops/companies/${c.id}/import?kind=${kind}`}
                    className="text-sm text-primary underline"
                  >
                    Open wizard →
                  </Link>
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
                  No companies on file yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
