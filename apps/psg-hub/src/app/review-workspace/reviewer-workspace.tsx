"use client";

import { useMemo, useState } from "react";
import { CheckCircle, ExternalLink, Lock, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Workspace = {
  project: { id: string; title: string; status: string };
  round: { id: string; status: string };
  reviewer: { email: string; submittedAt: string | null; readOnly: boolean };
  documents: Array<{
    itemId: string;
    versionId: string;
    title: string;
    processingStatus: string;
    sectionTitle: string | null;
    originalFilename: string | null;
    contentType: string | null;
    previewUrl: string | null;
    generatedPagePath: string | null;
    proofUrl: string | null;
    proofContent: {
      eyebrow: string;
      headline: string;
      body: string;
      bullets: string[];
      cta: string;
      sourceUrl: string | null;
    } | null;
  }>;
  comments: Array<{ id: string; reviewItemId: string; versionId: string; body: string; pinNumber: number | null; draftStatus: string }>;
  decisions: Array<{ reviewItemId: string; versionId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

function canFrameProof(url: string | null): url is string {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isImageProof(contentType: string | null): boolean {
  return Boolean(contentType?.startsWith("image/"));
}

export function ReviewerWorkspace({ inviteToken }: { inviteToken: string }) {
  const [code, setCode] = useState("");
  const [sessionHash, setSessionHash] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [comment, setComment] = useState("Please update the offer on this page.");
  const [message, setMessage] = useState("The offer needs one wording update before approval.");
  const [decision, setDecision] = useState<"approved" | "changes_requested">("changes_requested");
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeDocument =
    workspace?.documents.find((doc) => `${doc.itemId}:${doc.versionId}` === selectedDocumentKey) ??
    workspace?.documents[0] ??
    null;
  const isReadOnly = Boolean(workspace?.reviewer.readOnly);
  const commentsForActiveDocument = useMemo(
    () => activeDocument && workspace
      ? workspace.comments.filter((item) => item.reviewItemId === activeDocument.itemId)
      : [],
    [activeDocument, workspace],
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
    if (!sessionHash || !activeDocument) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/bsm/review-workspace/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionHash,
          reviewItemId: activeDocument.itemId,
          versionId: activeDocument.versionId,
          body: comment,
          pinNumber: commentsForActiveDocument.length + 1,
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
      if (decision === "changes_requested" && workspace.comments.length === 0) {
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
      <main className="flex min-h-svh w-full flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Review link missing</CardTitle>
            <CardDescription>The private invitation token is required to open this review.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
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
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
          <section className="min-w-0 space-y-4">
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
                  <div className="min-h-64 rounded-lg border border-border bg-background p-4 sm:p-5">
                    <div className="max-w-3xl space-y-4">
                      <h2 className="font-heading text-xl font-semibold">Collision repair page proof</h2>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Review this proof for customer-facing accuracy. Private comments remain tied to
                        your invitation and are visible to PSG staff after submission.
                      </p>
                      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="min-w-0 rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Status</div>
                          <div className="break-words font-medium">{doc.processingStatus}</div>
                        </div>
                        <div className="min-w-0 rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Comments</div>
                          <div className="break-words font-medium">{workspace.comments.filter((item) => item.reviewItemId === doc.itemId).length}</div>
                        </div>
                        <div className="min-w-0 rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">Decision</div>
                          <div className="break-words font-medium">{workspace.decisions.find((item) => item.reviewItemId === doc.itemId)?.decision.replace("_", " ") ?? "Open"}</div>
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-md border border-border bg-background">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {doc.originalFilename ?? doc.proofUrl ?? "Proof preview"}
                            </div>
                            {doc.contentType ? (
                              <div className="text-xs text-muted-foreground">{doc.contentType}</div>
                            ) : null}
                          </div>
                          {doc.proofUrl ? (
                            <a
                              href={doc.proofUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-medium text-ember hover:text-foreground"
                            >
                              <ExternalLink className="size-4" aria-hidden="true" />
                              Open proof
                            </a>
                          ) : null}
                        </div>
                        {doc.proofContent ? (
                          <article className="bg-white p-5 text-foreground sm:p-8">
                            <div className="text-xs font-semibold uppercase text-ember">
                              {doc.proofContent.eyebrow}
                            </div>
                            <h3 className="mt-2 font-heading text-2xl font-semibold">
                              {doc.proofContent.headline}
                            </h3>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                              {doc.proofContent.body}
                            </p>
                            {doc.proofContent.bullets.length ? (
                              <ul className="mt-4 space-y-2 text-sm">
                                {doc.proofContent.bullets.map((bullet) => (
                                  <li key={bullet} className="flex gap-2">
                                    <CheckCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                                    <span>{bullet}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            <div className="mt-5 inline-flex rounded-md bg-ember px-3 py-2 text-sm font-medium text-white">
                              {doc.proofContent.cta}
                            </div>
                          </article>
                        ) : isImageProof(doc.contentType) && doc.proofUrl ? (
                          <img
                            src={doc.proofUrl}
                            alt={`${doc.title} proof`}
                            className="max-h-[680px] w-full object-contain bg-white"
                          />
                        ) : canFrameProof(doc.proofUrl) ? (
                          <iframe
                            src={doc.proofUrl}
                            title={`${doc.title} proof`}
                            className="h-[680px] w-full bg-white"
                            sandbox=""
                          />
                        ) : (
                          <div className="p-4 text-sm text-muted-foreground">
                            The proof link is not available for this review item.
                          </div>
                        )}
                      </div>
                      {!isReadOnly ? (
                        <Button
                          type="button"
                          variant={`${doc.itemId}:${doc.versionId}` === `${activeDocument?.itemId}:${activeDocument?.versionId}` ? "default" : "outline"}
                          className="mt-4"
                          onClick={() => setSelectedDocumentKey(`${doc.itemId}:${doc.versionId}`)}
                        >
                          <MessageSquare className="size-4" aria-hidden="true" />
                          Comment on this document
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          <aside className="min-w-0 space-y-4">
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
                      <div className="text-xs text-muted-foreground">
                        Applies to {activeDocument?.title ?? "the selected document"}
                      </div>
                      <textarea
                        id="private-comment"
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={saveComment} disabled={pending || !activeDocument}>
                      <MessageSquare className="size-4" aria-hidden="true" />
                      Add suggestion
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
