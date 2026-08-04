"use client";

import { useMemo, useState } from "react";
import { CheckCircle, ExternalLink, FileText, ImageIcon, Lock, MessageSquare, Monitor, RotateCcw, Send } from "lucide-react";
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

function isPdfProof(contentType: string | null): boolean {
  return contentType === "application/pdf";
}

function isInlineFileProof(contentType: string | null): boolean {
  return contentType === "text/html" || contentType === "application/pdf";
}

function isGeneratedPageProof(doc: Workspace["documents"][number]): boolean {
  return doc.contentType === "generated_page" || Boolean(doc.generatedPagePath);
}

function guestFileUrl(sessionHash: string | null, doc: Workspace["documents"][number]): string | null {
  if (!sessionHash || !isInlineFileProof(doc.contentType)) return null;
  if (!doc.originalFilename) return null;
  const params = new URLSearchParams({
    sessionHash,
    reviewItemId: doc.itemId,
    versionId: doc.versionId,
  });
  return `/api/bsm/review-workspace/file?${params.toString()}`;
}

function documentKey(doc: Workspace["documents"][number]): string {
  return `${doc.itemId}:${doc.versionId}`;
}

function documentKindLabel(doc: Workspace["documents"][number]): string {
  if (isGeneratedPageProof(doc)) return "Generated page";
  if (doc.contentType === "application/pdf") return "PDF";
  if (doc.contentType === "text/html") return "Website proof";
  if (doc.proofContent) return "Page proof";
  if (isImageProof(doc.contentType)) return "Image";
  return doc.contentType ?? "Proof";
}

function statusLabel(value: string | null | undefined): string {
  return value?.replaceAll("_", " ") ?? "Open";
}

function proofLabel(doc: Workspace["documents"][number], proofUrl: string | null): string {
  if (doc.originalFilename) return doc.originalFilename;
  if (proofUrl) return proofUrl;
  if (doc.generatedPagePath) return doc.generatedPagePath;
  return "Proof preview";
}

