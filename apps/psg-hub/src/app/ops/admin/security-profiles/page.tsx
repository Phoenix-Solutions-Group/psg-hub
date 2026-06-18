import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess, OPS_FUNCTIONS, type OpsFunction } from "@/lib/auth/ops-access";
import { OPS_FUNCTION_LABELS } from "@/lib/ops/security-profiles";
import {
  SecurityProfileCatalog,
  type ProfileDef,
} from "@/components/ops/security-profile-catalog";
import {
  UserProfileAssigner,
  type StaffUser,
} from "@/components/ops/user-profile-assigner";

// Security Profiles assign surface (v1.1 / PSG-39). Superadmin-only — matches
// the RLS on security_profile_defs + user_security_profile_assignments.
const STAFF_ROLES = ["psg_internal", "psg_superadmin"];

export default async function SecurityProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Security Profiles</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const service = createServiceClient();

  // 1. Profile catalog.
  const { data: defs } = await service
    .from("security_profile_defs")
    .select("id, name, is_builtin, functions_jsonb")
    .order("is_builtin", { ascending: false })
    .order("name", { ascending: true });
  const profiles = (defs ?? []) as ProfileDef[];

  // 2. Ops staff users (role + display name + email).
  const { data: roleRows } = await service
    .from("app_user_roles")
    .select("profile_id, role")
    .in("role", STAFF_ROLES);
  const staffIds = (roleRows ?? []).map((r) => r.profile_id as string);

  const namesById = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: profileRows } = await service
      .from("profiles")
      .select("id, display_name")
      .in("id", staffIds);
    for (const p of profileRows ?? []) {
      namesById.set(p.id as string, (p.display_name as string) ?? "");
    }
  }

  // Emails live in auth.users — fetch via the admin API and map by id.
  const emailById = new Map<string, string>();
  const { data: authList } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of authList?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  const users: StaffUser[] = (roleRows ?? [])
    .map((r) => {
      const id = r.profile_id as string;
      return {
        profileId: id,
        displayName: namesById.get(id) || emailById.get(id) || id.slice(0, 8),
        email: emailById.get(id) ?? null,
        role: r.role as string,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // 3. Current assignments.
  const { data: assignRows } = await service
    .from("user_security_profile_assignments")
    .select("profile_id, security_profile_id");
  const assignments = (assignRows ?? []).map((a) => ({
    profileId: a.profile_id as string,
    securityProfileId: a.security_profile_id as string,
  }));

  const capabilities = OPS_FUNCTIONS.map((fn: OpsFunction) => ({
    key: fn,
    label: OPS_FUNCTION_LABELS[fn],
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Security Profiles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Named capability bundles for ops staff. Effective access = role + assigned profiles. The
          built-in <strong>Administrator</strong> profile grants every capability and is locked.
        </p>
      </div>

      <SecurityProfileCatalog profiles={profiles} capabilities={capabilities} />
      <UserProfileAssigner
        users={users}
        profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
        assignments={assignments}
      />
    </div>
  );
}
