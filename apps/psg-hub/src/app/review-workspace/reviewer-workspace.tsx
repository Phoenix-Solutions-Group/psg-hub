"use client";

import { useMemo, useState } from "react";
import { CheckCircle, Lock, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Workspace = {
  project: { id: string; title: string; status: string };
  round: { id: string; status: string };
  reviewer: { email: string; submittedAt: string | null; readOnly: boolean };
  documents: Array<{ itemId: string; versionId: string; title: string; processingStatus: string; sectionTitle: string | null }>;
  comments: Array<{ id: string; reviewItemId: string; versionId: string; body: string; pinNumber: number | null; draftStatus: string }>;
  decisions: Array<{ reviewItemId: string; versionId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

export function ReviewerWorkspace({ inviteToken }: { inviteToken: string }) {
  const [code, setCode] = useState("");
  const [sessionHash, setSessionHash] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [comment, setComment] = useState("Please update the offer on this page.");
  const [message, setMessage] = useState("The offer needs one wording update before approval.");
  const [decision, setDecision] = useState<"approved" | "changes_requested">("changes_requested");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstDocument = workspace?.documents[0] ?? null;
  const isReadOnly = Boolean(workspace?.reviewer.readOnly);
  const commentsForFirstDocument = useMemo(
    () => firstDocument && workspace
      ? workspace.comments.filter((item) => item.reviewItemId === firstDocument.itemId)
      : [],
    [firstDocument, workspace],
  );

  async function verifyInvite() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/bsm/review-workspace/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken, code, deviceLabel: "Playwright QA browser" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not verify this review code.");
      setSessionHash(body.session.sessionHash);
      await loadWorkspace(body.session.sessionHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify this review code.");
    } finally {
      setPending(false);
    }
  }

  async function loadWorkspace(hash = sessionHash) {
    if (!hash) return;
    const res = await fetch("/api/bsm/review-workspace/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionHash: hash }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? "Could not load this review workspace.");
    setWorkspace(body.workspace);
  }

  async function saveComment() {
    if (!sessionHash || !firstDocument) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/bsm/review-workspace/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionHash,
          reviewItemId: firstDocument.itemId,
          versionId: firstDocument.versionId,
          body: comment,
          pinNumber: commentsForFirstDocument.length + 1,
          viewport: window.innerWidth < 700 ? "mobile" : "desktop",
          xRatio: 0.5,
          yRatio: 0.42,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not save this private comment.");
      await loadWorkspace(sessionHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this private comment.");
    } finally {
      setPending(false);
    }
  }

  async function submitReview() {
    if (!sessionHash || !workspace) return;
    setPending(true);
    setError(null);
    try {
      if (decision === "changes_requested" && commentsForFirstDocument.length === 0) {
        throw new Error("Add at least one private comment before requesting changes.");
      }
      const res = await fetch("/api/bsm/review-workspace/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionHash,
          decisions: workspace.documents.map((doc) => ({
            reviewItemId: doc.itemId,
            versionId: doc.versionId,
            decision,
            message: decision === "changes_requested" ? message : null,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not submit this review.");
      await loadWorkspace(sessionHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit this review.");
    } finally {
      setPending(false);
    }
  }

  if (!inviteToken) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Review link missing</CardTitle>
          <CardDescription>The private invitation token is required to open this review.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-10">
      <header className="border-b border-border pb-5">
        <div className="text-xs font-medium uppercase text-muted-foreground">Body Shop Marketer Review</div>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {workspace?.project.title ?? "Enter your review code"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          This private review is for checking PSG-prepared content before it is used.
        </p>
      </header>

      {!workspace ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Secure access</CardTitle>
            <CardDescription>Enter the one-time code from the internal QA invite.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="review-code">One-time code</Label>
              <Input id="review-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} />
            </div>
            {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
            <Button type="button" onClick={verifyInvite} disabled={pending || code.length < 4}>
              <CheckCircle className="size-4" aria-hidden="true" />
              Open review
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="space-y-4">
            {workspace.documents.map((doc) => (
              <Card key={doc.itemId}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{doc.title}</CardTitle>
                      <CardDescription>{doc.sectionTitle ?? "Review document"} · {doc.processingStatus}</CardDescription>
                    </div>
                    <Badge>{workspace.round.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="min-h-64 rounded-lg border border-border bg-background p-5">
                    <div className="max-w-2xl space-y-4">
                      <h2 className="font-heading text-xl font-semibold">Collision repair page proof</h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Review this proof for customer-facing accuracy. Private comments remain tied to
                        your invitation and are visible to PSG staff after submission.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Status</div>
                          <div className="font-medium">{doc.processingStatus}</div>
                        </div>
                        <div className="rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Comments</div>
                          <div className="font-medium">{workspace.comments.filter((item) => item.reviewItemId === doc.itemId).length}</div>
                        </div>
                        <div className="rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Decision</div>
                          <div className="font-medium">{workspace.decisions.find((item) => item.reviewItemId === doc.itemId)?.decision.replace("_", " ") ?? "Open"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{isReadOnly ? "Submitted review" : "Your review"}</CardTitle>
                <CardDescription>
                  {isReadOnly ? "Your response is locked and can no longer be changed." : "Choose a decision and add private notes where needed."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isReadOnly ? (
                  <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <Lock className="size-4" aria-hidden="true" />
                      Read-only after submit
                    </div>
                    <p className="mt-1 text-muted-foreground">Submitted by {workspace.reviewer.email}</p>
                  </div>
                ) : (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="font-heading text-sm font-medium">Decision</legend>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="decision" checked={decision === "approved"} onChange={() => setDecision("approved")} />
                        Approve
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="decision" checked={decision === "changes_requested"} onChange={() => setDecision("changes_requested")} />
                        Request changes
                      </label>
                    </fieldset>
                    <div className="space-y-2">
                      <Label htmlFor="private-comment">Private comment</Label>
                      <textarea
                        id="private-comment"
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={saveComment} disabled={pending || !firstDocument}>
                      <MessageSquare className="size-4" aria-hidden="true" />
                      Add private comment
                    </Button>
                    <div className="space-y-2">
                      <Label htmlFor="submit-message">Decision note</Label>
                      <textarea
                        id="submit-message"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <Button type="button" onClick={submitReview} disabled={pending}>
                      <Send className="size-4" aria-hidden="true" />
                      Submit review
                    </Button>
                  </>
                )}
                {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Private comments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {workspace.comments.length ? workspace.comments.map((item) => (
                  <div key={item.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="font-medium">Pin {item.pinNumber ?? "-"}</div>
                    <p className="mt-1">{item.body}</p>
                    <div className="mt-1 text-xs text-muted-foreground">{item.draftStatus}</div>
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground">No private comments yet.</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
