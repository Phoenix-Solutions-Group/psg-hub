import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { ModuleAccessMatrix } from "@/components/ops/module-access-matrix";
import type { GrantRow, ModuleRow } from "@/lib/ops/modules";

// Module Access Matrix surface (v1.5 / PSG-29). Superadmin-only — matches the
// RLS on modules + module_access_grants. Loads the registry + role grants and
// hands them to the client editor.

export default async function ModulesAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Module Access Matrix</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  let modules: ModuleRow[] = [];
  let grants: GrantRow[] = [];

  try {
    const service = createServiceClient();
    const [{ data: moduleRows, error: moduleError }, { data: grantRows, error: grantError }] =
      await Promise.all([
        service
          .from("modules")
          .select("id, slug, display_name, audience, min_tier_slug, default_visibility")
          .order("display_name", { ascending: true }),
        service
          .from("module_access_grants")
          .select("id, module_id, profile_id, shop_id, role, effect"),
      ]);

    if (moduleError ?? grantError) {
      throw moduleError ?? grantError;
    }

    if ((moduleRows ?? []).length === 0) {
      throw new Error("Service-role module query returned no rows");
    }

    modules = moduleRows as ModuleRow[];
    grants = (grantRows ?? []) as GrantRow[];
  } catch (error) {
    console.error("[ops/admin/modules] service-role load failed; falling back to user session", error);
    const [{ data: moduleRows }, { data: grantRows }] = await Promise.all([
      supabase
        .from("modules")
        .select("id, slug, display_name, audience, min_tier_slug, default_visibility")
        .order("display_name", { ascending: true }),
      supabase.from("module_access_grants").select("id, module_id, profile_id, shop_id, role, effect"),
    ]);

    modules = (moduleRows ?? []) as ModuleRow[];
    grants = (grantRows ?? []) as GrantRow[];
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <a href="/ops/admin" className="text-sm text-muted-foreground hover:text-ember">
          ← Superadmin
        </a>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
          Module Access Matrix
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Curate the module registry and decide visibility per role. Every change here is recorded
          to the access audit.
        </p>
      </div>

      <ModuleAccessMatrix
        modules={modules}
        grants={grants}
      />
    </div>
  );
}
