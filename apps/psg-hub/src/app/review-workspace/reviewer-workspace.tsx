"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { CheckCircle, ExternalLink, Highlighter, Lock, MapPin, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ContentWireframeRenderer } from "@/components/bsm/content-wireframe-renderer";
import type { ContentWireframeManifest, MarkdownDiffLine } from "@/lib/bsm/content-wireframe";

type Decision = "approved" | "changes_requested";
type TextSelectionAnchor = {
  kind: "text";
  blockId: string;
  startOffset: number;
  endOffset: number;
  text: string;
};
type PendingAnchor =
  | { kind: "pin"; xRatio: number; yRatio: number }
  | { kind: "highlight"; selection: TextSelectionAnchor };

type WorkspaceDocument = {
  itemId: string;
  versionId: string;
  versionNumber: number | null;
  title: string;
  note: string | null;
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
  wireframe: ContentWireframeManifest | null;
  versionNote: string | null;
  markdownDiff: MarkdownDiffLine[];
};

type WorkspaceComment = {
  id: string;
  reviewItemId: string;
  versionId: string;
  threadId: string;
  body: string;
  commentKind: "pin" | "highlight" | "clarification_reply" | "psg_reply" | "system_note";
  pinNumber: number | null;
  threadStatus: string;
  draftStatus: string;
  authorRole: "client" | "psg";
  authorDisplayName: string;
  createdAt: string | null;
  viewport: string | null;
  xRatio: number | null;
  yRatio: number | null;
  selection: TextSelectionAnchor | null;
};

type Workspace = {
  project: { id: string; title: string; description: string | null; status: string };
  round: { id: string; status: string };
  reviewer: { email: string; submittedAt: string | null; readOnly: boolean };
  documents: WorkspaceDocument[];
  comments: WorkspaceComment[];
  decisions: Array<{ reviewItemId: string; versionId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

type HighlightSegment = { text: string; highlighted: boolean };
type HighlightRegistry = {
  delete(name: string): void;
  set(name: string, highlight: unknown): void;
};

const HTML_REVIEW_BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,a,button,label";

export function buildHighlightSegments(
  text: string,
  ranges: Array<{ startOffset: number; endOffset: number }>,
): HighlightSegment[] {
  const validRanges = ranges
    .map((range) => ({
      startOffset: Math.max(0, Math.min(text.length, range.startOffset)),
      endOffset: Math.max(0, Math.min(text.length, range.endOffset)),
    }))
    .filter((range) => range.endOffset > range.startOffset)
    .sort((a, b) => a.startOffset - b.startOffset);
  if (!validRanges.length) return [{ text, highlighted: false }];

  const boundaries = new Set([0, text.length]);
  validRanges.forEach((range) => {
    boundaries.add(range.startOffset);
    boundaries.add(range.endOffset);
  });
  const points = [...boundaries].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    return {
      text: text.slice(start, end),
      highlighted: validRanges.some((range) => range.startOffset < end && range.endOffset > start),
    };
  }).filter((segment) => segment.text.length > 0);
}

