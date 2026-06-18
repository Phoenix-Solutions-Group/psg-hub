import { SysConfigVertical } from "@/components/ops/sysconfig/sys-config-vertical";

// v1.1 / PSG-37 — insurance-agents master-data CRUD. Delegates to the shared vertical.
export const runtime = "nodejs";

export default function InsuranceAgentsPage() {
  return <SysConfigVertical slug="insurance-agents" />;
}
