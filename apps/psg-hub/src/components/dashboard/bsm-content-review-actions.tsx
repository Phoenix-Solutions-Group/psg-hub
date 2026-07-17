"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  reviewItemId: string;
  restoreVersionId: string | null;
};

async function postJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function BsmContentReviewActions({ reviewItemId, restoreVersionId }: Props) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [restoreReason, setRestoreReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: string, fn: () => Promise<unknown>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
      if (action === "comment") setComment("");
      if (action === "restore") setRestoreReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 rounded-lg border border-border p-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="bsm-comment">
          Comment
        </label>
        <Input
          id="bsm-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Add feedback for PSG"
        />
        <Button
          size="sm"
          disabled={busy !== null || !comment.trim()}
          onClick={() =>
            run("comment", () =>
              postJson(`/api/bsm/content-approvals/${reviewItemId}/comments`, {
                body: comment,
              }),
            )
          }
        >
          {busy === "comment" ? "Adding..." : "Add comment"}
        </Button>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <label className="text-sm font-medium" htmlFor="bsm-decision-note">
          Decision note
        </label>
        <Input
          id="bsm-decision-note"
          value={decisionNote}
          onChange={(event) => setDecisionNote(event.target.value)}
          placeholder="Optional note"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            disabled={busy !== null}
            onClick={() =>
              run("approve", () =>
                postJson(`/api/bsm/content-approvals/${reviewItemId}/decision`, {
                  decision: "approve",
                  message: decisionNote,
                }),
              )
            }
          >
            {busy === "approve" ? "Approving..." : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              run("updates", () =>
                postJson(`/api/bsm/content-approvals/${reviewItemId}/decision`, {
                  decision: "request_updates",
                  message: decisionNote,
                }),
              )
            }
          >
            {busy === "updates" ? "Sending..." : "Request updates"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 text-red-600 hover:bg-red-50"
            disabled={busy !== null}
            onClick={() =>
              run("decline", () =>
                postJson(`/api/bsm/content-approvals/${reviewItemId}/decision`, {
                  decision: "decline",
                  message: decisionNote,
                }),
              )
            }
          >
            {busy === "decline" ? "Declining..." : "Decline"}
          </Button>
        </div>
      </div>

      {restoreVersionId && (
        <div className="space-y-2 border-t border-border pt-4">
          <label className="text-sm font-medium" htmlFor="bsm-restore-reason">
            Restore request
          </label>
          <Input
            id="bsm-restore-reason"
            value={restoreReason}
            onChange={(event) => setRestoreReason(event.target.value)}
            placeholder="Why restore this version?"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !restoreReason.trim()}
            onClick={() =>
              run("restore", () =>
                postJson(`/api/bsm/content-approvals/${reviewItemId}/restore-requests`, {
                  versionId: restoreVersionId,
                  reason: restoreReason,
                }),
              )
            }
          >
            {busy === "restore" ? "Requesting..." : "Request restore"}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
