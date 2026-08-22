import { describe, expect, it } from "vitest";
import {
  ContentDraftPublishError,
  createReviewContentDraft,
  deleteReviewContentAsset,
  getAdminContentAsset,
  prepareContentDraftPublication,
  publishReviewContentDraft,
  saveContentDraft,
  uploadReviewContentAsset,
} from "@/lib/bsm/review-content-drafts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const PUBLICATION_ID = "88888888-8888-4888-8888-888888888888";
const ASSET_ID = "66666666-6666-4666-8666-666666666666";

type DraftRow = {
  id: string;
  project_id: string;
  shop_id: string;
  review_item_id: string;
  markdown_text: string;
  revision: number;
  base_version_id: string | null;
  created_by_profile_id: string;
  last_writer_profile_id: string;
  created_at: string;
  updated_at: string;
};

class DraftClient {
  draft: DraftRow | null = {
    id: DRAFT_ID,
    project_id: PROJECT_ID,
    shop_id: SHOP_ID,
    review_item_id: DOCUMENT_ID,
    markdown_text: "Original",
    revision: 3,
    base_version_id: null,
    created_by_profile_id: ACTOR_ID,
    last_writer_profile_id: ACTOR_ID,
    created_at: "2026-08-21T10:00:00.000Z",
    updated_at: "2026-08-21T10:00:00.000Z",
  };
  asset: Record<string, unknown> | null = null;
  versionManifests: unknown[] = [];
  events: Array<Record<string, unknown>> = [];
  uploads: Array<{ bucket: string; path: string; contentType: string }> = [];
  rpcCalls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  publishedVersion: Record<string, unknown> | null = null;
  currentContentType = "text/markdown";
  tables = new Set<string>();

  storage = {
    from: (bucket: string) => ({
      download: async () => ({ data: new Blob(["# Cloned version\n\nExisting copy."]), error: null }),
      remove: async () => ({ error: null }),
      upload: async (path: string, _body: Uint8Array, options: { contentType: string }) => {
        const duplicate = this.uploads.some((entry) => entry.bucket === bucket && entry.path === path);
        if (!duplicate) this.uploads.push({ bucket, path, contentType: options.contentType });
        return { error: duplicate ? { message: "already exists" } : null };
      },
    }),
  };

  rpc = async (functionName: string, args: Record<string, unknown>) => {
    this.rpcCalls.push({ functionName, args });
    this.publishedVersion = {
      id: args.p_version_id,
      version_number: 2,
      checksum_sha256: args.p_checksum_sha256,
      source_metadata_jsonb: args.p_source_metadata,
      artifact_manifest_jsonb: args.p_artifact_manifest,
    };
    return {
      data: { id: args.p_version_id, version_number: 2 },
      error: null,
    };
  };

  from = (table: string) => {
    this.tables.add(table);
    return new DraftQuery(this, table);
  };
}

class DraftQuery {
  private action: "select" | "update" | "insert" = "select";
  private payload: Record<string, unknown> | null = null;
  private filters: Record<string, unknown> = {};

  constructor(private client: DraftClient, private table: string) {}

