export type DashboardNavItem = {
  href: string;
  label: string;
};

const BASE_DASHBOARD_NAV: DashboardNavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/audit", label: "SEO Audit" },
  { href: "/dashboard/content", label: "Content" },
  { href: "/dashboard/approvals", label: "Approvals" },
  { href: "/dashboard/reviews", label: "Reviews" },
  { href: "/dashboard/ads", label: "Ads" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function buildDashboardNav(
  activeShopId: string | null
): DashboardNavItem[] {
  if (!activeShopId) return BASE_DASHBOARD_NAV;

  return [
    ...BASE_DASHBOARD_NAV.slice(0, 7),
    { href: "/dashboard/billing", label: "Billing" },
    {
      href: `/dashboard/shop/${encodeURIComponent(activeShopId)}/invoices`,
      label: "Invoices",
    },
    ...BASE_DASHBOARD_NAV.slice(7),
  ];
}
