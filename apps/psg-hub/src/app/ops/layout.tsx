import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { getOpsAccess, isOpsStaff } from "@/lib/auth/ops-access";

// Internal-ops backbone shell (v1.1 / PSG-25). psg_internal + psg_superadmin only;
// fine-grained module access is enforced per-route via requireOpsFn() + RLS.
// `superadminOnly` items (e.g. Competitor Intel, PSG-210) are hidden from psg_internal so the
// nav matches the route's own superadmin gate — visibility is not access control, but not
// advertising a surface a user cannot reach keeps the nav honest.
const OPS_NAV: { href: string; label: string; superadminOnly?: boolean }[] = [
  { href: "/ops", label: "Ops Home" },
  { href: "/ops/companies", label: "Companies" },
  { href: "/ops/repair-customers", label: "Repair Customers" },
  { href: "/ops/repair-orders", label: "Repair Orders" },
  { href: "/ops/estimates", label: "Estimates" },
  { href: "/ops/data-import/ros", label: "Import ROs" },
  { href: "/ops/data-import/estimates", label: "Import Estimates" },
  { href: "/ops/surveys", label: "Surveys" },
  { href: "/ops/production/templates", label: "Mail Templates" },
  { href: "/ops/ads-mutations", label: "Ads Mutations" },
  { href: "/ops/sitemap", label: "Sitemap", superadminOnly: true },
  { href: "/ops/intel", label: "Competitor Intel", superadminOnly: true },
  { href: "/ops/admin/integrations/ccc", label: "CCC Connections", superadminOnly: true },
  { href: "/ops/sys-config", label: "System Config" },
];

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fail closed: non-staff users must not learn the /ops surface exists.
  const access = await getOpsAccess(user.id);
  if (!isOpsStaff(access.role)) {
    notFound();
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Logo variant="reverse" className="h-7 w-auto" />
        </div>
        <div className="border-b border-sidebar-border px-5 py-3">
          <span className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-sidebar-foreground/70">
            Internal Ops
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {OPS_NAV.filter(
            (item) => !item.superadminOnly || access.role === "psg_superadmin",
          ).map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center rounded-md px-3 py-2 font-heading text-sm font-medium tracking-[0.02em] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <p className="truncate text-xs text-sidebar-foreground/70">{user.email}</p>
          <p className="text-xs text-sidebar-foreground/70">{access.role}</p>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border px-6">
          <span className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            PSG Internal Operations
          </span>
          <a
            href="/dashboard"
            className="font-heading text-sm font-medium text-muted-foreground transition-colors hover:text-ember"
          >
            Client Hub →
          </a>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
