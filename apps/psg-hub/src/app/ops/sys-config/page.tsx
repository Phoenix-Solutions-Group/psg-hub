import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess, hasOpsFn } from "@/lib/auth/ops-access";
import { SYSCONFIG_ENTITIES } from "@/components/ops/sysconfig/config";

// SysConfig landing — routes to the 5 master-data sub-sections (derived from the
// shared entity config so the menu can't drift from the actual CRUD verticals).
const SECTIONS = SYSCONFIG_ENTITIES.map((e) => ({
  href: `/ops/sys-config/${e.slug}`,
  label: e.title,
  note: e.blurb,
}));

export default async function SysConfigPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (!hasOpsFn(access, "manage_sysconfig")) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">System Configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">Master data for vehicles, insurance, and program products.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <a
            key={s.href}
            href={s.href}
            className="rounded-lg border border-border p-5 transition-colors hover:border-ember hover:bg-accent/40"
          >
            <div className="font-heading text-base font-semibold">{s.label}</div>
            <div className="mt-1 text-sm text-muted-foreground">{s.note}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
