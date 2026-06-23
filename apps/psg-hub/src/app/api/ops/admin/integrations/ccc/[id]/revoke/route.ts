// CCC Secure Share — Phase 3 approval queue: revoke an active/errored connection. [PSG-267]
// POST {}. Superadmin-gated. Revoke moves connected|error → not_connected (stops new events; no
// data deleted — spec §3.4). Credential teardown is owned by Phase 1/2. Written to access_audit
// (ccc.connection.revoke). No vendor spend.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/auth/ops-access";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  CccTransitionError,
  revokeCccConnection,
} from "@/lib/ccc/approval-queue";
import { supabaseCccAccountStore } from "@/lib/ccc/account-store";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSuperadmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const store = supabaseCccAccountStore(createServiceClient());
  try {
    const row = await revokeCccConnection(store, {
      id,
      actorProfileId: gate.userId,
      now: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorProfileId: gate.userId,
      targetShopId: row.shop_id,
      action: "ccc.connection.revoke",
      payload: {
        accountId: id,
        cccAccountId: row.ccc_account_id,
        facilityId: row.facility_id,
        status: row.connection_status,
      },
    });

    return NextResponse.json({ account: row }, { status: 200 });
  } catch (error) {
    if (error instanceof CccTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error(
      "[ops/admin/integrations/ccc/revoke]:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Failed to revoke connection" }, { status: 500 });
  }
}
