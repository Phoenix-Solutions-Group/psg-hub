import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/brand/logo";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/content", label: "Content" },
  { href: "/dashboard/reviews", label: "Reviews" },
  { href: "/dashboard/ads", label: "Ads" },
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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <Logo variant="reverse" className="h-7 w-auto" />
        </div>
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
          <Logo variant="primary" className="h-5 w-auto lg:hidden" />
          <span className="hidden font-heading text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground lg:inline">
            Client Hub
          </span>
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="font-heading text-sm font-medium text-muted-foreground transition-colors hover:text-ember"
            >
              Sign out
            </button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
