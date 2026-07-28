"use client";

import { useMemo, useState } from "react";
import { CheckCircle, ClipboardList, Eye, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ShopOption = { id: string; name: string };
type WorkspaceResult = {
  project: { id: string; title: string; status: string; currentRoundId: string | null };
  round: { id: string; status: string; outcome: string | null; completedAt: string | null } | null;
  documents: Array<{ itemId: string; versionId: string | null; title: string; processingStatus: string; status: string }>;
  submittedComments: Array<{ id: string; body: string; pinNumber: number | null; draftStatus: string }>;
  decisions: Array<{ id: string; reviewItemId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

export function ReviewWorkspaceConsole({
  shops,
  defaultShopId,
}: {
  shops: ShopOption[];
  defaultShopId: string | null;
}) {
  const [shopId, setShopId] = useState(defaultShopId ?? shops[0]?.id ?? "");
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
  const [result, setResult] = useState<WorkspaceResult | null>(null);

  const inviteUrl = useMemo(
    () => slice ? `/review-workspace?invite=${encodeURIComponent(slice.inviteToken)}` : "",
    [slice],
  );

  async function createWorkspace() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ops/bsm/review-workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          title,
          description,
          reviewerEmail,
          reviewerName,
          documents: [
            {
              sectionTitle: "Website",
              title: documentTitle,
              sourceUrl: "/dashboard/content",
              position: 1,
            },
          ],
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not create the review workspace.");
      setSlice(body.slice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the review workspace.");
    } finally {
      setPending(false);
    }
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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <Card>
        <CardHeader>
          <CardTitle>Create review workspace</CardTitle>
          <CardDescription>
            Internal QA surface for creating a private reviewer flow without sending customer email.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shop">Shop</Label>
              <select
                id="shop"
                value={shopId}
                onChange={(event) => setShopId(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                {shops.map((shop) => (
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
            <Label htmlFor="description">Review note</Label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={createWorkspace} disabled={pending || !shopId}>
              <Plus className="size-4" aria-hidden="true" />
              Create workspace
            </Button>
            <Button type="button" variant="outline" onClick={() => loadResult()} disabled={pending || !slice}>
              <Eye className="size-4" aria-hidden="true" />
              Load result
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invite gate</CardTitle>
            <CardDescription>Use this private code in non-production testing only.</CardDescription>
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
            <CardDescription>Staff can inspect submitted comments and decisions after the reviewer submits.</CardDescription>
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
                      <div className="mt-1 text-xs text-muted-foreground">{doc.processingStatus} · {doc.status}</div>
                    </div>
                  ))}
                </div>
                {result.submittedComments.map((comment) => (
                  <div key={comment.id} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">Pin {comment.pinNumber ?? "-"}</div>
                    <p className="mt-1">{comment.body}</p>
                  </div>
                ))}
                {result.decisions.map((decision) => (
                  <div key={decision.id} className="rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle className="size-4" aria-hidden="true" />
                      {decision.decision.replace("_", " ")}
                    </div>
                    {decision.message ? <p className="mt-1">{decision.message}</p> : null}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No submitted result loaded.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
