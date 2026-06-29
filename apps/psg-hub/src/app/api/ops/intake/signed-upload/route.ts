// Track A / PSG-394 — Production entry point: superadmin route to mint a
// time-limited signed-upload URL for the private "pilot-intake" bucket.
//
//   POST /api/ops/intake/signed-upload
//     { companySlug, shopSlug, fileName }  → { path, signedUrl, token }
//
// Superadmin-gated (requireSuperadmin runs BEFORE any service client). Handing out
// a write capability to a private customer-PII bucket is privilege-escalation-
// adjacent, so it sits at psg_superadmin (mirroring the intel/sitemap ops routes),
// not a per-capability flag. RLS is the authoritative backstop; this gate is
// fail-closed defense-in-depth. Every mint is audited so the issued capability is
// attributable to an actor. No file contents ever touch the request/response —
// only the object path the token authorizes.
//
// runtime=nodejs: requireSuperadmin → getOpsAccess and the signed-URL mint both use
// the server-only service client.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import { mintIntakeSignedUpload, IntakePathError } from "@/lib/ops/intake/signed-upload";

export async function POST(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const { companySlug, shopSlug, fileName } = (body ?? {}) as Record<string, unknown>;

  let minted;
  try {
    minted = await mintIntakeSignedUpload({
      companySlug: companySlug as string,
      shopSlug: shopSlug as string,
      fileName: fileName as string,
    });
  } catch (err) {
    // Caller-input validation failures → 400; everything else (storage error) → 500.
    if (err instanceof IntakePathError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Audit AFTER the mint succeeds. Payload carries only the object path (no PII,
  // no file contents); the signed token/URL is the secret handed to the operator
  // and is deliberately NOT persisted to the audit trail.
  await recordAuditEvent({
    actorProfileId: gate.userId,
    action: "intake.signed_upload.mint",
    payload: { bucket: "pilot-intake", path: minted.path },
  });

  return NextResponse.json(
    { path: minted.path, signedUrl: minted.signedUrl, token: minted.token },
    { status: 200 },
  );
}
