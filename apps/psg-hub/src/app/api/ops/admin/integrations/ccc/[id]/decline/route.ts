// CCC Secure Share — Phase 3 approval queue: decline a pending connection. [PSG-267]
// POST { reason }. Superadmin-gated. Reason is REQUIRED (≤280 chars) — it is shown to the shop
// (spec §3.2). On success → connection_status=declined; written to access_audit
// (ccc.connection.decline). No vendor spend.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  CccTransitionError,
  MAX_DECLINE_REASON,
  declineCccConnection,
} from "@/lib/ccc/approval-queue";
import { supabaseCccAccountStore } from "@/lib/ccc/account-store";

const bodySchema = z.object({
  reason: z.string().trim().min(1, "A decline reason is required").max(MAX_DECLINE_REASON),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const store = supabaseCccAccountStore(createServiceClient());
  try {
    const row = await declineCccConnection(store, {
      id,
      actorProfileId: gate.userId,
      reason: parsed.data.reason,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: row.shop_id,
      action: "ccc.connection.decline",
      payload: {
        accountId: id,
        cccAccountId: row.ccc_account_id,
        facilityId: row.facility_id,
        status: row.connection_status,
        reason: row.declined_reason,
      },
    });

    return NextResponse.json({ account: row }, { status: 200 });
  } catch (error) {
    if (error instanceof CccTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[ops/admin/integrations/ccc/decline]:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Failed to decline connection" }, { status: 500 });
  }
}
