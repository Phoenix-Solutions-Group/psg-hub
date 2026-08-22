import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReviewContentDraft: vi.fn(),
  getReviewContentDraftWorkspace: vi.fn(),
  requireOpsFn: vi.fn(),
  saveContentDraft: vi.fn(),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: mocks.requireOpsFn,
}));

vi.mock("@/lib/bsm/review-content-drafts", () => ({
  CONTENT_DRAFT_MAX_BYTES: 256 * 1024,
  ContentDraftConflictError: class extends Error {
    status = 409;
    localMarkdown: string;
    latest: Record<string, unknown>;
    constructor(localMarkdown: string, latest: Record<string, unknown>) {
      super("This Content Draft was changed in another session.");
      this.localMarkdown = localMarkdown;
      this.latest = latest;
    }
  },
  ContentDraftPublishError: class extends Error { status = 422; diagnostics = []; feedbackStatuses = []; },
  createReviewContentDraft: mocks.createReviewContentDraft,
  deleteReviewContentAsset: vi.fn(),
  getAdminContentAsset: vi.fn(),
  getReviewContentDraftWorkspace: mocks.getReviewContentDraftWorkspace,
  publishReviewContentDraft: vi.fn(),
  saveContentDraft: mocks.saveContentDraft,
  uploadReviewContentAsset: vi.fn(),
}));

vi.mock("@/lib/bsm/review-workspace", () => ({
  ReviewWorkspaceInputError: class extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  },
}));

import { GET, POST, PUT } from "@/app/api/ops/bsm/review-workspace/projects/[id]/documents/[documentId]/draft/route";

const context = {
  params: Promise.resolve({
    id: "11111111-1111-4111-8111-111111111111",
    documentId: "33333333-3333-4333-8333-333333333333",
  }),
};

describe("Content Draft route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createReviewContentDraft.mockReset();
    mocks.getReviewContentDraftWorkspace.mockReset();
    mocks.requireOpsFn.mockResolvedValue({
      ok: true,
      userId: "55555555-5555-4555-8555-555555555555",
      access: { role: "psg_internal" },
    });
    mocks.saveContentDraft.mockReset();
  });

  it.each([401, 403])("returns %s before loading tenant-scoped data", async (status) => {
    mocks.requireOpsFn.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: status === 401 ? "Authentication required" : "Forbidden" }, { status }),
    });

    const response = await GET(new Request("https://hub.test/api/draft"), context);

    expect(response.status).toBe(status);
    expect(mocks.getReviewContentDraftWorkspace).not.toHaveBeenCalled();
  });

  it("returns a tenant-neutral 404 for a missing document", async () => {
    const InputError = (await import("@/lib/bsm/review-workspace")).ReviewWorkspaceInputError;
    mocks.getReviewContentDraftWorkspace.mockRejectedValueOnce(new InputError(404, "Review Document not found"));

    const response = await GET(new Request("https://hub.test/api/draft"), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Review Document not found" });
  });

  it("returns the local and latest Markdown on a stale autosave without hiding either value", async () => {
    const latest = {
      id: "44444444-4444-4444-8444-444444444444",
      projectId: "11111111-1111-4111-8111-111111111111",
      shopId: "22222222-2222-4222-8222-222222222222",
      documentId: "33333333-3333-4333-8333-333333333333",
      markdown: "Latest saved text",
      revision: 5,
      baseVersionId: null,
      createdByProfileId: "55555555-5555-4555-8555-555555555555",
      lastWriterProfileId: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: "2026-08-21T10:05:00.000Z",
    };
    const Conflict = (await import("@/lib/bsm/review-content-drafts")).ContentDraftConflictError;
    mocks.saveContentDraft.mockRejectedValue(new Conflict("Unsaved local text", latest));

    const response = await PUT(new Request("https://hub.test/api/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4, markdown: "Unsaved local text" }),
    }), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This Content Draft was changed in another session.",
      conflict: { localMarkdown: "Unsaved local text", latest },
    });
  });

  it("rejects Markdown over 256 KiB before calling the draft service", async () => {
    const response = await PUT(new Request("https://hub.test/api/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4, markdown: "x".repeat(256 * 1024 + 1) }),
    }), context);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Markdown must be 256 KiB or smaller" });
    expect(mocks.saveContentDraft).not.toHaveBeenCalled();
  });

  it("applies the same Markdown limit to imports", async () => {
    const response = await POST(new Request("https://hub.test/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import", markdown: "x".repeat(256 * 1024 + 1) }),
    }), context);

    expect(response.status).toBe(413);
    expect(mocks.createReviewContentDraft).not.toHaveBeenCalled();
  });
});
