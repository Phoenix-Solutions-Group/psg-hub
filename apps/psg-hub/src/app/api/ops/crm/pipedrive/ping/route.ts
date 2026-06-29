// PSG-423 — Read-only Pipedrive connection test, runnable in the deployed env.
//
//   GET /api/ops/crm/pipedrive/ping
//     → 200 { reachable: true, user, dealCount }                     (green)
//     → 200 { reachable: false, reason: "config_missing", ... }      (red, config)
//     → 200 { reachable: false, reason: "api_error", status }        (red, upstream)
//
// Superadmin-gated (mirrors the intel / sitemap / intake ops routes): probing an
// external CRM account is a privileged diagnostic, so it sits at psg_superadmin,
// fail-closed BEFORE any config/secret is read. This is a READ-ONLY probe (GET
// /users/me) — it writes nothing, so it is intentionally NOT audited (the audit
// vocabulary is for mutations).
//
// Secrets never cross the wire: on success only the authenticated user/company is
// returned; on missing config we return the candidate var NAMES plus the
// `PIPEDRIVE_*` keys actually present in the env (NAMES ONLY) so the operator can
// confirm the exact Vercel var name(s) without CLI access.
//
// runtime=nodejs: requireSuperadmin uses the server-only service client.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { pingPipedrive, PipedriveApiError } from "@/lib/crm/pipedrive/client";
import {
  PipedriveConfigError,
  presentPipedriveEnvKeys,
} from "@/lib/crm/pipedrive/config";

export async function GET() {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  try {
    const ping = await pingPipedrive();
    return NextResponse.json(ping, { status: 200 });
  } catch (err) {
    if (err instanceof PipedriveConfigError) {
      return NextResponse.json(
        {
          reachable: false,
          reason: "config_missing",
          // Candidate names we looked for + the PIPEDRIVE_* names actually set in
          // this env (NAMES ONLY — never values). This is the discovery channel
          // for confirming the exact Vercel var name(s).
          checkedEnvNames: err.missing,
          presentEnvNames: presentPipedriveEnvKeys(),
        },
        { status: 200 },
      );
    }
    if (err instanceof PipedriveApiError) {
      return NextResponse.json(
        { reachable: false, reason: "api_error", status: err.status },
        { status: 200 },
      );
    }
    // Unknown/network error — surface a secret-free shape, log nothing with the token.
    return NextResponse.json(
      { reachable: false, reason: "unexpected_error" },
      { status: 200 },
    );
  }
}
