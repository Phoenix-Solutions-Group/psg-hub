"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// PSG-217 / PSG-115b — per-template gate card. Renders the proof (merged HTML +
// missing-token report) and drives the gated routes: approve (named sign-off),
// release (→ eligible for live batches), revoke, and a Lob test-mode seed test.
// Server data re-fetches via router.refresh() after each mutation.

export type TemplateGateRow = {
  key: string;
  label: string;
  pieceType: string;
  templateSize?: string;
  contentHash: string;
  missingTokens: string[];
  status: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  eligibleForLiveBatch: boolean;
};

async function postJson(url: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function StatusBadge({ row }: { row: TemplateGateRow }) {
  const { label, className } = row.eligibleForLiveBatch
    ? { label: "Released · live-eligible", className: "bg-emerald-100 text-emerald-800" }
    : row.status === "released"
      ? { label: "Released (stale)", className: "bg-amber-100 text-amber-800" }
      : row.status === "approved"
        ? { label: "Approved — not released", className: "bg-sky-100 text-sky-800" }
        : row.status === "revoked"
          ? { label: "Revoked", className: "bg-rose-100 text-rose-800" }
          : { label: "Draft — not approved", className: "bg-muted text-muted-foreground" };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>
  );
}

export function TemplateGateCard({ row }: { row: TemplateGateRow }) {
  const router = useRouter();
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selfMailerSize, setSelfMailerSize] = useState(row.templateSize ?? "6x18_bifold");
  const [showProof, setShowProof] = useState(false);

  const canPickSelfMailerSize = row.pieceType === "self_mailer";
  const selfMailerSizes = [
    "6x18_bifold",
    "11x9_bifold",
    "12x9_bifold",
    "17.75x9_trifold",
  ] as const;

  const base = `/api/ops/production/templates/${row.key}`;

  async function run(action: string, fn: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    setBusy(action);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">{row.label}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.pieceType} · <code className="text-[11px]">{row.contentHash.slice(0, 12)}…</code>
          </p>
        </div>
        <StatusBadge row={row} />
      </div>

      {row.approvedByName && (
        <p className="mt-2 text-xs text-muted-foreground">
          Approved by <span className="font-medium">{row.approvedByName}</span>
          {row.approvedAt ? ` on ${new Date(row.approvedAt).toLocaleString()}` : ""}
          {row.releasedAt ? ` · released ${new Date(row.releasedAt).toLocaleString()}` : ""}
        </p>
      )}

      {/* Missing-token report. */}
      {row.missingTokens.length > 0 ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {row.missingTokens.length} unresolved{" "}
          {row.missingTokens.length === 1 ? "token" : "tokens"} on sample data:{" "}
          <code>{row.missingTokens.join(", ")}</code>
        </p>
      ) : (
        <p className="mt-3 text-xs text-emerald-700">
          All merge tokens resolve on sample data.
        </p>
      )}

      {/* Proof preview. */}
      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowProof((s) => !s)}
        >
          {showProof ? "Hide proof" : "View proof"}
        </Button>
        {showProof && (
          <iframe
            title={`${row.label} proof`}
            src={`${base}/proof?format=html`}
            className="mt-3 h-[520px] w-full rounded-md border border-border bg-white"
          />
        )}
      </div>

      {canPickSelfMailerSize && (
        <div className="mt-3">
          <label className="text-xs text-muted-foreground" htmlFor={`size-${row.key}`}>
            Self-mailer size
          </label>
          <select
            id={`size-${row.key}`}
            className="mt-1 h-9 rounded-md border border-border bg-background px-3 text-sm"
            value={selfMailerSize}
            onChange={(event) => setSelfMailerSize(event.target.value)}
          >
            {selfMailerSizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-ember">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-700">{notice}</p>}

      {/* Workflow actions. */}
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor={`approver-${row.key}`}>
            Approver (named sign-off)
          </label>
          <Input
            id={`approver-${row.key}`}
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Your name"
            className="h-9 w-48"
          />
        </div>

        <Button
          size="sm"
          disabled={busy !== null || approver.trim().length === 0 || row.status === "released"}
          onClick={() =>
            run("approve", () =>
              postJson(`${base}/approve`, {
                approverName: approver.trim(),
                contentHash: row.contentHash,
              })
            )
          }
        >
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>

        <Button
          size="sm"
          disabled={busy !== null || row.status !== "approved"}
          onClick={() =>
            run("release", () =>
              postJson(`${base}/release`, { contentHash: row.contentHash })
            )
          }
        >
          {busy === "release" ? "Releasing…" : "Release for live"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || (row.status !== "approved" && row.status !== "released")}
          onClick={() =>
            run("revoke", () =>
              postJson(`${base}/revoke`, { contentHash: row.contentHash })
            )
          }
        >
          {busy === "revoke" ? "Revoking…" : "Revoke"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            run("seed-test", async () => {
              const body = canPickSelfMailerSize ? { size: selfMailerSize } : undefined;
              await postJson(`${base}/seed-test`, body);
              setNotice("Seed test submitted to Lob test mode (free, not mailed).");
            })
          }
        >
          {busy === "seed-test" ? "Sending…" : "Seed test (Lob test mode)"}
        </Button>
      </div>
    </section>
  );
}
