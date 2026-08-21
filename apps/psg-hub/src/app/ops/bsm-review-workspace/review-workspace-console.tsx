"use client";

import { useMemo, useState } from "react";
import { CheckCircle, ClipboardList, Eye, FileUp, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ShopOption = { id: string; name: string };
type WorkspaceListItem = {
  id: string;
  shopId: string;
  shopName: string | null;
  title: string;
  status: string;
  currentRoundId: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  role: string;
};
type WorkspaceResult = {
  project: { id: string; title: string; status: string; currentRoundId: string | null };
  round: { id: string; status: string; outcome: string | null; completedAt: string | null } | null;
  documents: Array<{
    itemId: string;
    versionId: string | null;
    versionNumber: number | null;
    title: string;
    processingStatus: string;
    status: string;
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
  submittedComments: Array<{
    id: string;
    invitationId: string | null;
    reviewItemId: string;
    versionId: string | null;
    versionNumber: number | null;
    roundId: string | null;
    threadId: string;
    body: string;
    commentKind: "pin" | "highlight" | "clarification_reply" | "psg_reply" | "system_note";
    pinNumber: number | null;
    threadStatus: string;
    draftStatus: string;
    authorRole: "client" | "psg";
    authorDisplayName: string;
    createdAt: string | null;
    selection: { text: string } | null;
  }>;
  decisions: Array<{ id: string; reviewItemId: string; versionId: string | null; versionNumber: number | null; roundId: string | null; decision: string; message: string | null; actorDisplayName: string; submittedAt: string | null }>;
  activity: Array<{ id: string; eventType: string; reviewItemId: string | null; versionId: string | null; versionNumber: number | null; actorDisplayName: string; createdAt: string | null }>;
};

export function ReviewWorkspaceConsole({
  shops,
  defaultShopId,
  initialWorkspaces = [],
  canRemoveWorkspaces = false,
}: {
  shops: ShopOption[];
  defaultShopId: string | null;
  initialWorkspaces?: WorkspaceListItem[];
  canRemoveWorkspaces?: boolean;
}) {
  const shopOptions = useMemo(() => {
    const optionsById = new Map<string, ShopOption>();
    for (const shop of shops) {
      if (!shop.id.trim()) continue;
      const existing = optionsById.get(shop.id);
      if (!existing || existing.name === shop.id) {
        optionsById.set(shop.id, shop);
      }
    }
    return [...optionsById.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [shops]);
  const [shopId, setShopId] = useState(defaultShopId ?? shopOptions[0]?.id ?? "");
  const selectedShopId = shopOptions.some((shop) => shop.id === shopId)
    ? shopId
    : defaultShopId && shopOptions.some((shop) => shop.id === defaultShopId)
      ? defaultShopId
      : shopOptions[0]?.id ?? "";
  const [title, setTitle] = useState("E2E website review workspace");
  const [reviewerEmail, setReviewerEmail] = useState("reviewer@e2e.test");
  const [reviewerName, setReviewerName] = useState("E2E Reviewer");
  const [documentTitle, setDocumentTitle] = useState("Homepage proof");
  const [description, setDescription] = useState("Review the homepage content before customer release.");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slice, setSlice] = useState<{
    projectId: string;
    inviteToken: string;
    inviteCode: string;
  } | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>(initialWorkspaces);
  const [activeProjectId, setActiveProjectId] = useState(initialWorkspaces[0]?.id ?? "");
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [threadReplies, setThreadReplies] = useState<Record<string, string>>({});
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeProjectId) ?? null;
  const commentThreads = useMemo(() => {
    if (!result) return [];
    return result.submittedComments
      .filter((comment) => comment.commentKind === "pin" || comment.commentKind === "highlight")
      .map((root) => ({ root, replies: result.submittedComments.filter((comment) => comment.threadId === root.threadId && comment.id !== root.id) }));
  }, [result]);

  const inviteUrl = useMemo(
    () => slice ? `/review-workspace?invite=${encodeURIComponent(slice.inviteToken)}` : "",
    [slice],
  );
  const uploadUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedShopId) params.set("shopId", selectedShopId);
    if (slice?.projectId) params.set("workspaceId", slice.projectId);
    const query = params.toString();
    return `/ops/bsm-content-approvals${query ? `?${query}` : ""}`;
  }, [selectedShopId, slice]);

  async function createWorkspace() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ops/bsm/review-workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: selectedShopId,
          title,
          description,
          reviewerEmail,
          reviewerName,
          documents: [
            {
              sectionTitle: "Website",
              title: documentTitle,
              body: "This proof shows the public-facing page copy the reviewer should check. It is stored in the review workspace so the private invite works without a PSG staff login.",
              position: 1,
            },
          ],
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not create the review workspace.");
      setSlice(body.slice);
      await refreshWorkspaces(body.slice?.projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the review workspace.");
    } finally {
      setPending(false);
    }
  }

  async function refreshWorkspaces(nextActiveProjectId = activeProjectId) {
    const res = await fetch("/api/ops/bsm/review-workspace/projects", {
      headers: { "Cache-Control": "no-store" },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? "Could not load review workspaces.");
    const nextWorkspaces = Array.isArray(body.workspaces) ? body.workspaces as WorkspaceListItem[] : [];
    setWorkspaces(nextWorkspaces);
    const nextActive = nextWorkspaces.some((workspace) => workspace.id === nextActiveProjectId)
      ? nextActiveProjectId
      : nextWorkspaces[0]?.id ?? "";
    setActiveProjectId(nextActive);
    return nextActive;
  }

  async function loadResult(projectId = slice?.projectId) {
    if (!projectId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/bsm/review-workspace/projects/${projectId}`, {
        headers: { "Cache-Control": "no-store" },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load the review result.");
      setResult(body.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the review result.");
    } finally {
      setPending(false);
    }
  }

  async function replyToThread(threadId: string) {
    if (!result) return;
    const body = threadReplies[threadId]?.trim();
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/bsm/review-workspace/projects/${result.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply_thread", threadId, body }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Could not post the PSG reply.");
      setThreadReplies((current) => ({ ...current, [threadId]: "" }));
      await loadResult(result.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the PSG reply.");
    } finally {
      setPending(false);
    }
  }

  async function setThreadStatus(threadId: string, status: "open" | "resolved") {
    if (!result) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/bsm/review-workspace/projects/${result.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_thread_status", threadId, status }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Could not update the comment thread.");
      await loadResult(result.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the comment thread.");
    } finally {
      setPending(false);
    }
  }

  async function removeWorkspace(projectId = activeProjectId) {
    if (!projectId) return;
    const workspace = workspaces.find((item) => item.id === projectId);
    if (!confirm(`Remove review workspace "${workspace?.title ?? projectId}"? It will be hidden now and kept recoverable for 30 days.`)) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/bsm/review-workspace/projects/${projectId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Removed from the superadmin review workspace console." }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not remove the review workspace.");
      const nextActive = await refreshWorkspaces("");
      setResult(null);
      if (slice?.projectId === projectId) setSlice(null);
      if (nextActive) await loadResult(nextActive);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the review workspace.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <Card>
        <CardHeader>
          <CardTitle>Create approval workspace</CardTitle>
          <CardDescription>
            Start a customer review workspace for one shop, one reviewer, and the first document.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shop">Shop</Label>
              <select
                id="shop"
                value={selectedShopId}
                onChange={(event) => setShopId(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                {shopOptions.map((shop) => (
                  <option key={shop.id} value={shop.id}>{shop.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer-email">Reviewer email</Label>
              <Input id="reviewer-email" value={reviewerEmail} onChange={(event) => setReviewerEmail(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer-name">Reviewer name</Label>
              <Input id="reviewer-name" value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-title">Document title</Label>
              <Input id="document-title" value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-title">Workspace title</Label>
            <Input id="workspace-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Reviewer instructions</Label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={createWorkspace} disabled={pending || !selectedShopId}>
              <Plus className="size-4" aria-hidden="true" />
              Create workspace
            </Button>
            <a className={buttonVariants({ variant: "outline" })} href={uploadUrl}>
              <FileUp className="size-4" aria-hidden="true" />
              Add document
            </a>
            <Button type="button" variant="outline" onClick={() => loadResult()} disabled={pending || !slice}>
              <Eye className="size-4" aria-hidden="true" />
              Refresh submitted review
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {slice
              ? "Use Add document to attach another PDF, image, text, Word, or HTML file to this Review Workspace."
              : "Create a workspace first, then add more documents from the document form below."}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Existing workspaces</CardTitle>
            <CardDescription>Open any workspace you can manage and inspect its documents, comments, and decisions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspaces.length ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="existing-workspace">Workspace</Label>
                  <select
                    id="existing-workspace"
                    value={activeProjectId}
                    onChange={(event) => {
                      setActiveProjectId(event.target.value);
                      setResult(null);
                    }}
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.title} · {workspace.shopName ?? workspace.shopId} · {workspace.status.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => loadResult(activeProjectId)}
                    disabled={pending || !activeProjectId}
                  >
                    <Eye className="size-4" aria-hidden="true" />
                    Open workspace
                  </Button>
                  {canRemoveWorkspaces ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeWorkspace(activeProjectId)}
                      disabled={pending || !activeProjectId}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Remove workspace
                    </Button>
                  ) : null}
                </div>
                {activeWorkspace ? (
                  <p className="text-xs text-muted-foreground">
                    Last updated {activeWorkspace.updatedAt ? new Date(activeWorkspace.updatedAt).toLocaleString() : "unknown"}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No review workspaces are available yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reviewer access</CardTitle>
            <CardDescription>Use the reviewer URL and one-time code for the selected workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {slice ? (
              <>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground">Reviewer URL</div>
                  <a className="break-all text-sm font-medium text-ember" href={inviteUrl}>{inviteUrl}</a>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground">One-time code</div>
                  <div className="font-mono text-2xl tracking-widest" data-testid="invite-code">{slice.inviteCode}</div>
                </div>
                <Badge variant="secondary">Internal only</Badge>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Create a workspace to generate a reviewer URL and code.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review result</CardTitle>
            <CardDescription>Discuss current feedback and retain the version-bound comment, decision, and activity history.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {result ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-heading text-sm font-semibold">{result.project.title}</div>
                    <div className="text-xs text-muted-foreground">Project {result.project.status}</div>
                  </div>
                  <Badge>{result.round?.outcome ?? result.round?.status ?? result.project.status}</Badge>
                </div>
                <div className="space-y-2">
                  {result.documents.map((doc) => (
                    <div key={doc.itemId} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        <ClipboardList className="size-4" aria-hidden="true" />
                        {doc.title}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">Version {doc.versionNumber ?? "current"} · {doc.processingStatus} · {doc.status}</div>
                      {doc.proofContent ? (
                        <div className="mt-3 rounded-md border border-border bg-background p-3">
                          <div className="text-xs font-semibold uppercase text-ember">{doc.proofContent.eyebrow}</div>
                          <div className="mt-1 font-heading text-base font-semibold">{doc.proofContent.headline}</div>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{doc.proofContent.body}</p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {commentThreads.map(({ root, replies }) => {
                  const document = result.documents.find((item) => item.itemId === root.reviewItemId);
                  const resolved = root.threadStatus === "resolved";
                  const canMutate = Boolean(result.round && root.roundId === result.round.id && (result.round.status === "active" || result.round.status === "inviting"));
                  return (
                    <div key={root.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{root.commentKind === "highlight" ? "Highlight" : "Pin"} {root.pinNumber ?? "-"} · {document?.title ?? "Review document"} · Version {root.versionNumber ?? "current"}</div>
                        <Badge variant="secondary">{resolved ? "Resolved" : "Open"}</Badge>
                      </div>
                      {root.selection ? <p className="mt-2 border-l-2 border-warning pl-2 text-xs italic text-muted-foreground">“{root.selection.text}”</p> : null}
                      <p className="mt-2">{root.body}</p>
                      <div className="mt-1 text-xs text-muted-foreground">{root.authorDisplayName}{root.createdAt ? ` · ${new Date(root.createdAt).toLocaleString()}` : ""}</div>
                      {replies.map((reply) => (
                        <div key={reply.id} className="mt-3 border-l-2 border-border pl-3">
                          <p>{reply.body}</p>
                          <div className="mt-1 text-xs text-muted-foreground">{reply.authorDisplayName}{reply.createdAt ? ` · ${new Date(reply.createdAt).toLocaleString()}` : ""}</div>
                        </div>
                      ))}
                      {canMutate ? <div className="mt-3 space-y-2 border-t border-border pt-3">
                        <Label htmlFor={`staff-thread-reply-${root.threadId}`}>PSG reply</Label>
                        <div className="flex gap-2">
                          <Input id={`staff-thread-reply-${root.threadId}`} value={threadReplies[root.threadId] ?? ""} onChange={(event) => setThreadReplies((current) => ({ ...current, [root.threadId]: event.target.value }))} placeholder="Reply to the client" />
                          <Button type="button" variant="outline" onClick={() => replyToThread(root.threadId)} disabled={pending || !threadReplies[root.threadId]?.trim()}><Send className="size-4" aria-hidden="true" /><span className="sr-only">Post PSG reply</span></Button>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setThreadStatus(root.threadId, resolved ? "open" : "resolved")} disabled={pending}>
                          {resolved ? <RotateCcw className="size-4" aria-hidden="true" /> : <CheckCircle className="size-4" aria-hidden="true" />}
                          {resolved ? "Reopen comment" : "Resolve comment"}
                        </Button>
                      </div> : null}
                    </div>
                  );
                })}
                {result.decisions.map((decision) => (
                  <div key={decision.id} className="rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle className="size-4" aria-hidden="true" />
                      {decision.decision.replace("_", " ")}
                    </div>
                    {decision.message ? <p className="mt-1">{decision.message}</p> : null}
                    <div className="mt-1 text-xs text-muted-foreground">Version {decision.versionNumber ?? "current"} · {decision.actorDisplayName}{decision.submittedAt ? ` · ${new Date(decision.submittedAt).toLocaleString()}` : ""}</div>
                  </div>
                ))}
                {result.activity.length ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    <div className="font-heading text-sm font-semibold">Review activity</div>
                    {result.activity.map((event) => (
                      <div key={event.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-xs">
                        <div>
                          <div className="font-medium capitalize">{event.eventType.replace("review_workspace_", "").replaceAll("_", " ")}</div>
                          <div className="mt-1 text-muted-foreground">{event.actorDisplayName} · Version {event.versionNumber ?? "workspace"}</div>
                        </div>
                        <time className="shrink-0 text-muted-foreground">{event.createdAt ? new Date(event.createdAt).toLocaleString() : "Time unavailable"}</time>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No submitted review has been refreshed yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
