import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess } from "@/lib/auth/ops-access";

// Superadmin admin home (the "Superadmin Matrix" shell). Sections live as
// siblings here so v1.1 (Security Profiles, PSG-39) and v1.5 (module access
// matrix, PSG-29) share ONE admin surface rather than duplicating shells.
const SECTIONS = [
  {
    href: "/ops/admin/users",
    label: "User Access",
    note: "Find users, change roles, assign shops, and update shop tiers.",
    available: true,
  },
  {
    href: "/ops/admin/security-profiles",
    label: "Security Profiles",
    note: "Create capability bundles and assign them to ops staff.",
    available: true,
  },
  {
    href: "/ops/admin/modules",
    label: "Module Access Matrix",
    note: "Toggle module visibility per role / shop / user. (v1.5 — PSG-29)",
    available: true,
  },
  {
    href: "/ops/admin/audit",
    label: "Access Audit",
    note: "Append-only history of privileged changes. (v1.5 — PSG-29)",
    available: true,
  },
  {
    href: "/ops/admin/pii",
    label: "PII Checklist",
    note: "Inventory of PII surfaces and the controls protecting them. (v1.5 — PSG-29)",
    available: true,
  },
];

export default async function OpsAdminHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Superadmin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage access across the hub. All changes here are recorded to the access audit.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <a
            key={s.href}
            href={s.available ? s.href : "#"}
            aria-disabled={!s.available}
            className={
              "rounded-lg border border-border p-5 transition-colors " +
              (s.available
                ? "hover:border-ember hover:bg-accent/40"
                : "pointer-events-none opacity-50")
            }
          >
            <div className="font-heading text-base font-semibold">{s.label}</div>
            <div className="mt-1 text-sm text-muted-foreground">{s.note}</div>
            {!s.available && (
              <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                Coming soon
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
