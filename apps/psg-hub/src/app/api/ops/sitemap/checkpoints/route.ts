// PSG-376 / Wave 1A — decide a sitemap pipeline checkpoint IN-UI (no SQL).
//
//   POST /api/ops/sitemap/checkpoints
//     { shopId, phase, contentHash, decision: "approved" | "changes_requested", notes? }
//
// The shipped /ops/sitemap studio (PSG-258) pauses at each of the two human gates
// (clusters_page_types, then package_handoff) but had NO approve control — the only way to
// clear a gate was a manual SQL UPDATE. This route closes that gap: a superadmin approves (or
// requests changes on) the *pending* queued checkpoint, and the studio auto re-runs to advance.
//
// Superadmin-gated (mirrors the run route + intel/CCC approval queues — RLS is the authoritative
// backstop; sitemap_checkpoints is default-deny, service-role only). decided_by_name is resolved
// server-side from the actual superadmin's profile (never the literal "operator"), so the
// sign-off is attributable and tamper-proof. contentHash is the stale-guard: a decision aimed at
// a superseded plan is rejected. Each decision is written to the append-only access_audit log.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  decideCheckpoint,
  supabaseCheckpointStore,
} from "@/lib/sitemap/checkpoint";
import { CHECKPOINT_PHASES } from "@/lib/sitemap/types";

const bodySchema = z.object({
  shopId: z.string().uuid(),
  phase: z.enum(CHECKPOINT_PHASES),
  // The hash the approver is signing off — anchors the decision to a specific queued plan.
  contentHash: z.string().trim().min(1).max(128),
  decision: z.enum(["approved", "changes_requested"]),
  notes: z.string().trim().max(2000).nullish(),
});

/**
 * Resolve the acting superadmin's display name (profile, then auth email), so the audited
 * decision carries a real human, not a placeholder. Returns null only when neither is set.
 */
async function resolveActorName(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await service
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const name = (profile?.display_name as string | null)?.trim();
  if (name) return name;
  const { data: authUser } = await service.auth.admin.getUserById(userId);
  return authUser?.user?.email ?? null;
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { shopId, phase, contentHash, decision } = parsed.data;
  const notes = parsed.data.notes ?? null;

  const service = createServiceClient();
  const decidedByName = await resolveActorName(service, gate.userId);

  const result = await decideCheckpoint(supabaseCheckpointStore(service), {
    shopId,
    phase,
    contentHash,
    decision,
    decidedByProfileId: gate.userId,
    decidedByName,
    notes,
    now: new Date().toISOString(),
  });

  switch (result.status) {
    case "stale":
      return NextResponse.json(
        {
          error: "stale_checkpoint",
          message:
            "No pending checkpoint matches this content hash — the plan may have changed. " +
            "Re-run the pipeline and review the current plan before deciding.",
        },
        { status: 409 },
      );
    case "conflict":
      return NextResponse.json(
        {
          error: "already_decided",
          message: `This checkpoint is already ${result.record.status}; a settled gate can't be flipped here.`,
          checkpoint: publicView(result.record),
        },
        { status: 409 },
      );
    case "idempotent":
      // Already at this decision — no second write, no duplicate audit row.
      return NextResponse.json(
        { status: "idempotent", checkpoint: publicView(result.record) },
        { status: 200 },
      );
    case "decided": {
      await recordAuditEvent({
        actorProfileId: gate.userId,
        targetShopId: shopId,
        action: "sitemap.checkpoint",
        payload: { shopId, phase, decision, contentHash },
      });
      return NextResponse.json(
        { status: "decided", checkpoint: publicView(result.record) },
        { status: 200 },
      );
    }
  }
}

/** Approver-facing projection of a decided row (no internal-only fields beyond the decision). */
function publicView(rec: {
  phase: string;
  content_hash: string;
  status: string;
  decided_by_name: string | null;
  decided_at: string | null;
  notes: string | null;
}) {
  return {
    phase: rec.phase,
    contentHash: rec.content_hash,
    status: rec.status,
    decidedByName: rec.decided_by_name,
    decidedAt: rec.decided_at,
    notes: rec.notes,
  };
}
