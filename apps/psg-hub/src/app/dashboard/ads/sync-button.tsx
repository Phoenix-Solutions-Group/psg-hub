"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatSyncErrors } from "@/lib/ads/campaigns-client";

type Campaign = { id: string; name: string };
type Props = { shopId: string; campaigns: Campaign[] };
type Status =
  | { kind: "idle" }
  | { kind: "status"; message: string }
  | { kind: "alert"; message: string };

export function SyncButton({ shopId, campaigns }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function onClick() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await fetch("/api/ads/google/campaigns/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 200) {
        router.refresh();
        const count = Array.isArray(data.synced) ? data.synced.length : 0;
        setStatus({ kind: "status", message: `Synced ${count} campaigns.` });
        return;
      }

      if (res.status === 207) {
        router.refresh();
        const synced = Array.isArray(data.synced) ? data.synced.length : 0;
        const errors = Array.isArray(data.errors) ? data.errors : [];
        const total = synced + errors.length;
        const names = formatSyncErrors(errors, campaigns);
        setStatus({
          kind: "status",
          message: `Synced ${synced} of ${total}. ${errors.length} failed: ${names.join("; ")}`,
        });
        return;
      }

      const message =
        typeof data.error === "string"
          ? data.error
          : `Sync failed (${res.status})`;
      setStatus({ kind: "alert", message });
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={onClick} disabled={pending} variant="outline">
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      <div
        role={status.kind === "alert" ? "alert" : "status"}
        aria-live="polite"
        className={
          status.kind === "alert"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
        }
      >
        {status.kind === "idle" ? "" : status.message}
      </div>
    </div>
  );
}