  select() { return this; }
  update(payload: Record<string, unknown>) { this.action = "update"; this.payload = payload; return this; }
  insert(payload: Record<string, unknown>) { this.action = "insert"; this.payload = payload; return this; }
  eq(column: string, value: unknown) { this.filters[column] = value; return this; }
  is(column: string, value: unknown) { this.filters[column] = value; return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve(this.execute(true)); }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }

  private execute(single: boolean) {
    if (this.table === "bsm_content_review_projects") {
      return { data: { id: PROJECT_ID, shop_id: SHOP_ID, status: "ready", deleted_at: null }, error: null };
    }
    if (this.table === "bsm_content_review_project_collaborators") {
      return { data: { role: "owner" }, error: null };
    }
    if (this.table === "bsm_content_review_items") {
      return { data: { id: DOCUMENT_ID, project_id: PROJECT_ID, shop_id: SHOP_ID, current_version_id: VERSION_ID, deleted_at: null }, error: null };
    }
    if (this.table === "bsm_content_review_versions") {
      if (single) {
        if (this.filters.id === PUBLICATION_ID) {
          return { data: this.client.publishedVersion, error: null };
        }
        return {
          data: {
            id: VERSION_ID,
            project_id: PROJECT_ID,
            shop_id: SHOP_ID,
            review_item_id: DOCUMENT_ID,
            content_type: this.client.currentContentType,
            original_filename: this.client.currentContentType === "text/markdown" ? "content.md" : "proof.pdf",
            preview_type: null,
            storage_bucket: "bsm-content-approvals",
            storage_path: `${SHOP_ID}/${DOCUMENT_ID}/${VERSION_ID}/content.md`,
          },
          error: null,
        };
      }
      return {
        data: this.client.versionManifests.map((artifact_manifest_jsonb, index) => ({ id: `version-${index}`, artifact_manifest_jsonb })),
        error: null,
      };
    }
    if (this.table === "bsm_content_review_assets") {
      if (this.action === "update") {
        if (!this.client.asset) return { data: null, error: null };
        this.client.asset = { ...this.client.asset, ...this.payload };
        return { data: this.client.asset, error: null };
      }
      const asset = this.filters.deleted_at === null && this.client.asset?.deleted_at ? null : this.client.asset;
      return { data: single ? asset : asset ? [asset] : [], error: null };
    }
    if (this.table === "bsm_content_review_comment_threads") {
      return { data: [], error: null };
    }
    if (this.table === "bsm_content_review_drafts" && this.action === "update") {
      if (!this.client.draft || this.filters.revision !== this.client.draft.revision) return { data: null, error: null };
      this.client.draft = { ...this.client.draft, ...this.payload } as DraftRow;
      return { data: this.client.draft, error: null };
    }
    if (this.table === "bsm_content_review_drafts" && this.action === "insert") {
      this.client.draft = this.payload as DraftRow;
      return { data: this.client.draft, error: null };
    }
    if (this.table === "bsm_content_review_drafts") {
      return { data: single ? this.client.draft : [this.client.draft], error: null };
    }
    if (this.table === "bsm_content_review_events" && this.action === "insert") {
      this.client.events.push(this.payload ?? {});
      return { data: null, error: null };
    }
    throw new Error(`Unexpected ${this.action} on ${this.table}`);
  }
}

