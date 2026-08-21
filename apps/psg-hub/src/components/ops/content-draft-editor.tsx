"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ContentWireframeRenderer } from "@/components/bsm/content-wireframe-renderer";
import {
  buildMarkdownDiff,
  parseContentWireframe,
  type ContentWireframeDiagnostic,
  type ContentWireframeManifest,
  type MarkdownDiffLine,
} from "@/lib/bsm/content-wireframe";

type Draft = {
  id: string;
  projectId: string;
  shopId: string;
  documentId: string;
  markdown: string;
  revision: number;
  baseVersionId: string | null;
  createdByProfileId: string;
  lastWriterProfileId: string;
  createdAt: string;
  updatedAt: string;
};

type Asset = {
  id: string;
  projectId: string;
  shopId: string;
  documentId: string;
  originalFilename: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  createdAt: string;
};

export type ContentDraftWorkspacePayload = {
  draft: Draft | null;
  currentVersionId: string | null;
  assets: Asset[];
  manifest: ContentWireframeManifest | null;
  diagnostics: ContentWireframeDiagnostic[];
  baseMarkdown: string;
  diff: MarkdownDiffLine[];
  feedbackStatuses: string[];
  approvalStatement: string;
};

type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";

const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-[#142838] shadow-sm transition hover:border-ember focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass = `${buttonClass} border-ember bg-ember text-white hover:bg-[#b84321]`;

export function ContentDraftEditor({
  projectId,
  documentId,
  initialWorkspace,
  autosaveDelayMs = 800,
}: {
  projectId: string;
  documentId: string;
  initialWorkspace?: ContentDraftWorkspacePayload;
  autosaveDelayMs?: number;
}) {
  const endpoint = `/api/ops/bsm/review-workspace/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/draft`;
  const [workspace, setWorkspace] = useState<ContentDraftWorkspacePayload | null>(initialWorkspace ?? null);
  const [draft, setDraft] = useState<Draft | null>(initialWorkspace?.draft ?? null);
  const [markdown, setMarkdown] = useState(initialWorkspace?.draft?.markdown ?? "");
  const [saveState, setSaveState] = useState<SaveState>(initialWorkspace?.draft ? "saved" : "idle");
  const [conflict, setConflict] = useState<{ localMarkdown: string; latest: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [publicationMessage, setPublicationMessage] = useState<string | null>(null);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;

  async function loadWorkspace() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Could not load this Content Draft.");
    const next = body.workspace as ContentDraftWorkspacePayload;
    setWorkspace(next);
    setDraft(next.draft);
    setMarkdown(next.draft?.markdown ?? "");
    setSaveState(next.draft ? "saved" : "idle");
  }

  useEffect(() => {
    if (initialWorkspace) return;
    void loadWorkspace().catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Could not load this Content Draft.");
      setSaveState("error");
    });
    // The route identities are immutable for this mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkspace, projectId, documentId]);

  useEffect(() => {
    if (!draft || conflict || markdown === draft.markdown) return;
    setSaveState("saving");
    setError(null);
    const localMarkdown = markdown;
    const expectedRevision = draft.revision;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision, markdown: localMarkdown }),
        });
        const body = await response.json().catch(() => null);
        if (response.status === 409 && body?.conflict) {
          setConflict(body.conflict as { localMarkdown: string; latest: Draft });
          setSaveState("conflict");
          return;
        }
        if (!response.ok) throw new Error(body?.error ?? "Could not save this Content Draft.");
        const saved = body.draft as Draft;
        setDraft(saved);
        setWorkspace((current) => current ? { ...current, draft: saved } : current);
        setSaveState(markdownRef.current === localMarkdown ? "saved" : "saving");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save this Content Draft.");
        setSaveState("error");
      }
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [autosaveDelayMs, conflict, draft, endpoint, markdown, saveAttempt]);

  const parsed = useMemo(() => parseContentWireframe(markdown, {
    documentId,
    assets: (workspace?.assets ?? []).map((asset) => ({ id: asset.id, documentId: asset.documentId })),
  }), [documentId, markdown, workspace?.assets]);
  const diff = useMemo(() => buildMarkdownDiff(workspace?.baseMarkdown ?? "", markdown), [markdown, workspace?.baseMarkdown]);
  const feedbackBlockers = (workspace?.feedbackStatuses ?? []).filter((status) => !["resolved", "declined", "needs_clarification"].includes(status));
  const diagnosticBlockers = parsed.diagnostics.filter((item) => item.severity === "error");
  const canPublish = Boolean(
    draft &&
    saveState === "saved" &&
    markdown === draft.markdown &&
    versionNote.trim() &&
    !diagnosticBlockers.length &&
    !feedbackBlockers.length,
  );

  async function createDraft(action: "create" | "import" | "clone", importedMarkdown?: string) {
    setPendingAction(action);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          markdown: importedMarkdown,
          cloneVersionId: action === "clone" ? workspace?.currentVersionId : undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not create this Content Draft.");
      const nextDraft = body.draft as Draft;
      setDraft(nextDraft);
      setMarkdown(nextDraft.markdown);
      setWorkspace((current) => current ? { ...current, draft: nextDraft, baseMarkdown: action === "clone" ? nextDraft.markdown : current.baseMarkdown } : current);
      setSaveState("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this Content Draft.");
    } finally {
      setPendingAction(null);
    }
  }

  async function importMarkdown(file: File | undefined) {
    if (!file) return;
    if (!/\.(?:md|markdown)$/i.test(file.name) && !["text/markdown", "text/plain", ""].includes(file.type)) {
      setError("Choose a Markdown (.md) file.");
      return;
    }
    if (file.size > 256 * 1024) {
      setError("Markdown must be 256 KiB or smaller.");
      return;
    }
    const text = await file.text();
    if (draft) {
      if (!window.confirm("Replace the current editor text with this Markdown file? The change will autosave.")) return;
      setMarkdown(text);
      setSaveState("saving");
    } else {
      await createDraft("import", text);
    }
  }

  async function uploadAsset(file: File | undefined) {
    if (!file) return;
    setPendingAction("asset");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(endpoint, { method: "POST", body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not upload this Content Asset.");
      const upload = body.upload as { asset: Asset; markdownReference: string };
      setWorkspace((current) => current ? { ...current, assets: [...current.assets, upload.asset] } : current);
      setMarkdown((current) => `${current}${current.endsWith("\n") || !current ? "" : "\n\n"}${upload.markdownReference}\n`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload this Content Asset.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteAsset(assetId: string) {
    if (!window.confirm("Delete this unreferenced Content Asset?")) return;
    setPendingAction(assetId);
    try {
      const response = await fetch(`${endpoint}?assetId=${encodeURIComponent(assetId)}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not delete this Content Asset.");
      setWorkspace((current) => current ? { ...current, assets: current.assets.filter((asset) => asset.id !== assetId) } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this Content Asset.");
    } finally {
      setPendingAction(null);
    }
  }

  async function publish() {
    if (!draft || !canPublish) return;
    setPendingAction("publish");
    setError(null);
    setPublicationMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", expectedRevision: draft.revision, versionId: crypto.randomUUID(), versionNote: versionNote.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not publish this Content Draft.");
      setPublicationMessage(`Published immutable version ${body.publication.versionNumber ?? "ready"}. No Review Invitations were sent.`);
      setPublishOpen(false);
      setVersionNote("");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not publish this Content Draft.");
    } finally {
      setPendingAction(null);
    }
  }

  const statusText = saveState === "saving"
    ? "Saving…"
    : saveState === "saved"
      ? `Saved${draft ? ` · Revision ${draft.revision}` : ""}`
      : saveState === "conflict"
        ? "Conflict — autosave stopped"
        : saveState === "error"
          ? "Save failed — your local Markdown is still in this browser"
          : "Not saved";

  if (!workspace) return <div role="status" aria-live="polite" className="rounded-lg border border-border p-5">Loading Content Draft…</div>;

  if (!draft) {
    return (
      <section className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <h1 className="font-heading text-2xl font-semibold text-[#142838]">Create Content Draft</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Create a blank Markdown source, import an existing .md file, or explicitly clone the current immutable Markdown version. Reviewers cannot access this editor.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className={primaryButtonClass} disabled={Boolean(pendingAction)} onClick={() => void createDraft("create")}>Create blank draft</button>
          <label className={buttonClass}>Import .md<input type="file" accept=".md,.markdown,text/markdown,text/plain" className="sr-only" onChange={(event) => void importMarkdown(event.target.files?.[0])} /></label>
          {workspace.currentVersionId ? <button type="button" className={buttonClass} disabled={Boolean(pendingAction)} onClick={() => void createDraft("clone")}>Clone current Markdown version</button> : null}
        </div>
        {error ? <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">Content Approvals · Content Draft</p>
          <h1 className="mt-1 font-heading text-2xl font-semibold text-[#142838]">Markdown Content Wireframe</h1>
          <p className="mt-1 text-sm text-muted-foreground">One authoritative editable source for this Review Document.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className="rounded-full bg-[#f0f3f5] px-3 py-2 text-sm font-medium text-[#142838]">{statusText}</span>
          <a className={buttonClass} href={`${endpoint}?export=markdown`}>Export .md</a>
          <label className={buttonClass}>Import .md<input type="file" accept=".md,.markdown,text/markdown,text/plain" className="sr-only" onChange={(event) => void importMarkdown(event.target.files?.[0])} /></label>
          <button type="button" className={primaryButtonClass} onClick={() => setPublishOpen(true)} disabled={saveState === "saving" || saveState === "conflict"}>Publish check</button>
        </div>
      </header>

      {publicationMessage ? <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">{publicationMessage}</p> : null}
      {error ? <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error} {saveState === "error" ? <button type="button" className="ml-2 underline" onClick={() => setSaveAttempt((value) => value + 1)}>Retry save</button> : null}</p> : null}

      {conflict ? (
        <div role="alert" aria-live="assertive" className="space-y-4 rounded-xl border-2 border-red-400 bg-red-50 p-5 text-red-950">
          <div><strong>Conflict — autosave stopped.</strong> Another collaborator saved a newer revision. No text was overwritten.</div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div><h2 className="font-semibold">Your unsaved local Markdown</h2><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs">{markdown}</pre></div>
            <div><h2 className="font-semibold">Latest saved Markdown · Revision {conflict.latest.revision}</h2><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs">{conflict.latest.markdown}</pre></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => {
              if (!window.confirm("Discard your local Markdown and reload the latest saved revision?")) return;
              setDraft(conflict.latest);
              setMarkdown(conflict.latest.markdown);
              setConflict(null);
              setSaveState("saved");
            }}>Reload latest</button>
            <button type="button" className={buttonClass} onClick={() => void navigator.clipboard.writeText(markdown)}>Copy local</button>
            <a className={buttonClass} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`} download="conflicted-content-draft.md">Download local .md</a>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 md:hidden" aria-label="Editor view">
        <button type="button" className={view === "editor" ? primaryButtonClass : buttonClass} aria-pressed={view === "editor"} onClick={() => setView("editor")}>Editor</button>
        <button type="button" className={view === "preview" ? primaryButtonClass : buttonClass} aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</button>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className={`${view === "editor" ? "block" : "hidden"} min-w-0 space-y-4 md:block`}>
          <label className="block rounded-xl border border-border bg-white p-4 shadow-sm">
            <span className="font-heading text-lg font-semibold text-[#142838]">Markdown source</span>
            <textarea
              aria-label="Markdown source"
              value={markdown}
              onChange={(event) => {
                setMarkdown(event.target.value);
                if (!conflict) setSaveState("saving");
              }}
              spellCheck
              className="mt-3 min-h-[620px] w-full resize-y rounded-lg border border-input bg-[#fbfcfc] p-4 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ember"
            />
          </label>

          <section aria-labelledby="asset-heading" className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 id="asset-heading" className="font-heading text-lg font-semibold text-[#142838]">Content Assets</h2><p className="text-sm text-muted-foreground">Private PNG, JPEG, or WebP images up to 25 MB.</p></div>
              <label className={buttonClass}>Upload image<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={pendingAction === "asset"} onChange={(event) => void uploadAsset(event.target.files?.[0])} /></label>
            </div>
            <ul className="mt-3 space-y-2">
              {workspace.assets.map((asset) => <li key={asset.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"><span className="truncate">{asset.originalFilename}</span><button type="button" className={buttonClass} disabled={pendingAction === asset.id} onClick={() => void deleteAsset(asset.id)}>Delete</button></li>)}
              {!workspace.assets.length ? <li className="text-sm text-muted-foreground">No Content Assets uploaded.</li> : null}
            </ul>
          </section>

          <section aria-labelledby="diagnostics-heading" className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <h2 id="diagnostics-heading" className="font-heading text-lg font-semibold text-[#142838]">Diagnostics</h2>
            <ul className="mt-3 space-y-2">
              {parsed.diagnostics.map((item, index) => <li key={`${item.code}:${item.line}:${index}`} className={`rounded-md border p-3 text-sm ${item.severity === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}><strong>{item.severity === "error" ? "Publish blocker" : "Warning"}</strong> · Line {item.line}: {item.message}</li>)}
              {!parsed.diagnostics.length ? <li className="text-sm text-green-800">No structural or security diagnostics.</li> : null}
            </ul>
          </section>
        </div>

        <div className={`${view === "preview" ? "block" : "hidden"} min-w-0 md:block`}>
          <div className="md:sticky md:top-4">
            <ContentWireframeRenderer manifest={parsed.manifest} assetUrl={(assetId) => `${endpoint}?assetId=${encodeURIComponent(assetId)}`} />
          </div>
        </div>
      </div>

      {publishOpen ? (
        <section aria-labelledby="publish-heading" className="space-y-5 rounded-xl border-2 border-[#142838] bg-white p-5 shadow-lg">
          <div><h2 id="publish-heading" className="font-heading text-2xl font-semibold text-[#142838]">Publish check</h2><p className="mt-1 text-sm text-muted-foreground">Publishing creates one immutable ready Review Document version. It does not start a Review Round or send an invitation.</p></div>
          <label className="block"><span className="text-sm font-medium">Version note <span aria-hidden="true">*</span></span><input value={versionNote} onChange={(event) => setVersionNote(event.target.value)} maxLength={300} required className="mt-2 w-full rounded-md border border-input px-3 py-2 text-sm" placeholder="Summarize what changed for Reviewers." /></label>
          <div className="grid gap-4 lg:grid-cols-2">
            <div><h3 className="font-semibold">Markdown diff from base version</h3><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[#f7f8f9] p-3 text-xs">{diff.map((line, index) => <span key={`${index}:${line.kind}`} className={`block ${line.kind === "added" ? "text-green-800" : line.kind === "removed" ? "text-red-800" : "text-muted-foreground"}`}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.line}</span>)}</pre></div>
            <div><h3 className="font-semibold">Feedback dispositions</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm"><dt>Resolved</dt><dd>{workspace.feedbackStatuses.filter((item) => item === "resolved").length}</dd><dt>Declined</dt><dd>{workspace.feedbackStatuses.filter((item) => item === "declined").length}</dd><dt>Needs clarification</dt><dd>{workspace.feedbackStatuses.filter((item) => item === "needs_clarification").length}</dd><dt>Blocking</dt><dd className={feedbackBlockers.length ? "font-semibold text-red-700" : "text-green-800"}>{feedbackBlockers.length}</dd></dl></div>
          </div>
          <ContentWireframeRenderer manifest={parsed.manifest} assetUrl={(assetId) => `${endpoint}?assetId=${encodeURIComponent(assetId)}`} />
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{workspace.approvalStatement}</p>
          <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass} onClick={() => setPublishOpen(false)}>Cancel</button><button type="button" className={primaryButtonClass} disabled={!canPublish || pendingAction === "publish"} onClick={() => void publish()}>Publish immutable version</button></div>
        </section>
      ) : null}
    </section>
  );
}
