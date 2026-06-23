// CCC Secure Share — Phase 3 approval queue: approve a pending connection. [PSG-267]
// POST { shopId? }. Superadmin-gated (mirrors /ops/intel — operator gate on a customer data
// pipe). Approve is rejected unless the row is linked to a PSGID (no orphan connections) — pass
// shopId to link an unmatched row in the same call. On success → connection_status=connected;
// the transition is written to the append-only access_audit log (ccc.connection.approve).
// No vendor spend.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  CccTransitionError,
  approveCccConnection,
} from "@/lib/ccc/approval-queue";
import { supabaseCccAccountStore } from "@/lib/ccc/account-store";

const bodySchema = z.object({
  shopId: z.string().uuid().nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  // Body is optional (a row already linked needs no shopId).
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
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
    const row = await approveCccConnection(store, {
      id,
      actorProfileId: gate.userId,
      shopId: parsed.data.shopId ?? null,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: row.shop_id,
      action: "ccc.connection.approve",
      payload: {
        accountId: id,
        cccAccountId: row.ccc_account_id,
        facilityId: row.facility_id,
        status: row.connection_status,
        linkedShopId: row.shop_id,
      },
    });

    return NextResponse.json({ account: row }, { status: 200 });
  } catch (error) {
    if (error instanceof CccTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[ops/admin/integrations/ccc/approve]:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Failed to approve connection" }, { status: 500 });
  }
}
