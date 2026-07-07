"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renderMarkdown } from "@/lib/markdown/render";

// PSG-245 / Wave 2 (G-d) — one queued action awaiting review. Reject discards it
// (never publishes). PSG-768 (B3 + A1): approving is now a deliberate two-step act
// — "Approve & publish" opens a review-and-confirm step that shows the EXACT post
// (faithful sanitized Markdown) plus explicit "this publishes to the public now"
// language before anything reaches the public page. After the action the owner
// sees a clear success/failure banner: a failed publish is shown as failed and
// KEPT with a Retry (never reported as success, never silently dropped — A1),
// branching on the returned approval.status rather than merely res.ok.

export type ApprovalCardRow = {
  id: string;
  actionType: string;
  title: string;
  summary: string | null;
  status: string;
  proposedBy: string | null;
  createdAt: string;
  /** The EXACT text that will publish (from the action's payload). Rendered
   *  faithfully in the confirm step so the preview matches what posts. */
  previewBody: string | null;
  /** Set when the row arrives already failed (loaded from the queue) so the card
   *  opens straight into the failure banner + Retry. */
  publishError?: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  content: "Content",
  gbp_post: "Google post",
  review_reply: "Review reply",
  review_solicitation: "Review request",
};

/** Copy shown at the confirm step and in the outcome banner, per action type.
 *  Kept here (next to the UI) so it stays consistent; owner-facing wording. */
function publishCopy(actionType: string): {
  warning: string;
  cta: string;
  busyCta: string;
  successTitle: string;
  successBody: string;
} {
  switch (actionType) {
    case "gbp_post":
      return {
        warning:
          "This will post to your live Google Business page now. It will be visible to the public.",
        cta: "Confirm & publish",
        busyCta: "Publishing…",
        successTitle: "Published to your Google profile",
        successBody: "Your post is live on your Google Business page.",
      };
    case "review_solicitation":
      return {
        warning: "This will send this review request to the customer now.",
        cta: "Confirm & send",
        busyCta: "Sending…",
        successTitle: "Review request sent",
        successBody: "Your review request has gone out to the customer.",
      };
    default:
      return {
        warning: "This will publish this action now. It will be visible to the public.",
        cta: "Confirm & publish",
        busyCta: "Publishing…",
        successTitle: "Published",
        successBody: "Your action has been published.",
      };
  }
}

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

/** POST a decision route and return the parsed approval row. Throws on a
 *  transport/authorization failure (res not ok) — the DOWNSTREAM publish outcome
 *  is carried in the 200 body's approval.status and branched on by the caller. */
async function postDecision(url: string, body?: unknown): Promise<{ status?: string; publish_error?: string | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    approval?: { status?: string; publish_error?: string | null };
  };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data.approval ?? {};
}

type Outcome =
  | { kind: "published" }
  | { kind: "approved" }
  | { kind: "rejected" }
  | { kind: "failed"; error: string | null };

export function ApprovalCard({ row }: { row: ApprovalCardRow }) {
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A row loaded already in publish_failed opens straight into the failure banner.
  const [outcome, setOutcome] = useState<Outcome | null>(
    row.status === "publish_failed" ? { kind: "failed", error: row.publishError ?? null } : null
  );

  const copy = publishCopy(row.actionType);
  const typeLabel = ACTION_LABELS[row.actionType] ?? humanizeActionType(row.actionType);
  const proposer = friendlyProposer(row.proposedBy);
  const previewText = row.previewBody ?? row.summary;

  // A1 — branch on the RETURNED approval.status (published vs publish_failed vs
  // approved), never merely on res.ok, so a failed publish is never shown as
  // success and never silently dropped.
  function applyResult(status: string | undefined, publishError: string | null | undefined) {
    if (status === "published") setOutcome({ kind: "published" });
    else if (status === "publish_failed")
      setOutcome({ kind: "failed", error: publishError ?? null });
    else if (status === "rejected") setOutcome({ kind: "rejected" });
    else setOutcome({ kind: "approved" }); // decision recorded, no publisher wired
  }

  async function confirmPublish() {
    setError(null);
    setBusy("approve");
    try {
      const approval = await postDecision(`/api/approvals/${row.id}/approve`, {
        notes: notes.trim() || undefined,
      });
      setConfirming(false);
      applyResult(approval.status, approval.publish_error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setError(null);
    setBusy("reject");
    try {
      const approval = await postDecision(`/api/approvals/${row.id}/reject`, {
        notes: notes.trim() || undefined,
      });
      applyResult(approval.status ?? "rejected", null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setError(null);
    setBusy("retry");
    try {
      const approval = await postDecision(`/api/approvals/${row.id}/retry`);
      applyResult(approval.status, approval.publish_error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry");
    } finally {
      setBusy(null);
    }
  }

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
        {outcome ? null : confirming ? (
          <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
            Publishes to the public
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Pending review
          </span>
        )}
      </div>

      {row.summary && !confirming && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{row.summary}</p>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {/* ---- Outcome banners (A1: honest success/failure, failure kept + retry) ---- */}
      {outcome?.kind === "published" && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3">
          <span aria-hidden className="mt-0.5 font-semibold text-green-700">✓</span>
          <div>
            <p className="text-sm font-medium text-green-800">{copy.successTitle}</p>
            <p className="text-sm text-green-700">{copy.successBody}</p>
          </div>
        </div>
      )}
      {outcome?.kind === "approved" && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3">
          <span aria-hidden className="mt-0.5 font-semibold text-green-700">✓</span>
          <p className="text-sm font-medium text-green-800">Approved.</p>
        </div>
      )}
      {outcome?.kind === "rejected" && (
        <div className="mt-4 rounded-md border border-border bg-muted p-3">
          <p className="text-sm text-muted-foreground">Rejected — discarded, nothing was published.</p>
        </div>
      )}
      {outcome?.kind === "failed" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 font-semibold text-red-700">!</span>
            <div>
              <p className="text-sm font-medium text-red-800">Publishing failed — not posted</p>
              <p className="text-sm text-red-700">
                Nothing went live. We kept it in your queue so you can try again.
                {outcome.error ? ` (${outcome.error})` : ""}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={retry}
              className="bg-green-600 hover:bg-green-700"
            >
              {busy === "retry" ? "Retrying…" : "Retry"}
            </Button>
          </div>
        </div>
      )}

      {/* ---- Confirm step: preview the exact post + explicit public warning ---- */}
      {!outcome && confirming && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Exactly what will post
          </p>
          <div className="mt-2 space-y-3 rounded-md border bg-card p-4">
            {previewText ? (
              renderMarkdown(previewText, "compact")
            ) : (
              <p className="text-sm text-muted-foreground">No preview content available.</p>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Rendered as it will appear — real formatting, not raw markup.
          </p>

          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-foreground">
              <strong className="font-semibold">{copy.warning}</strong>
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={confirmPublish}
              className="bg-green-600 hover:bg-green-700"
            >
              {busy === "approve" ? copy.busyCta : copy.cta}
            </Button>
          </div>
        </div>
      )}

      {/* ---- Idle controls: note + Approve (→ confirm) / Reject ---- */}
      {!outcome && !confirming && (
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

          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className="bg-green-600 hover:bg-green-700"
          >
            Approve &amp; publish…
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={reject}
            className="border-red-300 text-red-600 hover:bg-red-50"
          >
            {busy === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </div>
      )}
    </section>
  );
}
