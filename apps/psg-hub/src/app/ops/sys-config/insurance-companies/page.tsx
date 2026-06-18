import { SysConfigVertical } from "@/components/ops/sysconfig/sys-config-vertical";

// v1.1 / PSG-37 — insurance-companies master-data CRUD. Delegates to the shared vertical.
export const runtime = "nodejs";

export default function InsuranceCompaniesPage() {
  return <SysConfigVertical slug="insurance-companies" />;
}
