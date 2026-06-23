import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOpsAccess } from "@/lib/auth/ops-access";
import { supabaseCccAccountStore } from "@/lib/ccc/account-store";
import {
  CccApprovalQueue,
  type CccQueueRowView,
  type ShopOption,
} from "@/components/ops/ccc-approval-queue";

// CCC Secure Share — Phase 3 approval queue (surface B, spec §1/§4 B). [PSG-267]
// Superadmin-only to MATCH /ops/intel — the operator gate on a customer data pipe sits at
// psg_superadmin, not a per-capability flag. The page lists ccc_accounts via the service client
// (the queue is cross-shop, so it reads ALL rows; access control is this gate, mirroring intel)
// and hands them to the client queue, which calls the approve/decline/revoke routes.
//
// runtime=nodejs: the store + shop listing both use the server-only service client.
export const runtime = "nodejs";

export default async function CccConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getOpsAccess(user.id);
  if (access.role !== "psg_superadmin") {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border p-6">
        <h1 className="font-heading text-lg font-semibold">CCC Connections</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is restricted to superadmins.
        </p>
      </div>
    );
  }

  const service = createServiceClient();
  const store = supabaseCccAccountStore(service);

  // The queue degrades safely if the Phase-3 migration is not yet applied in this environment
  // (operator gate): a missing column surfaces as a store error → render an empty queue with a
  // notice rather than a 500.
  let rows: CccQueueRowView[] = [];
  let storeError: string | null = null;
  try {
    const accounts = await store.list();
    const shopIds = [...new Set(accounts.map((a) => a.shop_id).filter(Boolean) as string[])];
    const shopNames = await resolveShopNames(service, shopIds);
    rows = accounts.map((a) => ({
      id: a.id,
      shopId: a.shop_id,
      shopName: a.shop_id ? (shopNames.get(a.shop_id) ?? null) : null,
      cccAccountId: a.ccc_account_id,
      facilityId: a.facility_id,
      connectionStatus: a.connection_status,
      enabledAt: a.enabled_at,
      lastEventAt: a.last_event_at,
      lastEventLabel: a.last_event_label,
      declinedReason: a.declined_reason,
      errorReason: a.error_reason,
    }));
  } catch (error) {
    storeError =
      "The CCC connection store is unavailable — the Phase-3 migration may not be applied in this environment.";
    console.error(
      "[ops/admin/integrations/ccc] list failed:",
      error instanceof Error ? error.message : error,
    );
  }

  const shops = await listShops(service);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          CCC Secure Share — Connections
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve, decline, or revoke shop connections to the CCC ONE Secure Share feed. A
          connection must be linked to a shop before it can be approved — no orphan connections.
        </p>
      </div>
      {storeError ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
          {storeError}
        </div>
      ) : (
        <CccApprovalQueue rows={rows} shops={shops} />
      )}
    </div>
  );
}

/** Resolve the linked shops' display names for the queue rows. Service-role read. */
async function resolveShopNames(
  service: ReturnType<typeof createServiceClient>,
  shopIds: string[],
): Promise<Map<string, string>> {
  if (shopIds.length === 0) return new Map();
  const { data } = await service.from("shops").select("id, name").in("id", shopIds);
  return new Map(
    (data ?? []).map((s) => [s.id as string, ((s.name as string) ?? "").trim() || (s.id as string)]),
  );
}

/** Shops available to link an unmatched connection to (spec §4 B). Service-role read. */
async function listShops(service: ReturnType<typeof createServiceClient>): Promise<ShopOption[]> {
  const { data } = await service
    .from("shops")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(500);
  return (data ?? [])
    .map((s) => ({ id: s.id as string, name: ((s.name as string) ?? "").trim() || (s.id as string) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
