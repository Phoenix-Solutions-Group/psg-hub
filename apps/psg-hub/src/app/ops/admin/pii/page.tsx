import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PII_CHECKLIST, PII_STATUS_LABELS, piiStatusCounts, type PiiStatus } from "@/lib/ops/pii-checklist";

// PII checklist surface (v1.5 / PSG-29). Superadmin-only documented control
// inventory — where PII lives in BSM, what protects it, and current status.

const STATUS_VARIANT: Record<PiiStatus, "default" | "secondary" | "outline"> = {
  in_place: "default",
  partial: "secondary",
  todo: "outline",
};

export default async function PiiChecklistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">PII Checklist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const counts = piiStatusCounts();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <a href="/ops/admin" className="text-sm text-muted-foreground hover:text-ember">
          ← Superadmin
        </a>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">PII Checklist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Inventory of personally-identifiable data surfaces in BSM and the controls that protect
          them. Review before any access or schema change touching customer or staff data.
        </p>
        <div className="mt-3 flex gap-2 text-xs">
          <Badge variant="default">{counts.in_place} in place</Badge>
          <Badge variant="secondary">{counts.partial} partial</Badge>
          <Badge variant="outline">{counts.todo} to do</Badge>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Surface</TableHead>
              <TableHead>Control</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PII_CHECKLIST.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-sm font-medium">{c.surface}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.control}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status]}>{PII_STATUS_LABELS[c.status]}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.evidence}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