describe("Content Draft service", () => {
  it("compare-and-increments a matching revision and preserves both values on a stale save", async () => {
    const client = new DraftClient();
    const saved = await saveContentDraft({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      expectedRevision: 3,
      markdown: "First saved revision",
    }, { client: client as never });

    expect(saved).toMatchObject({ revision: 4, markdown: "First saved revision" });

    await expect(saveContentDraft({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      expectedRevision: 3,
      markdown: "Unsaved local revision",
    }, { client: client as never })).rejects.toMatchObject({
      status: 409,
      localMarkdown: "Unsaved local revision",
      latest: { revision: 4, markdown: "First saved revision" },
    });

    expect(client.events.map((event) => event.event_type)).toEqual([
      "content_draft_saved",
      "content_draft_save_conflict",
    ]);
  });

  it("prepares an immutable manifest, exact asset set, and readable base-version diff", () => {
    const assetId = "66666666-6666-4666-8666-666666666666";
    const publication = prepareContentDraftPublication({
      documentId: DOCUMENT_ID,
      baseVersionId: "77777777-7777-4777-8777-777777777777",
      baseMarkdown: "# Original hero\n\nOriginal support copy.",
      markdown: `# Revised hero\n\nOriginal support copy.\n\n![Repair technician](asset:${assetId})`,
      versionNote: "Updates the hero and adds the selected shop image.",
      assets: [{ id: assetId, documentId: DOCUMENT_ID }],
      feedbackStatuses: ["resolved", "declined", "needs_clarification"],
    });

    expect(publication.manifest.assetIds).toEqual([assetId]);
    expect(publication.metadata).toMatchObject({
      sourceKind: "content_draft",
      baseVersionId: "77777777-7777-4777-8777-777777777777",
      versionNote: "Updates the hero and adds the selected shop image.",
      parserContractVersion: 1,
      orderedAssetIds: [assetId],
    });
    expect(publication.diff).toEqual(expect.arrayContaining([
      { kind: "removed", line: "# Original hero" },
      { kind: "added", line: "# Revised hero" },
      { kind: "context", line: "Original support copy." },
      { kind: "added", line: `![Repair technician](asset:${assetId})` },
    ]));
  });

  it("returns structural and feedback blockers together for the Publish check", () => {
    try {
      prepareContentDraftPublication({
        documentId: DOCUMENT_ID,
        baseVersionId: "77777777-7777-4777-8777-777777777777",
        baseMarkdown: "# Existing",
        markdown: "Draft without its required hero.",
        versionNote: "Prepare the next review round.",
        assets: [],
        feedbackStatuses: ["resolved", "open", "clarification_answered"],
      });
      throw new Error("Expected publication to be blocked");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentDraftPublishError);
      expect(error).toMatchObject({
        status: 422,
        diagnostics: [expect.objectContaining({ code: "missing_hero", severity: "error" })],
        feedbackStatuses: ["open", "clarification_answered"],
      });
    }
  });

  it("imports Markdown into the one authoritative draft without mutating its base version", async () => {
    const client = new DraftClient();
    client.draft = null;

    const draft = await createReviewContentDraft({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      source: "import",
      markdown: "# Imported page\n\nExisting customer copy.",
    }, { client: client as never, now: new Date("2026-08-21T12:00:00.000Z") });

    expect(draft).toMatchObject({
      documentId: DOCUMENT_ID,
      markdown: "# Imported page\n\nExisting customer copy.",
      revision: 0,
      baseVersionId: VERSION_ID,
    });
    expect(client.events.at(-1)?.event_type).toBe("content_draft_imported");
  });

  it("clones the selected immutable Markdown version into the one draft", async () => {
    const client = new DraftClient();
    client.draft = null;

    const draft = await createReviewContentDraft({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      source: "clone",
      cloneVersionId: VERSION_ID,
    }, { client: client as never });

    expect(draft).toMatchObject({
      markdown: "# Cloned version\n\nExisting copy.",
      baseVersionId: VERSION_ID,
      revision: 0,
    });
    expect(client.events.at(-1)?.event_type).toBe("content_draft_cloned");
  });

  it("publishes idempotently without reading or changing rounds or invitations", async () => {
    const client = new DraftClient();
    client.draft = { ...client.draft!, markdown_text: "# Ready for review\n\nClear supporting copy.", base_version_id: null };
    const input = {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      expectedRevision: 3,
      versionId: PUBLICATION_ID,
      versionNote: "Clarified the customer promise.",
    };

    const first = await publishReviewContentDraft(input, { client: client as never });
    const retry = await publishReviewContentDraft(input, { client: client as never });

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      versionId: PUBLICATION_ID,
      versionNumber: 2,
      status: "ready",
      sentInvitations: 0,
      activeRoundChanged: false,
    });
    expect(client.uploads).toHaveLength(1);
    expect(client.uploads[0]?.contentType).toBe("text/plain");
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]).toMatchObject({
      functionName: "publish_bsm_content_draft_version",
      args: {
        p_version_id: PUBLICATION_ID,
        p_expected_revision: 3,
        p_source_metadata: {
          sourceKind: "content_draft",
          draftId: DRAFT_ID,
          draftRevision: 3,
        },
      },
    });
    expect(client.tables.has("bsm_content_review_rounds")).toBe(false);
    expect(client.tables.has("bsm_content_review_round_documents")).toBe(false);
    expect(client.tables.has("bsm_content_review_invitations")).toBe(false);
  });

  it("rejects draft creation for a non-Markdown Review Document", async () => {
    const client = new DraftClient();
    client.currentContentType = "application/pdf";
    client.draft = null;

    await expect(createReviewContentDraft({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      source: "import",
      markdown: "# This must not become a PDF draft",
    }, { client: client as never })).rejects.toMatchObject({ status: 409 });

    expect(client.draft).toBeNull();
  });

  it("denies deletion when an immutable published manifest references the asset", async () => {
    const client = new DraftClient();
    client.asset = {
      id: ASSET_ID,
      project_id: PROJECT_ID,
      shop_id: SHOP_ID,
      review_item_id: DOCUMENT_ID,
      deleted_at: null,
    };
    client.versionManifests = [{ contractVersion: 1, blocks: [], assetIds: [ASSET_ID] }];

    await expect(deleteReviewContentAsset({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      assetId: ASSET_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
    }, { client: client as never })).rejects.toMatchObject({ status: 409 });
    expect(client.asset.deleted_at).toBeNull();
  });

  it("does not return a soft-deleted Content Asset", async () => {
    const client = new DraftClient();
    client.asset = {
      id: ASSET_ID,
      project_id: PROJECT_ID,
      shop_id: SHOP_ID,
      review_item_id: DOCUMENT_ID,
      deleted_at: "2026-08-21T12:00:00.000Z",
      storage_bucket: "bsm-content-approvals",
      storage_path: `${SHOP_ID}/${DOCUMENT_ID}/assets/${ASSET_ID}`,
      original_filename: "deleted.png",
      content_type: "image/png",
    };

    await expect(getAdminContentAsset({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      assetId: ASSET_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
    }, { client: client as never })).rejects.toMatchObject({ status: 404 });
  });

  it("rejects an asset whose bytes do not match its declared image type", async () => {
    await expect(uploadReviewContentAsset({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      actorProfileId: ACTOR_ID,
      actorRole: "psg_internal",
      fileName: "not-an-image.png",
      contentType: "image/png",
      bytes: new TextEncoder().encode("not an image"),
    })).rejects.toMatchObject({ status: 415 });
  });
});
