import { hasOpsFn, type OpsAccess } from "@/lib/auth/ops-access";

export type OpsNavItem = { href: string; label: string; superadminOnly?: boolean };

export const OPS_NAV: OpsNavItem[] = [
  { href: "/ops", label: "Ops Home" },
  { href: "/ops/production", label: "Production" },
  { href: "/ops/production/artwork", label: "Mail Editor" },
  { href: "/ops/bsm-content-approvals", label: "Content Approvals" },
  { href: "/ops/companies", label: "Companies" },
  { href: "/ops/admin/users", label: "User Access", superadminOnly: true },
  { href: "/ops/repair-customers", label: "Repair Customers" },
  { href: "/ops/repair-orders", label: "Repair Orders" },
  { href: "/ops/estimates", label: "Estimates" },
  { href: "/ops/intake", label: "Pilot Intake", superadminOnly: true },
  { href: "/ops/data-import/ros", label: "Import ROs" },
  { href: "/ops/data-import/estimates", label: "Import Estimates" },
  { href: "/ops/surveys", label: "Surveys" },
  { href: "/ops/production/templates", label: "Mail Templates" },
  { href: "/ops/ads-mutations", label: "Ads Mutations" },
  { href: "/ops/sitemap", label: "Sitemap", superadminOnly: true },
  { href: "/ops/bsm-progress", label: "BSM Progress", superadminOnly: true },
  { href: "/ops/sales-pipeline", label: "Sales Pipeline", superadminOnly: true },
  { href: "/ops/intel", label: "Competitor Intel", superadminOnly: true },
  { href: "/ops/admin/integrations/ccc", label: "CCC Connections", superadminOnly: true },
  { href: "/ops/sys-config", label: "System Config" },
];

export function visibleOpsNavItems(access: OpsAccess): OpsNavItem[] {
  return OPS_NAV.filter(
    (item) =>
      (!item.superadminOnly || access.role === "psg_superadmin") &&
      (item.href !== "/ops/production/artwork" || hasOpsFn(access, "design_mail_artwork")) &&
      (item.href !== "/ops/bsm-content-approvals" ||
        hasOpsFn(access, "manage_bsm_content_approvals"))
  );
}
