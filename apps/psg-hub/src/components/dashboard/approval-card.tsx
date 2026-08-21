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

function actionPresentation(actionType: string) {
  switch (actionType) {
    case "gbp_post":
      return {
        typeLabel: "Google Business Profile post",
        previewLabel: "Post preview",
        confirmation: "Your confirmation will publish this post on Google now. Customers may see it immediately.",
        finalLabel: "Approve and publish on Google",
      };
    case "review_solicitation":
      return {
        typeLabel: "Customer review request",
        previewLabel: "Message preview",
        confirmation: "Your confirmation will send this review request now using the channels shown above.",
        finalLabel: "Approve and send request",
      };
    case "review_reply":
      return {
        typeLabel: "Public review response",
        previewLabel: "Response preview",
        confirmation: "Your confirmation will approve this response for PSG to publish separately.",
        finalLabel: "Approve response",
      };
    case "content":
      return {
        typeLabel: "Content",
        previewLabel: "Content preview",
        confirmation: "Your confirmation will approve this content for PSG to publish separately.",
        finalLabel: "Approve content",
      };
    default:
      return {
        typeLabel: humanizeActionType(actionType),
        previewLabel: "Action preview",
        confirmation: "Your confirmation will record approval for the action shown above.",
        finalLabel: "Approve action",
      };
  }
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
  const [step, setStep] = useState<"preview" | "confirm">("preview");

  async function decide(action: "approve" | "reject") {
    setError(null);
    setBusy(action);
    try {
      const result = (await postJson(`/api/approvals/${row.id}/${action}`, {
        notes: notes.trim() || undefined,
      })) as { approval?: { status?: string; publish_error?: string | null } };
      if (result.approval?.status === "publish_failed") {
        setStep("preview");
        setError(result.approval.publish_error || "Publishing failed. Review the request and try again.");
        router.refresh();
      } else {
        router.push("/dashboard/approvals?view=history");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(null);
    }
  }

  const presentation = actionPresentation(row.actionType);
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
  const solicitationDraft =
    row.actionType === "review_solicitation" &&
    typeof row.payload.draft === "object" &&
    row.payload.draft !== null
      ? (row.payload.draft as Record<string, unknown>)
      : null;
  const emailDraft =
    typeof solicitationDraft?.email === "object" && solicitationDraft.email !== null
      ? (solicitationDraft.email as Record<string, unknown>)
      : null;
  const smsDraft =
    typeof solicitationDraft?.sms === "object" && solicitationDraft.sms !== null
      ? (solicitationDraft.sms as Record<string, unknown>)
      : null;
  const emailSubject = typeof emailDraft?.subject === "string" ? emailDraft.subject : null;
  const emailText = typeof emailDraft?.text === "string" ? emailDraft.text : null;
  const smsBody = typeof smsDraft?.body === "string" ? smsDraft.body : null;

  return (
    <section className="rounded-lg border border-border p-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">{row.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{presentation.typeLabel}</span>
            {proposer ? ` · proposed by ${proposer}` : ""}
            {` · ${new Date(row.createdAt).toLocaleString()}`}
          </p>
        </div>
        <span
          className={
            isFailedPublish
              ? "whitespace-nowrap rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800"
              : "whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
          }
        >
          {isFailedPublish ? "Publish failed" : "Needs decision"}
        </span>
      </div>

      {row.summary && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">{row.summary}</p>
      )}

      {isFailedPublish && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">This was approved, but the action did not complete.</p>
          <p className="mt-1">
            {row.publishError || "The publish attempt failed. You can review it and retry."}
          </p>
        </div>
      )}

      <div className="mt-4 rounded-md border border-border bg-muted/40 p-4">
        <p className="font-heading text-sm font-medium text-muted-foreground">
          {presentation.previewLabel}
        </p>
        <div className="mt-2 rounded-md border border-border bg-background p-3">
          <p className="font-medium">{row.title}</p>
          {emailText && (
            <div className="mt-2 border-t border-border pt-3">
              <p className="font-heading text-xs font-medium text-muted-foreground">Email</p>
              {emailSubject && <p className="mt-1 font-medium">Subject: {emailSubject}</p>}
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{emailText}</p>
            </div>
          )}
          {smsBody && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="font-heading text-xs font-medium text-muted-foreground">Text message</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{smsBody}</p>
            </div>
          )}
          {!emailText && !smsBody && publishCopy && (
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
            {isFailedPublish
              ? "This action was already approved. Confirm to retry the failed publish now."
              : presentation.confirmation}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Check the exact content above before continuing.
          </p>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="text-xs text-muted-foreground" htmlFor={`notes-${row.id}`}>
            Note for PSG (optional)
          </label>
          <Input
            id={`notes-${row.id}`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add context for this decision"
            className="h-11 w-full sm:w-64"
          />
        </div>

        {step === "preview" && (
          <Button
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setStep("confirm");
            }}
            className="min-h-11 w-full sm:w-auto"
          >
            {isFailedPublish ? "Continue to retry" : "Continue to confirmation"}
          </Button>
        )}

        {step === "confirm" && (
          <Button
            disabled={busy !== null}
            onClick={() => decide("approve")}
            className="min-h-11 w-full bg-ember text-white hover:bg-ember/90 sm:w-auto"
          >
            {busy === "approve"
              ? isFailedPublish
                ? "Retrying…"
                : "Publishing…"
              : isFailedPublish
                ? "Retry publish now"
                : presentation.finalLabel}
          </Button>
        )}

        {step === "confirm" && (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => setStep("preview")}
            className="min-h-11 w-full sm:w-auto"
          >
            Back to preview
          </Button>
        )}

        {!isFailedPublish && (
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => decide("reject")}
            className="min-h-11 w-full border-red-300 text-red-600 hover:bg-red-50 sm:w-auto"
          >
            {busy === "reject" ? "Rejecting…" : "Reject request"}
          </Button>
        )}
      </div>
    </section>
  );
}
