import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { ModuleAccessMatrix } from "@/components/ops/module-access-matrix";
import { BASELINE_MODULES, type GrantRow, type ModuleRow } from "@/lib/ops/modules";
import { loadModuleMatrix, type MatrixData } from "@/lib/ops/module-matrix-loader";

// Module Access Matrix surface (v1.5 / PSG-29). Superadmin-only — matches the
// RLS on modules + module_access_grants. Loads the registry + role grants and
// hands them to the client editor.

export const dynamic = "force-dynamic";

type SupabaseReadClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createServiceClient>;

const MODULE_SELECT = "id, slug, display_name, audience, min_tier_slug, default_visibility";
const GRANT_SELECT = "id, module_id, profile_id, shop_id, role, effect";

async function readMatrixData(client: SupabaseReadClient): Promise<MatrixData> {
  const [{ data: modules, error: moduleError }, { data: grants, error: grantError }] =
    await Promise.all([
      client.from("modules").select(MODULE_SELECT).order("display_name", { ascending: true }),
      client.from("module_access_grants").select(GRANT_SELECT),
    ]);

  if (moduleError) {
    throw moduleError;
  }

  if (grantError) {
    console.error("[ops/admin/modules] grant load failed; rendering registry without grants", grantError);
  }

  return {
    modules: (modules ?? []) as ModuleRow[],
    grants: grantError ? [] : ((grants ?? []) as GrantRow[]),
  };
}

async function seedBaselineModules(client: SupabaseReadClient) {
  const { error } = await client
    .from("modules")
    .upsert([...BASELINE_MODULES], { onConflict: "slug" });

  if (error) {
    throw error;
  }
}

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

  const service = () => createServiceClient();
  const matrix = await loadModuleMatrix({
    readFromService: () => readMatrixData(service()),
    seedWithService: () => seedBaselineModules(service()),
    readFromUser: () => readMatrixData(supabase),
    seedWithUser: () => seedBaselineModules(supabase),
  });

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
        modules={matrix.modules}
        grants={matrix.grants}
      />
    </div>
  );
}
