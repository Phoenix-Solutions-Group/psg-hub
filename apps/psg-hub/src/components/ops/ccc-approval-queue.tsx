"use client";

// CCC Secure Share — Phase 3 approval queue (surface B, spec §4 B). [PSG-267]
// Client component over the superadmin page's server-read rows. Tabs (Pending / Connected /
// Errors / All); per-row Approve / Decline (reason required) / Revoke calling the
// /api/ops/admin/integrations/ccc/[id]/* routes. Approve is DISABLED until the row is linked to
// a shop (no orphan connections) — unmatched rows surface a shop-link picker that links + approves
// in one call. Mirrors approval-actions.tsx (fetch → router.refresh) + the §2 status badge from
// connection-state.ts.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CONNECTION_PRESENTATION,
  errorHint,
  type CccConnectionStatus,
} from "@/lib/ccc/connection-state";
import { MAX_DECLINE_REASON } from "@/lib/ccc/approval-queue";

export type ShopOption = { id: string; name: string };

export type CccQueueRowView = {
  id: string;
  shopId: string | null;
  shopName: string | null;
  cccAccountId: string;
  facilityId: string | null;
  connectionStatus: CccConnectionStatus;
  enabledAt: string | null;
  lastEventAt: string | null;
  lastEventLabel: string | null;
  declinedReason: string | null;
  errorReason: string | null;
};

type TabKey = "pending" | "connected" | "errors" | "all";

const TABS: { key: TabKey; label: string; match: (s: CccConnectionStatus) => boolean }[] = [
  { key: "pending", label: "Pending", match: (s) => s === "pending_review" },
  { key: "connected", label: "Connected", match: (s) => s === "connected" },
  { key: "errors", label: "Errors", match: (s) => s === "error" },
  { key: "all", label: "All", match: () => true },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CccApprovalQueue({
  rows,
  shops,
}: {
  rows: CccQueueRowView[];
  shops: ShopOption[];
}) {
  const [tab, setTab] = useState<TabKey>("pending");
  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { pending: 0, connected: 0, errors: 0, all: rows.length };
    for (const r of rows) {
      if (r.connectionStatus === "pending_review") c.pending++;
      else if (r.connectionStatus === "connected") c.connected++;
      else if (r.connectionStatus === "error") c.errors++;
    }
    return c;
  }, [rows]);

  const active = TABS.find((t) => t.key === tab)!;
  const visible = rows.filter((r) => active.match(r.connectionStatus));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 font-heading text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-ember text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No connections in this view.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <CccQueueRow key={row.id} row={row} shops={shops} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CccQueueRow({ row, shops }: { row: CccQueueRowView; shops: ShopOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [linkShopId, setLinkShopId] = useState<string>(row.shopId ?? "");

  const presentation = CONNECTION_PRESENTATION[row.connectionStatus];
  const isPending = row.connectionStatus === "pending_review";
  const isActive = row.connectionStatus === "connected" || row.connectionStatus === "error";
  const linkedShopId = row.shopId ?? (linkShopId || null);
  const canApprove = isPending && Boolean(linkedShopId);

  async function call(path: string, body?: Record<string, unknown>) {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch(`/api/ops/admin/integrations/ccc/${row.id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Request failed (${res.status})`);
    } catch {
      setError("Network error — please retry.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-sm font-semibold">
              {row.shopName ?? <span className="text-muted-foreground">(unmatched)</span>}
            </span>
            <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            CCC account {row.cccAccountId}
            {row.facilityId ? ` · facility #${row.facilityId}` : ""}
            {row.enabledAt ? ` · enabled ${fmtDate(row.enabledAt)}` : ""}
          </p>
          {row.connectionStatus === "declined" && row.declinedReason ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Declined: {row.declinedReason}
            </p>
          ) : null}
          {row.connectionStatus === "error" ? (
            <p className="mt-1 text-xs text-destructive">{errorHint(row.errorReason)}</p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          {isPending && !row.shopId ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Link to shop:
              <select
                value={linkShopId}
                onChange={(e) => setLinkShopId(e.target.value)}
                className="max-w-48 rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="">Select a shop…</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {isPending ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDeclining((v) => !v)}
                disabled={busy !== null}
                className="border-red-300 text-red-600 hover:bg-red-50"
              >
                Decline…
              </Button>
              <Button
                onClick={() => call("approve", linkedShopId ? { shopId: linkedShopId } : undefined)}
                disabled={busy !== null || !canApprove}
                className="bg-green-600 hover:bg-green-700"
                title={canApprove ? undefined : "Link this connection to a shop first"}
              >
                {busy === "approve" ? "Approving…" : "Approve connection"}
              </Button>
            </div>
          ) : null}

          {isActive ? (
            <Button
              variant="outline"
              onClick={() => call("revoke")}
              disabled={busy !== null}
              className="border-red-300 text-red-600 hover:bg-red-50"
            >
              {busy === "revoke" ? "Revoking…" : "Revoke"}
            </Button>
          ) : null}
        </div>
      </div>

      {declining ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_DECLINE_REASON))}
            placeholder="Reason for declining (shown to the shop)…"
            rows={2}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {reason.trim().length}/{MAX_DECLINE_REASON}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDeclining(false);
                  setReason("");
                }}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button
                onClick={() => call("decline", { reason: reason.trim() })}
                disabled={busy !== null || reason.trim().length === 0}
                className="border-red-300 text-red-600 hover:bg-red-50"
                variant="outline"
              >
                {busy === "decline" ? "Declining…" : "Confirm decline"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </li>
  );
}
