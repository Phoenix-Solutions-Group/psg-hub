import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";
import { OnboardingScreen } from "@/components/dashboard/onboarding-screen";
import { ShopSwitcher } from "@/components/dashboard/shop-switcher";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { getDashboardAccess, decideDashboardAccess } from "@/lib/auth/shop-access";
import { getOpsAccess, isOpsStaff } from "@/lib/auth/ops-access";
import { getActiveShopContext } from "@/lib/shop/context";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/content", label: "Content" },
  { href: "/dashboard/reviews", label: "Reviews" },
  { href: "/dashboard/ads", label: "Ads" },
  // Invoices nav removed with the Invoiced.com vertical (PSG-58). Stripe-native
  // invoices UI is rebuilt in Phase 17 (PSG-59) and will re-add this link.
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Customer-id gate (Phase 6 / 06-03): staff bypass; non-staff need a shop membership.
  // No-shop non-staff get self-serve onboarding (Phase 7 / 07-01) instead of a dead-end
  // notice — the wizard POSTs the service-role /api/onboarding bootstrap route.
  const access = await getDashboardAccess(user.id);
  if (decideDashboardAccess(access) === "no-shop") {
    return <OnboardingScreen email={user.email} />;
  }

  // Active-shop context for the switcher (additive; the gate above is unchanged).
  const { shops, activeShopId } = await getActiveShopContext(user.id);

  // Internal-ops staff (psg_internal / psg_superadmin) land here on /dashboard with
  // no visible path to the /ops backbone (PSG-107 / PSG-111). Surface an "Internal
  // Ops →" switcher for staff only — mirror of the "Client Hub →" toggle in
  // ops/layout.tsx. Fail closed: non-staff never see it (the link is also a no-op
  // for them since /ops notFound()s, but we gate here so the surface stays hidden).
  const opsAccess = await getOpsAccess(user.id);
  const showOpsLink = isOpsStaff(opsAccess.role);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Logo variant="reverse" className="h-7 w-auto" />
        </div>
        {shops.length > 0 && (
          <div className="border-b border-sidebar-border px-3 py-3">
            <ShopSwitcher shops={shops} activeShopId={activeShopId} />
          </div>
        )}
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => (
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
          <p className="truncate text-xs text-sidebar-foreground/70">
            {user.email}
          </p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border px-6">
          <div className="flex items-center gap-3">
            <MobileNav nav={NAV} shops={shops} activeShopId={activeShopId} />
            <Logo variant="primary" className="h-5 w-auto lg:hidden" />
            <span className="hidden font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground lg:inline">
              Client Hub
            </span>
          </div>
          <div className="flex items-center gap-5">
            {showOpsLink && (
              <a
                href="/ops"
                className="font-heading text-sm font-medium text-muted-foreground transition-colors hover:text-ember"
              >
                Internal Ops →
              </a>
            )}
            <form action="/api/auth/signout" method="post">
              <button
                type="submit"
                className="font-heading text-sm font-medium text-muted-foreground transition-colors hover:text-ember"
              >
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
