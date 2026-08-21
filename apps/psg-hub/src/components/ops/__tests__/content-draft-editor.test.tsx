// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentDraftEditor,
  type ContentDraftWorkspacePayload,
} from "@/components/ops/content-draft-editor";

const workspace: ContentDraftWorkspacePayload = {
  draft: {
    id: "44444444-4444-4444-8444-444444444444",
    projectId: "11111111-1111-4111-8111-111111111111",
    shopId: "22222222-2222-4222-8222-222222222222",
    documentId: "33333333-3333-4333-8333-333333333333",
    markdown: "# Original page",
    revision: 1,
    baseVersionId: null,
    createdByProfileId: "55555555-5555-4555-8555-555555555555",
    lastWriterProfileId: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
  },
  currentVersionId: null,
  assets: [],
  manifest: { contractVersion: 1, blocks: [{ id: "hero:1", kind: "hero", ordinal: 1, text: "Original page" }], assetIds: [] },
  diagnostics: [],
  baseMarkdown: "",
  diff: [],
  feedbackStatuses: [],
  feedbackReferences: [{
    id: "66666666-6666-4666-8666-666666666666",
    threadId: "77777777-7777-4777-8777-777777777777",
    kind: "pin",
    status: "needs_clarification",
    body: "Confirm the warranty language.",
    selectedText: "Lifetime warranty",
    pinNumber: 2,
    createdAt: "2026-08-21T09:00:00.000Z",
  }],
  approvalStatement: "Content and structure only.",
};

describe("ContentDraftEditor", () => {
  let container: HTMLDivElement;

  function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    vi.restoreAllMocks();
  });

  it("announces Saving and Saved, then stops autosave and preserves both Markdown values on conflict", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        draft: { ...workspace.draft, markdown: "# First edit", revision: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "This Content Draft was changed in another session.",
        conflict: {
          localMarkdown: "# Local conflict",
          latest: { ...workspace.draft, markdown: "# Saved elsewhere", revision: 3 },
        },
      }), { status: 409, headers: { "Content-Type": "application/json" } }));

    const root = createRoot(container);
    await act(async () => root.render(
      <ContentDraftEditor
        projectId={workspace.draft!.projectId}
        documentId={workspace.draft!.documentId}
        initialWorkspace={workspace}
        autosaveDelayMs={20}
      />,
    ));

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Markdown source']")!;
    expect(container.textContent).toContain("Prior-version feedback (1)");
    expect(container.textContent).toContain("Confirm the warranty language.");
    await act(async () => {
      changeTextarea(textarea, "# First edit");
    });
    expect(container.querySelector("[role='status']")?.textContent).toContain("Saving");
    await act(async () => { await vi.advanceTimersByTimeAsync(25); });
    expect(container.querySelector("[role='status']")?.textContent).toContain("Saved");

    await act(async () => {
      changeTextarea(textarea, "# Local conflict");
      await vi.advanceTimersByTimeAsync(25);
    });

    expect(container.querySelector("[role='alert']")?.textContent).toContain("Conflict");
    expect(container.textContent).toContain("# Local conflict");
    expect(container.textContent).toContain("# Saved elsewhere");
    expect(container.textContent).toContain("Reload latest");
    expect(container.textContent).toContain("Copy local");

    await act(async () => {
      changeTextarea(textarea, "# More local edits");
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it("preserves failed local edits, shows diagnostics, switches views, and blocks publication", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unavailable"));
    const root = createRoot(container);
    await act(async () => root.render(
      <ContentDraftEditor
        projectId={workspace.draft!.projectId}
        documentId={workspace.draft!.documentId}
        initialWorkspace={workspace}
        autosaveDelayMs={20}
      />,
    ));

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Markdown source']")!;
    await act(async () => {
      changeTextarea(textarea, "Copy without a hero");
      await vi.advanceTimersByTimeAsync(25);
    });

    expect(container.querySelector("[role='status']")?.textContent).toContain("Save failed");
    expect(textarea.value).toBe("Copy without a hero");
    expect(container.textContent).toContain("Publish blocker");
    expect(container.textContent).toContain("Add exactly one H1 hero heading");

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Preview")!;
    await act(async () => previewButton.click());
    expect(previewButton.getAttribute("aria-pressed")).toBe("true");

    const publishCheck = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish check")!;
    await act(async () => publishCheck.click());
    const publishButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Publish immutable version") as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
