import "server-only";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { getEntity, recordSelect } from "./config";
import { ResourceManager, type OptionItem } from "./resource-manager";

// v1.1 / PSG-37 — shared server component rendering one System Configuration
// vertical end-to-end: manage_sysconfig gate, full-record fetch, multiselect
// option resolution, then the client ResourceManager for CRUD. Each
// /ops/sys-config/<slug>/page.tsx delegates to this with its slug.

type Row = Record<string, unknown> & { id: string };

export async function SysConfigVertical({ slug }: { slug: string }) {
  const entity = getEntity(slug);
  if (!entity) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_sysconfig")) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">{entity.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your security profile does not grant the <code>manage_sysconfig</code> capability.
        </p>
      </div>
    );
  }

  const service = createServiceClient();

  // Full-record projection so the edit form can seed json / multiselect values
  // that aren't shown in the list table.
  let query = service.from(entity.table).select(recordSelect(entity)).limit(500);
  for (const col of entity.orderBy) query = query.order(col, { ascending: true });
  const { data: rowData } = await query;
  const rows = (rowData ?? []) as Row[];

  // Resolve options for multiselect fields (e.g. agents → insurance companies).
  const options: Record<string, OptionItem[]> = {};
  for (const f of entity.fields) {
    if (f.type !== "multiselect" || !f.optionsFrom) continue;
    const optEntity = getEntity(f.optionsFrom);
    if (!optEntity) continue;
    const labelCol = optEntity.listColumns[0]?.key ?? "name";
    const { data: optRows } = await service
      .from(optEntity.table)
      .select(`id, ${labelCol}`)
      .order(labelCol, { ascending: true })
      .limit(1000);
    options[f.optionsFrom] = (optRows ?? []).map((o) => {
      const rec = o as Record<string, unknown>;
      return { id: String(rec.id), label: String(rec[labelCol] ?? "") };
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <nav className="mb-2 text-xs text-muted-foreground">
          <a href="/ops/sys-config" className="hover:text-ember">
            System Config
          </a>{" "}
          / {entity.title}
        </nav>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{entity.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{entity.blurb}</p>
      </div>

      <ResourceManager entity={entity} rows={rows} options={options} />
    </div>
  );
}
