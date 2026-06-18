import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { AccessAuditViewer, type AuditEntry } from "@/components/ops/access-audit-viewer";

// Access Audit surface (v1.5 / PSG-29 phase 3). Superadmin-only — matches the
// RLS on access_audit (append-only, superadmin-read). Reads the newest events
// and resolves actor/target ids to display names for the viewer.

const PAGE_SIZE = 500;

export default async function AccessAuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Access Audit</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const { data: rows } = await service
    .from("access_audit")
    .select("id, ts, action, actor_profile_id, target_profile_id, target_shop_id, payload_jsonb")
    .order("ts", { ascending: false })
    .limit(PAGE_SIZE);

  const events = rows ?? [];

  // Resolve actor + target-profile display names in one batched read.
  const profileIds = new Set<string>();
  const shopIds = new Set<string>();
  for (const e of events) {
    if (e.actor_profile_id) profileIds.add(e.actor_profile_id as string);
    if (e.target_profile_id) profileIds.add(e.target_profile_id as string);
    if (e.target_shop_id) shopIds.add(e.target_shop_id as string);
  }

  const nameById = new Map<string, string>();
  if (profileIds.size > 0) {
    const { data: profs } = await service
      .from("profiles")
      .select("id, display_name")
      .in("id", [...profileIds]);
    for (const p of profs ?? []) {
      nameById.set(p.id as string, ((p.display_name as string) || "").trim());
    }
    // Backfill missing display names with auth emails.
    const { data: authList } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of authList?.users ?? []) {
      if (u.email && (!nameById.get(u.id) || nameById.get(u.id) === "")) {
        nameById.set(u.id, u.email);
      }
    }
  }

  const shopNameById = new Map<string, string>();
  if (shopIds.size > 0) {
    const { data: shops } = await service.from("shops").select("id, name").in("id", [...shopIds]);
    for (const s of shops ?? []) {
      shopNameById.set(s.id as string, (s.name as string) ?? "");
    }
  }

  const label = (id: string | null | undefined) =>
    id ? nameById.get(id) || `${id.slice(0, 8)}…` : null;

  const entries: AuditEntry[] = events.map((e) => {
    const targetProfile = label(e.target_profile_id as string | null);
    const targetShopId = e.target_shop_id as string | null;
    const targetShop = targetShopId ? shopNameById.get(targetShopId) || `${targetShopId.slice(0, 8)}…` : null;
    return {
      id: e.id as string,
      ts: e.ts as string,
      action: e.action as string,
      actorName: label(e.actor_profile_id as string) ?? "—",
      targetName: targetProfile ?? targetShop ?? null,
      payload: (e.payload_jsonb ?? {}) as Record<string, unknown>,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <a href="/ops/admin" className="text-sm text-muted-foreground hover:text-ember">
          ← Superadmin
        </a>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">Access Audit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only history of every privileged change — role and shop changes, tier changes,
          module access edits, security-profile changes, and superadmin allowlist edits. Showing the
          most recent {PAGE_SIZE} events.
        </p>
      </div>

      <AccessAuditViewer entries={entries} />
    </div>
  );
}