export function normalizedPointerAnchor(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
) {
  if (rect.width <= 0 || rect.height <= 0) return { xRatio: 0.5, yRatio: 0.5 };
  return {
    xRatio: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    yRatio: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

export function reviewWorkspaceCapabilities(assignedReviewer: boolean) {
  return {
    canManageThreads: !assignedReviewer,
    canReopenSubmission: !assignedReviewer,
    canSubmitDecisions: !assignedReviewer,
  };
}

function documentKey(document: Pick<WorkspaceDocument, "itemId" | "versionId">) {
  return `${document.itemId}:${document.versionId}`;
}

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

function isHtmlProof(contentType: string | null): boolean {
  return contentType === "text/html";
}

function elementForSelectionNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function selectionAnchor(
  document: Document,
  selection: Selection,
  startBlock: HTMLElement,
  endBlock: HTMLElement,
  blockId: string,
): { anchor: TextSelectionAnchor | null; error: string | null } {
  const range = selection.getRangeAt(0);
  if (startBlock !== endBlock || !startBlock.contains(range.commonAncestorContainer)) {
    return { anchor: null, error: "Highlight text within one content block at a time." };
  }
  const before = document.createRange();
  before.selectNodeContents(startBlock);
  before.setEnd(range.startContainer, range.startOffset);
  const through = document.createRange();
  through.selectNodeContents(startBlock);
  through.setEnd(range.endContainer, range.endOffset);
  let startOffset = before.toString().length;
  let endOffset = through.toString().length;
  const rawText = (startBlock.textContent ?? "").slice(startOffset, endOffset);
  const leadingWhitespace = rawText.length - rawText.trimStart().length;
  const trailingWhitespace = rawText.length - rawText.trimEnd().length;
  startOffset += leadingWhitespace;
  endOffset -= trailingWhitespace;
  const text = rawText.trim();
  if (!text || text.length > 500) {
    return {
      anchor: null,
      error: text.length > 500 ? "Highlight 500 characters or fewer." : "Select text before adding the highlight.",
    };
  }
  return { anchor: { kind: "text", blockId, startOffset, endOffset, text }, error: null };
}

function htmlReviewBlock(document: Document, node: Node): HTMLElement | null {
  const element = elementForSelectionNode(node);
  return element?.closest<HTMLElement>(HTML_REVIEW_BLOCKS) ?? document.body;
}

function htmlReviewBlockId(document: Document, block: HTMLElement): string | null {
  if (block === document.body) return "html:body";
  const path: number[] = [];
  let current: HTMLElement | null = block;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === document.body ? `html:${path.join(".")}` : null;
}

function htmlReviewBlockFromId(document: Document, blockId: string): HTMLElement | null {
  if (blockId === "html:body") return document.body;
  if (!blockId.startsWith("html:")) return null;
  let current: HTMLElement = document.body;
  const parts = blockId.slice(5).split(".");
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const child = current.children.item(Number(part));
    if (!child) return null;
    current = child as HTMLElement;
  }
  return current;
}

function rangeForHtmlAnchor(document: Document, anchor: TextSelectionAnchor): Range | null {
  const block = htmlReviewBlockFromId(document, anchor.blockId);
  if (!block || anchor.endOffset <= anchor.startOffset) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let start: { node: Text; offset: number } | null = null;
  let end: { node: Text; offset: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const next = consumed + textNode.data.length;
    if (!start && anchor.startOffset <= next) {
      start = { node: textNode, offset: Math.max(0, anchor.startOffset - consumed) };
    }
    if (anchor.endOffset <= next) {
      end = { node: textNode, offset: Math.max(0, anchor.endOffset - consumed) };
      break;
    }
    consumed = next;
  }
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function highlightedText(text: string, selections: TextSelectionAnchor[], blockOffset = 0): ReactNode {
  const localSelections = selections.map((selection) => ({
    ...selection,
    startOffset: selection.startOffset - blockOffset,
    endOffset: selection.endOffset - blockOffset,
  }));
  return buildHighlightSegments(text, localSelections).map((segment, index) =>
    segment.highlighted ? (
      <mark key={`${index}:${segment.text}`} className="rounded-sm bg-warning/35 px-0.5 text-inherit">
        {segment.text}
      </mark>
    ) : segment.text,
  );
}

export function ReviewerWorkspace({ inviteToken = "", projectId }: { inviteToken?: string; projectId?: string }) {
  const [code, setCode] = useState("");
  const [sessionHash, setSessionHash] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [comment, setComment] = useState("");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [threadReplies, setThreadReplies] = useState<Record<string, string>>({});
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(null);
  const [annotationMode, setAnnotationMode] = useState<"pin" | "highlight" | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
  const [pending, setPending] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const htmlProofFrameRef = useRef<HTMLIFrameElement>(null);
  const [htmlProofLoad, setHtmlProofLoad] = useState(0);
  const assignedReviewer = Boolean(projectId);
  const capabilities = reviewWorkspaceCapabilities(assignedReviewer);

  const activeDocument =
    workspace?.documents.find((document) => documentKey(document) === selectedDocumentKey) ??
    workspace?.documents[0] ??
    null;
  const activeKey = activeDocument ? documentKey(activeDocument) : "";
  const isReadOnly = Boolean(workspace?.reviewer.readOnly);
  const commentsForActiveDocument = useMemo(
    () => activeDocument && workspace
      ? workspace.comments.filter((item) => item.reviewItemId === activeDocument.itemId && item.versionId === activeDocument.versionId)
      : [],
    [activeDocument, workspace],
  );
  const threadRoots = useMemo(
    () => commentsForActiveDocument.filter((item) => item.commentKind === "pin" || item.commentKind === "highlight"),
    [commentsForActiveDocument],
  );
  const activeDecision = decisions[activeKey];
  const activeDecisionNote = decisionNotes[activeKey] ?? "";
  const nextAnnotationNumber = threadRoots.length + 1;
  const canHighlightActiveDocument = Boolean(activeDocument?.proofContent || activeDocument?.wireframe) || isHtmlProof(activeDocument?.contentType ?? null);

  async function verifyInvite() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bsm/review-workspace/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteToken, code, deviceLabel: "Reviewer browser" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not verify this review code.");
      setSessionHash(body.session.sessionHash);
      await loadWorkspace(body.session.sessionHash);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify this review code.");
    } finally {
      setPending(false);
    }
  }

  async function loadWorkspace(hash: string | null = sessionHash) {
    if (!hash && !projectId) return;
    const response = await fetch("/api/bsm/review-workspace/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(projectId ? { projectId } : { sessionHash: hash }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Could not load this review workspace.");
    const nextWorkspace = body.workspace as Workspace;
    setWorkspace(nextWorkspace);
    setSelectedDocumentKey((current) => current ?? (nextWorkspace.documents[0] ? documentKey(nextWorkspace.documents[0]) : null));
    const loadedDecisions: Record<string, Decision> = {};
    const loadedNotes: Record<string, string> = {};
    for (const item of nextWorkspace.decisions) {
      if (item.decision !== "approved" && item.decision !== "changes_requested") continue;
      const key = `${item.reviewItemId}:${item.versionId}`;
      loadedDecisions[key] = item.decision;
      loadedNotes[key] = item.message ?? "";
    }
    setDecisions((current) => Object.keys(current).length && !nextWorkspace.reviewer.readOnly ? current : loadedDecisions);
    setDecisionNotes((current) => Object.keys(current).length && !nextWorkspace.reviewer.readOnly ? current : loadedNotes);
  }

  useEffect(() => {
    if (!projectId) return;
    void loadWorkspace(null)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load this review workspace."))
      .finally(() => setPending(false));
    // The project id is the authenticated workspace identity; reload only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function selectDocument(document: WorkspaceDocument) {
    setSelectedDocumentKey(documentKey(document));
    setAnnotationMode(null);
    setPendingAnchor(null);
    setError(null);
  }

  function placePin(event: ReactMouseEvent<HTMLButtonElement>) {
    setPendingAnchor({ kind: "pin", ...normalizedPointerAnchor(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()) });
    setAnnotationMode(null);
  }

  function captureHighlight() {
    if (annotationMode !== "highlight" || (!activeDocument?.proofContent && !activeDocument?.wireframe)) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const startElement = elementForSelectionNode(range.startContainer);
    const endElement = elementForSelectionNode(range.endContainer);
    const startBlock = startElement?.closest<HTMLElement>("[data-review-block]");
    const endBlock = endElement?.closest<HTMLElement>("[data-review-block]");
    if (!startBlock || !endBlock) {
      setError("Highlight text within one content block at a time.");
      return;
    }
    const result = selectionAnchor(
      document,
      selection,
      startBlock,
      endBlock,
      startBlock.dataset.reviewBlock ?? "body",
    );
    if (!result.anchor) {
      setError(result.error);
      return;
    }
    setPendingAnchor({ kind: "highlight", selection: result.anchor });
    setAnnotationMode(null);
    setError(null);
    selection.removeAllRanges();
  }

  useEffect(() => {
    if (annotationMode !== "highlight" || !isHtmlProof(activeDocument?.contentType ?? null)) return;
    const document = htmlProofFrameRef.current?.contentDocument;
    if (!document) return;
    const capture = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const startBlock = htmlReviewBlock(document, range.startContainer);
      const endBlock = htmlReviewBlock(document, range.endContainer);
      const blockId = startBlock ? htmlReviewBlockId(document, startBlock) : null;
      if (!startBlock || !endBlock || !blockId) {
        setError("Highlight text within one content block at a time.");
        return;
      }
      const result = selectionAnchor(document, selection, startBlock, endBlock, blockId);
      if (!result.anchor) {
        setError(result.error);
        return;
      }
      setPendingAnchor({ kind: "highlight", selection: result.anchor });
      setAnnotationMode(null);
      setError(null);
      selection.removeAllRanges();
    };
    document.addEventListener("mouseup", capture);
    return () => document.removeEventListener("mouseup", capture);
  }, [activeDocument?.contentType, activeKey, annotationMode, htmlProofLoad]);

  useEffect(() => {
    if (!isHtmlProof(activeDocument?.contentType ?? null)) return;
    const frame = htmlProofFrameRef.current;
    const document = frame?.contentDocument;
    const frameWindow = frame?.contentWindow;
    if (!document || !frameWindow) return;
    const css = (frameWindow as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
    const HighlightConstructor = (frameWindow as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!css?.highlights || !HighlightConstructor) return;

    let style = document.getElementById("review-workspace-highlight-styles") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "review-workspace-highlight-styles";
      style.textContent = "::highlight(review-workspace-saved){background:#f7c94888;color:inherit}::highlight(review-workspace-pending){background:#f97316aa;color:inherit}";
      document.head.append(style);
    }

    const savedRanges = commentsForActiveDocument.flatMap((comment) => {
      const range = comment.selection ? rangeForHtmlAnchor(document, comment.selection) : null;
      return range ? [range] : [];
    });
    css.highlights.delete("review-workspace-saved");
    if (savedRanges.length) css.highlights.set("review-workspace-saved", new HighlightConstructor(...savedRanges));

    const pendingRange = pendingAnchor?.kind === "highlight"
      ? rangeForHtmlAnchor(document, pendingAnchor.selection)
      : null;
    css.highlights.delete("review-workspace-pending");
    if (pendingRange) css.highlights.set("review-workspace-pending", new HighlightConstructor(pendingRange));
  }, [activeDocument?.contentType, activeKey, commentsForActiveDocument, htmlProofLoad, pendingAnchor]);

  async function saveComment() {
    if ((!sessionHash && !projectId) || !activeDocument || !pendingAnchor || !comment.trim()) {
      setError("Place a pin or select text, then enter a private comment.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bsm/review-workspace/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(projectId ? { projectId } : { sessionHash }),
          reviewItemId: activeDocument.itemId,
          versionId: activeDocument.versionId,
          body: comment.trim(),
          pinNumber: nextAnnotationNumber,
          viewport: isPdfProof(activeDocument.contentType) ? "pdf_page" : window.innerWidth < 700 ? "mobile" : "desktop",
          anchorKind: pendingAnchor.kind,
          xRatio: pendingAnchor.kind === "pin" ? pendingAnchor.xRatio : null,
          yRatio: pendingAnchor.kind === "pin" ? pendingAnchor.yRatio : null,
          selection: pendingAnchor.kind === "highlight" ? pendingAnchor.selection : null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not save this private comment.");
      setComment("");
      setPendingAnchor(null);
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this private comment.");
    } finally {
      setPending(false);
    }
  }

  async function postThreadReply(threadId: string) {
    const body = threadReplies[threadId]?.trim();
    if ((!sessionHash && !projectId) || !body) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bsm/review-workspace/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", ...(projectId ? { projectId } : { sessionHash }), threadId, body }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not post this reply.");
      setThreadReplies((current) => ({ ...current, [threadId]: "" }));
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not post this reply.");
    } finally {
      setPending(false);
    }
  }

  async function setThreadStatus(threadId: string, status: "open" | "resolved") {
    if (!sessionHash || !capabilities.canManageThreads) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bsm/review-workspace/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionHash, threadId, status }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Could not update this comment thread.");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this comment thread.");
    } finally {
      setPending(false);
    }
  }

  async function submitReview() {
    if ((!sessionHash && !projectId) || !workspace) return;
    const missingDecision = workspace.documents.find((document) => !decisions[documentKey(document)]);
    if (missingDecision) {
      selectDocument(missingDecision);
      setError(`Choose Approve or Request changes for ${missingDecision.title}.`);
      return;
    }
    const missingComment = workspace.documents.find((document) =>
      decisions[documentKey(document)] === "changes_requested" &&
      !workspace.comments.some((item) => item.reviewItemId === document.itemId && item.versionId === document.versionId && (item.commentKind === "pin" || item.commentKind === "highlight")),
    );
    if (missingComment) {
      selectDocument(missingComment);
      setError(`Add a pinned or highlighted comment for ${missingComment.title} before requesting changes.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bsm/review-workspace/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(projectId ? { projectId } : { sessionHash }),
          decisions: workspace.documents.map((document) => ({
            reviewItemId: document.itemId,
            versionId: document.versionId,
            decision: decisions[documentKey(document)],
            message: decisionNotes[documentKey(document)]?.trim() || null,
          })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not submit this review.");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit this review.");
    } finally {
      setPending(false);
    }
  }

  async function reopenReview() {
    if (!sessionHash) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/bsm/review-workspace/reopen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionHash }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not reopen this review.");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reopen this review.");
    } finally {
      setPending(false);
    }
  }

  const selectionsForBlock = (blockId: string) => {
    const saved = commentsForActiveDocument.flatMap((item) => item.selection?.blockId === blockId ? [item.selection] : []);
    return pendingAnchor?.kind === "highlight" && pendingAnchor.selection.blockId === blockId
      ? [...saved, pendingAnchor.selection]
      : saved;
  };

  if (!inviteToken && !projectId) {
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
        <div className="text-xs font-medium uppercase text-muted-foreground">Content review</div>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {workspace?.project.title ?? "Enter your review code"}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {workspace?.project.description ?? "Review PSG-prepared content and provide clear, private feedback before it is used."}
        </p>
      </header>

      {!workspace ? assignedReviewer ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Opening review</CardTitle>
            <CardDescription>{error ?? (pending ? "Loading your assigned Review Workspace…" : "This Review Workspace is not available to your account.")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Secure access</CardTitle>
            <CardDescription>Enter the one-time code from your invitation email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="review-code">One-time code</Label>
              <Input id="review-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
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
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
                <CardDescription>{assignedReviewer ? "Review one document at a time and leave comments for PSG." : "Review one document at a time. Every document needs its own decision."}</CardDescription>
              </CardHeader>
              <CardContent>
                <nav aria-label="Review documents" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {workspace.documents.map((document, index) => {
                    const key = documentKey(document);
                    const selected = key === activeKey;
                    const documentDecision = decisions[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => selectDocument(document)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/50",
                        )}
                        aria-current={selected ? "step" : undefined}
                      >
                        <span className={cn("text-xs", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>Document {index + 1}</span>
                        <span className="mt-1 block font-medium">{document.title}</span>
                        <span className={cn("mt-2 block text-xs capitalize", selected ? "text-primary-foreground/80" : "text-muted-foreground")}>{assignedReviewer ? "Comment-only review" : documentDecision?.replaceAll("_", " ") ?? "Decision needed"}</span>
                      </button>
                    );
                  })}
                </nav>
              </CardContent>
            </Card>

            {activeDocument ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{activeDocument.title}</CardTitle>
                      <CardDescription>{activeDocument.sectionTitle ?? "Review document"} · Version {activeDocument.versionNumber ?? "current"} · {activeDocument.processingStatus}</CardDescription>
                    </div>
                    <Badge>{workspace.round.status}</Badge>
                  </div>
                  {activeDocument.note ? <p className="pt-2 text-sm leading-6 text-muted-foreground">{activeDocument.note}</p> : null}
                  {activeDocument.versionNote ? <p className="pt-2 text-sm leading-6"><strong>What changed:</strong> {activeDocument.versionNote}</p> : null}
                  {activeDocument.markdownDiff?.length ? (
                    <details className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <summary className="cursor-pointer font-medium">View changes from the prior reviewed version</summary>
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{(activeDocument.markdownDiff ?? []).map((line, index) => <span key={`${index}:${line.kind}`} className={`block ${line.kind === "added" ? "text-success" : line.kind === "removed" ? "text-destructive" : "text-muted-foreground"}`}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.line}</span>)}</pre>
                    </details>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-md border border-border bg-background">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{activeDocument.originalFilename ?? activeDocument.proofUrl ?? "Proof preview"}</div>
                        {activeDocument.contentType ? <div className="text-xs text-muted-foreground">{activeDocument.contentType}</div> : null}
                      </div>
                      {activeDocument.proofUrl ? (
                        <a href={activeDocument.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-ember hover:text-foreground">
                          <ExternalLink className="size-4" aria-hidden="true" />
                          Open full proof
                        </a>
                      ) : null}
                    </div>
                    <div className="relative" onMouseUp={captureHighlight}>
                      {activeDocument.wireframe ? (
                        <ContentWireframeRenderer
                          manifest={activeDocument.wireframe}
                          assetUrl={(assetId) => `/api/bsm/review-workspace/asset?${assignedReviewer ? `projectId=${encodeURIComponent(projectId ?? "")}` : `sessionHash=${encodeURIComponent(sessionHash ?? "")}`}&reviewItemId=${encodeURIComponent(activeDocument.itemId)}&versionId=${encodeURIComponent(activeDocument.versionId)}&assetId=${encodeURIComponent(assetId)}`}
                          renderText={(blockId, text, blockOffset) => highlightedText(text, selectionsForBlock(blockId), blockOffset)}
                        />
                      ) : activeDocument.proofContent ? (
                        <article className="min-h-80 bg-white p-5 text-foreground sm:p-8">
                          <div data-review-block="eyebrow" className="text-xs font-semibold uppercase text-ember">{highlightedText(activeDocument.proofContent.eyebrow, selectionsForBlock("eyebrow"))}</div>
                          <h3 data-review-block="headline" className="mt-2 font-heading text-2xl font-semibold">{highlightedText(activeDocument.proofContent.headline, selectionsForBlock("headline"))}</h3>
                          <p data-review-block="body" className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{highlightedText(activeDocument.proofContent.body, selectionsForBlock("body"))}</p>
                          {activeDocument.proofContent.bullets.length ? (
                            <ul className="mt-4 space-y-2 text-sm">
                              {activeDocument.proofContent.bullets.map((bullet, index) => (
                                <li key={`${index}:${bullet}`} className="flex gap-2">
                                  <CheckCircle className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                                  <span data-review-block={`bullet-${index}`}>{highlightedText(bullet, selectionsForBlock(`bullet-${index}`))}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <div data-review-block="cta" className="mt-5 inline-flex rounded-md bg-ember px-3 py-2 text-sm font-medium text-white">{highlightedText(activeDocument.proofContent.cta, selectionsForBlock("cta"))}</div>
                        </article>
                      ) : isImageProof(activeDocument.contentType) && activeDocument.proofUrl ? (
                        <img src={activeDocument.proofUrl} alt={`${activeDocument.title} proof`} className="max-h-[680px] w-full object-contain bg-white" />
                      ) : isHtmlProof(activeDocument.contentType) && canFrameProof(activeDocument.proofUrl) ? (
                        <iframe
                          ref={htmlProofFrameRef}
                          src={activeDocument.proofUrl}
                          title={`${activeDocument.title} proof`}
                          className="h-[680px] w-full bg-white"
                          sandbox="allow-same-origin"
                          onLoad={() => setHtmlProofLoad((current) => current + 1)}
                        />
                      ) : canFrameProof(activeDocument.proofUrl) ? (
                        <iframe src={activeDocument.proofUrl} title={`${activeDocument.title} proof`} className="h-[680px] w-full bg-white" sandbox="" />
                      ) : (
                        <div className="p-4 text-sm text-muted-foreground">The proof link is not available for this review item.</div>
                      )}

                      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                        {commentsForActiveDocument.filter((item) => item.commentKind === "pin" && item.xRatio != null && item.yRatio != null).map((item) => (
                          <span key={item.id} className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ember text-xs font-bold text-white shadow-lg ring-2 ring-white" style={{ left: `${item.xRatio! * 100}%`, top: `${item.yRatio! * 100}%` }}>{item.pinNumber}</span>
                        ))}
                        {pendingAnchor?.kind === "pin" ? (
                          <span className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-lg ring-2 ring-white" style={{ left: `${pendingAnchor.xRatio * 100}%`, top: `${pendingAnchor.yRatio * 100}%` }}>{nextAnnotationNumber}</span>
                        ) : null}
                      </div>
                      {annotationMode === "pin" && !isReadOnly ? (
                        <button type="button" aria-label="Place comment pin on document" className="absolute inset-0 cursor-crosshair bg-primary/5 outline-none focus-visible:ring-4 focus-visible:ring-ring/50" onClick={placePin} />
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </section>

          <aside className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
            <Card>
              <CardHeader>
                <CardTitle>{isReadOnly ? "Submitted review" : "Your review"}</CardTitle>
                <CardDescription>{isReadOnly ? assignedReviewer ? "Your submitted response is read-only." : "Your response is locked unless you reopen it while the round is active." : `Reviewing ${activeDocument?.title ?? "document"}.`}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isReadOnly ? (
                  <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                    <div className="flex items-center gap-2 font-medium"><Lock className="size-4" aria-hidden="true" />Read-only after submit</div>
                    <p className="mt-1 text-muted-foreground">Submitted by {workspace.reviewer.email}</p>
                    {capabilities.canReopenSubmission && (workspace.round.status === "active" || workspace.round.status === "inviting") ? (
                      <Button type="button" variant="outline" className="mt-3" onClick={reopenReview} disabled={pending}><RotateCcw className="size-4" aria-hidden="true" />Reopen response</Button>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {capabilities.canSubmitDecisions ? (
                      <fieldset className="space-y-2">
                        <legend className="font-heading text-sm font-medium">Decision for this document</legend>
                        <label className="flex items-center gap-2 text-sm"><input type="radio" name={`decision-${activeKey}`} checked={activeDecision === "approved"} onChange={() => setDecisions((current) => ({ ...current, [activeKey]: "approved" }))} />Approve</label>
                        <label className="flex items-center gap-2 text-sm"><input type="radio" name={`decision-${activeKey}`} checked={activeDecision === "changes_requested"} onChange={() => setDecisions((current) => ({ ...current, [activeKey]: "changes_requested" }))} />Request changes</label>
                      </fieldset>
                    ) : null}

                    <div className="space-y-2 border-t border-border pt-4">
                      <Label>Anchor a private comment</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" variant={annotationMode === "pin" ? "default" : "outline"} onClick={() => { setAnnotationMode("pin"); setPendingAnchor(null); setError(null); }} disabled={pending || !activeDocument}><MapPin className="size-4" aria-hidden="true" />Place pin</Button>
                        <Button type="button" variant={annotationMode === "highlight" ? "default" : "outline"} onClick={() => { setAnnotationMode("highlight"); setPendingAnchor(null); setError(null); }} disabled={pending || !canHighlightActiveDocument} title={canHighlightActiveDocument ? "Select text in the proof" : "This review copy does not expose selectable text"}><Highlighter className="size-4" aria-hidden="true" />Highlight text</Button>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {annotationMode === "pin" ? "Click the exact spot in the proof." : annotationMode === "highlight" ? "Select text within one paragraph, heading, table cell, bullet, or button." : pendingAnchor?.kind === "pin" ? `Pin ${nextAnnotationNumber} is placed.` : pendingAnchor?.kind === "highlight" ? `Highlighted: “${pendingAnchor.selection.text}”` : canHighlightActiveDocument ? "Use a pin or select text before writing your comment." : "Text highlighting is unavailable for this review copy; use a pin."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="private-comment">Private comment</Label>
                      <textarea id="private-comment" value={comment} onChange={(event) => setComment(event.target.value)} disabled={pending} placeholder="Describe the change you want PSG to make." className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                    </div>
                    <Button type="button" variant="outline" onClick={saveComment} disabled={pending || !activeDocument || !pendingAnchor || !comment.trim()}><MapPin className="size-4" aria-hidden="true" />Save private comment</Button>

                    {capabilities.canSubmitDecisions ? (
                      <>
                        <div className="space-y-2 border-t border-border pt-4">
                          <Label htmlFor="decision-note">Decision note for this document</Label>
                          <textarea id="decision-note" value={activeDecisionNote} onChange={(event) => setDecisionNotes((current) => ({ ...current, [activeKey]: event.target.value }))} placeholder="Optional summary for PSG." className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                        </div>
                        <Button type="button" onClick={submitReview} disabled={pending || workspace.documents.length === 0}><Send className="size-4" aria-hidden="true" />Submit completed review</Button>
                      </>
                    ) : null}
                  </>
                )}
                {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">{error}</p> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Comments on this document</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {threadRoots.length ? threadRoots.map((item) => {
                  const replies = commentsForActiveDocument.filter((comment) => comment.threadId === item.threadId && comment.id !== item.id);
                  const resolved = item.threadStatus === "resolved";
                  return (
                    <div key={item.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{item.commentKind === "highlight" ? `Highlight ${item.pinNumber ?? ""}` : `Pin ${item.pinNumber ?? "-"}`}</div>
                        <Badge variant="secondary">{resolved ? "Resolved" : "Open"}</Badge>
                      </div>
                      {item.selection ? <p className="mt-1 line-clamp-3 border-l-2 border-warning pl-2 text-xs italic text-muted-foreground">“{item.selection.text}”</p> : null}
                      <p className="mt-2">{item.body}</p>
                      <div className="mt-1 text-xs text-muted-foreground">{item.authorDisplayName}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleString()}` : ""}</div>
                      {replies.map((reply) => (
                        <div key={reply.id} className="mt-3 border-l-2 border-border pl-3">
                          <p>{reply.body}</p>
                          <div className="mt-1 text-xs text-muted-foreground">{reply.authorDisplayName}{reply.createdAt ? ` · ${new Date(reply.createdAt).toLocaleString()}` : ""}</div>
                        </div>
                      ))}
                      {!isReadOnly ? (
                        <div className="mt-3 space-y-2 border-t border-border pt-3">
                          <Label htmlFor={`thread-reply-${item.threadId}`}>Reply</Label>
                          <div className="flex gap-2">
                            <Input id={`thread-reply-${item.threadId}`} value={threadReplies[item.threadId] ?? ""} onChange={(event) => setThreadReplies((current) => ({ ...current, [item.threadId]: event.target.value }))} placeholder="Continue this discussion" />
                            <Button type="button" variant="outline" onClick={() => postThreadReply(item.threadId)} disabled={pending || !(threadReplies[item.threadId]?.trim())}><Send className="size-4" aria-hidden="true" /><span className="sr-only">Post reply</span></Button>
                          </div>
                          {capabilities.canManageThreads ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setThreadStatus(item.threadId, resolved ? "open" : "resolved")} disabled={pending}>
                              {resolved ? <RotateCcw className="size-4" aria-hidden="true" /> : <CheckCircle className="size-4" aria-hidden="true" />}
                              {resolved ? "Reopen comment" : "Resolve comment"}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                }) : <p className="text-sm text-muted-foreground">No private comments on this document yet.</p>}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