function frameSandbox(doc: Workspace["documents"][number]): string | undefined {
  if (doc.contentType === "text/html") return "allow-popups allow-popups-to-escape-sandbox";
  if (isGeneratedPageProof(doc)) return "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
  return undefined;
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
    workspace?.documents.find((doc) => documentKey(doc) === selectedDocumentKey) ??
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

  async function reopenReview() {
    if (!sessionHash) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/bsm/review-workspace/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionHash }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not reopen this review.");
      await loadWorkspace(sessionHash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reopen this review.");
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
          Check each proof screen, add private comments to the selected item, then send one final decision.
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
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:items-start">
          <section className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Documents to review</CardTitle>
                    <CardDescription>
                      Choose one proof at a time. Comments and decisions stay tied to the selected document.
                    </CardDescription>
                  </div>
                  <Badge>{workspace.documents.length} {workspace.documents.length === 1 ? "document" : "documents"}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {workspace.documents.map((doc, index) => {
                    const key = documentKey(doc);
                    const isSelected = activeDocument ? key === documentKey(activeDocument) : index === 0;
                    const commentCount = workspace.comments.filter((item) => item.reviewItemId === doc.itemId).length;
                    const itemDecision = workspace.decisions.find((item) => item.reviewItemId === doc.itemId);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedDocumentKey(key)}
                        className={`min-h-28 rounded-md border p-3 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-accent text-accent-foreground"
                            : "border-border bg-background hover:border-primary/50"
                        }`}
                        aria-pressed={isSelected}
                      >
                        <div className="flex items-start gap-2">
                          {doc.proofContent ? (
                            <Monitor className="mt-0.5 size-4 shrink-0 text-ember" aria-hidden="true" />
                          ) : isImageProof(doc.contentType) ? (
                            <ImageIcon className="mt-0.5 size-4 shrink-0 text-ember" aria-hidden="true" />
                          ) : (
                            <FileText className="mt-0.5 size-4 shrink-0 text-ember" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">Document {index + 1}</div>
                            <div className="mt-1 line-clamp-2 font-medium">{doc.title}</div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>{documentKindLabel(doc)}</span>
                          <span>{commentCount} {commentCount === 1 ? "comment" : "comments"}</span>
                          <span>{statusLabel(itemDecision?.decision)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {activeDocument ? (
              <ProofCanvas
                doc={activeDocument}
                workspace={workspace}
                sessionHash={sessionHash}
                isReadOnly={isReadOnly}
                onSelectForComment={() => setSelectedDocumentKey(documentKey(activeDocument))}
              />
            ) : null}
          </section>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100svh-3rem)] xl:overflow-y-auto">
            <Card className="xl:sticky xl:top-6">
              <CardHeader>
                <CardTitle>{isReadOnly ? "Submitted review" : "Your review"}</CardTitle>
                <CardDescription>
                  {isReadOnly
                    ? "Your response is locked and can no longer be changed."
                    : `Reviewing: ${activeDocument?.title ?? "choose a document"}`}
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
                    {workspace.round.status === "active" || workspace.round.status === "inviting" ? (
                      <Button type="button" variant="outline" className="mt-3" onClick={reopenReview} disabled={pending}>
                        <RotateCcw className="size-4" aria-hidden="true" />
                        Reopen response
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="font-heading text-sm font-medium">Final decision</legend>
                      <p className="text-xs text-muted-foreground">This decision covers every proof in this review.</p>
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
                      <Label htmlFor="private-comment">Comment for selected proof</Label>
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
                      Add comment to selected proof
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

function ProofCanvas({
  doc,
  workspace,
  sessionHash,
  isReadOnly,
  onSelectForComment,
}: {
  doc: Workspace["documents"][number];
  workspace: Workspace;
  sessionHash: string | null;
  isReadOnly: boolean;
  onSelectForComment: () => void;
}) {
  const inlineFileUrl = guestFileUrl(sessionHash, doc);
  const generatedPreviewUrl = isGeneratedPageProof(doc)
    ? doc.previewUrl ?? (doc.proofUrl && doc.proofUrl !== doc.generatedPagePath ? doc.proofUrl : null)
    : null;
  const renderedProofUrl = inlineFileUrl ?? (isGeneratedPageProof(doc) ? generatedPreviewUrl : doc.previewUrl ?? doc.proofUrl);
  const documentComments = workspace.comments.filter((item) => item.reviewItemId === doc.itemId);
  const itemDecision = workspace.decisions.find((item) => item.reviewItemId === doc.itemId);
  const canShowGeneratedPreview = isGeneratedPageProof(doc) && canFrameProof(generatedPreviewUrl);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{doc.title}</CardTitle>
            <CardDescription>
              {doc.sectionTitle ?? documentKindLabel(doc)} · {statusLabel(doc.processingStatus)}
            </CardDescription>
          </div>
          <Badge>{statusLabel(workspace.round.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            <div className="min-w-0 rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Document status</div>
              <div className="break-words font-medium capitalize">{statusLabel(doc.processingStatus)}</div>
            </div>
            <div className="min-w-0 rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Private comments</div>
              <div className="break-words font-medium">{documentComments.length}</div>
            </div>
            <div className="min-w-0 rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Decision</div>
              <div className="break-words font-medium capitalize">{statusLabel(itemDecision?.decision)}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-background">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {proofLabel(doc, renderedProofUrl)}
                </div>
                <div className="text-xs text-muted-foreground">{documentKindLabel(doc)}</div>
              </div>
              {renderedProofUrl ? (
                <a
                  href={renderedProofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-ember hover:text-foreground"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Open proof
                </a>
              ) : null}
            </div>
            {canShowGeneratedPreview ? (
              <iframe
                src={generatedPreviewUrl ?? ""}
                title={`${doc.title} proof`}
                className="h-[720px] w-full bg-white"
                sandbox={frameSandbox(doc)}
              />
            ) : doc.proofContent ? (
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
            ) : isImageProof(doc.contentType) && renderedProofUrl ? (
              <img
                src={renderedProofUrl}
                alt={`${doc.title} proof`}
                className="max-h-[720px] w-full bg-white object-contain"
              />
            ) : isPdfProof(doc.contentType) && renderedProofUrl ? (
              <object
                data={renderedProofUrl}
                type="application/pdf"
                className="h-[720px] w-full bg-white"
                aria-label={`${doc.title} PDF proof`}
              >
                <div className="p-4 text-sm text-muted-foreground">
                  Chrome could not show this PDF inline. Open the proof in a new tab, then add your comment here.
                </div>
              </object>
            ) : canFrameProof(renderedProofUrl) ? (
              <iframe
                src={renderedProofUrl}
                title={`${doc.title} proof`}
                className="h-[720px] w-full bg-white"
                sandbox={frameSandbox(doc)}
              />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                This proof does not have a working preview link yet. Ask PSG to attach the page, PDF, or image file, then come back to this screen.
              </div>
            )}
          </div>

          {!isReadOnly ? (
            <Button type="button" variant="outline" onClick={onSelectForComment}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Comment on this proof
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
