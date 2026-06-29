import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { IntakeUploader } from "@/components/ops/intake-uploader";

// Track A / PSG-402 — Pilot-intake single-drop upload surface (page).
// Mirrors src/app/ops/sitemap/page.tsx: server component, superadmin gate
// (auth.getUser → redirect /login; getOpsAccess → psg_superadmin else the
// restricted block). The page exists so the sole superadmin (Nick) authenticates
// with his OWN creds and the existing POST /api/ops/intake/signed-upload route
// mints the signed-upload token server-side under his session — no service-role
// key or signed link is ever relayed by an agent.
//
// runtime=nodejs: getOpsAccess uses the server-only service client.
export const runtime = "nodejs";

export type IntakeGate = "redirect-login" | "restricted" | "allow";

/**
 * Pure gate decision (no DB) — unit-testable. Mirrors the route's
 * requireSuperadmin: no session → /login; non-superadmin → restricted block;
 * psg_superadmin → the uploader.
 */
export function intakeGateDecision(input: { hasUser: boolean; role: string | null }): IntakeGate {
  if (!input.hasUser) return "redirect-login";
  if (input.role !== "psg_superadmin") return "restricted";
  return "allow";
}

export default async function IntakeUploadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const role = user ? (await getOpsAccess(user.id)).role : null;
  const gate = intakeGateDecision({ hasUser: Boolean(user), role });

  if (gate === "redirect-login") redirect("/login");

  if (gate === "restricted") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">Pilot Intake</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Pilot Intake</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop the pilot shop&apos;s FileMaker RO/Estimate export and it uploads straight into the
          private <code>pilot-intake</code> bucket — no console, no secrets. The slugs default to the
          pilot shop; edit them if you&apos;re dropping for another shop.
        </p>
      </div>
      <IntakeUploader />
    </div>
  );
}
