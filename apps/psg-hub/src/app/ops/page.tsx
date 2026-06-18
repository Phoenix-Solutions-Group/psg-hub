import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, OPS_FUNCTIONS, hasOpsFn } from "@/lib/auth/ops-access";

// Ops landing — surfaces which modules the current user's security profile grants.
const MODULES: { fn: (typeof OPS_FUNCTIONS)[number]; label: string; href: string; note: string }[] = [
  { fn: "manage_companies", label: "Companies & ROs", href: "/ops/companies", note: "Companies, employees, repair customers, ROs, estimates" },
  { fn: "manage_sysconfig", label: "System Configuration", href: "/ops/sys-config", note: "Products, items, vehicles, insurance master data" },
  { fn: "manage_reports", label: "Operational Reports", href: "/ops/reports", note: "Coming in v1.4" },
  { fn: "manage_production", label: "Production", href: "/ops/production", note: "Coming in v1.2" },
  { fn: "manage_users", label: "Superadmin Matrix", href: "/ops/admin", note: "Coming in v1.5" },
];

export default async function OpsHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = user ? await getOpsAccess(user.id) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Internal Operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          v1.1 Ops Foundation. FileMaker remains authoritative — this runs parallel (dual-entry) until cutover.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODULES.map((m) => {
          const enabled = access ? hasOpsFn(access, m.fn) : false;
          return (
            <a
              key={m.fn}
              href={enabled ? m.href : "#"}
              aria-disabled={!enabled}
              className={
                "rounded-lg border border-border p-5 transition-colors " +
                (enabled ? "hover:border-ember hover:bg-accent/40" : "pointer-events-none opacity-50")
              }
            >
              <div className="font-heading text-base font-semibold">{m.label}</div>
              <div className="mt-1 text-sm text-muted-foreground">{m.note}</div>
              {!enabled && (
                <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  No access
                </div>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
