"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// PSG-245 / Wave 2 (G-d) — one queued action awaiting review. Approve publishes
// the action through its registered publisher; reject discards it (never
// publishes). Both call the role-gated decision routes and re-fetch via
// router.refresh(). Generic over action_type so content / GBP posts / review
// replies all render through the same card.

export type ApprovalCardRow = {
  id: string;
  actionType: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  status: string;
  proposedBy: string | null;
  createdAt: string;
  publishError: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  content: "Content",
  gbp_post: "Google post",
  review_reply: "Review reply",
};

/** Title-cased, space-separated fallback so an unlabelled action_type (e.g. a
 * new publisher landing before its label) degrades to "Seo Meta", never raw
 * snake_case. */
function humanizeActionType(type: string): string {
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// A UUID/opaque slug is not a friendly thing to show a shop owner; only render
// the "proposed by" clause when it looks like a human/source name.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function friendlyProposer(proposedBy: string | null): string | null {
  if (!proposedBy) return null;
  const trimmed = proposedBy.trim();
  if (!trimmed || UUID_RE.test(trimmed)) return null;
  return trimmed;
}

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

export function ApprovalCard({ row }: { row: ApprovalCardRow }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "preview" | "confirm">("idle");

  async function decide(action: "approve" | "reject") {
    setError(null);
    setBusy(action);
    try {
      await postJson(`/api/approvals/${row.id}/${action}`, {
        notes: notes.trim() || undefined,
      });
      setStep("idle");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  const typeLabel = ACTION_LABELS[row.actionType] ?? humanizeActionType(row.actionType);
  const proposer = friendlyProposer(row.proposedBy);
  const isFailedPublish = row.status === "publish_failed";
  const publishCopy =
    typeof row.payload.summary === "string" && row.payload.summary.trim()
      ? row.payload.summary.trim()
      : row.summary;
  const callToAction =
    typeof row.payload.callToAction === "object" && row.payload.callToAction !== null
      ? (row.payload.callToAction as Record<string, unknown>)
      : null;
  const ctaLabel =
    typeof callToAction?.actionType === "string"
      ? callToAction.actionType.replace(/_/g, " ").toLowerCase()
      : null;
  const ctaUrl = typeof callToAction?.url === "string" ? callToAction.url : null;

  return (
    <section className="rounded-lg border border-border p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">{row.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{typeLabel}</span>
            {proposer ? ` · proposed by ${proposer}` : ""}
            {` · ${new Date(row.createdAt).toLocaleString()}`}
          </p>
        </div>
        <span
          className={
            isFailedPublish
              ? "rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800"
              : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
          }
        >
          {isFailedPublish ? "Publish failed" : "Pending review"}
        </span>
      </div>

      {row.summary && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{row.summary}</p>
      )}

      {isFailedPublish && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">This was approved, but Google did not publish it.</p>
          <p className="mt-1">
            {row.publishError || "The publish attempt failed. You can review it and retry."}
          </p>
        </div>
      )}

      {step !== "idle" && (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Google public post preview
          </p>
          <div className="mt-2 rounded-md border border-border bg-background p-3">
            <p className="font-medium">{row.title}</p>
            {publishCopy && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{publishCopy}</p>
            )}
            {ctaLabel && (
              <p className="mt-2 text-xs text-muted-foreground">
                Button: {ctaLabel}
                {ctaUrl ? ` · ${ctaUrl}` : ""}
              </p>
            )}
          </div>
          {step === "confirm" ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Confirming will publish this publicly on Google now. Customers may see it
              immediately.
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Check the exact post above before continuing.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor={`notes-${row.id}`}>
            Decision note (optional)
          </label>
          <Input
            id={`notes-${row.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why approve / reject"
            className="h-9 w-64"
          />
        </div>

        {step === "idle" && (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setStep("preview");
            }}
          >
            {isFailedPublish ? "Review before retry" : "Preview post"}
          </Button>
        )}

        {step === "preview" && (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setStep("confirm");
            }}
            className="bg-green-600 hover:bg-green-700"
          >
            Continue to confirmation
          </Button>
        )}

        {step === "confirm" && (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => decide("approve")}
            className="bg-green-600 hover:bg-green-700"
          >
            {busy === "approve"
              ? isFailedPublish
                ? "Retrying…"
                : "Publishing…"
              : isFailedPublish
                ? "Confirm and retry publish"
                : "Confirm and publish publicly now"}
          </Button>
        )}

        {step !== "idle" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => setStep("idle")}
          >
            Back
          </Button>
        )}

        {!isFailedPublish && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => decide("reject")}
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        )}
      </div>
    </section>
  );
}
