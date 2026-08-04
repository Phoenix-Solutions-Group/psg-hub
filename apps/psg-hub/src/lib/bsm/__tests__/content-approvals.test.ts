import { describe, expect, it, vi } from "vitest";
import {
  ApprovalUploadInputError,
  BSM_CONTENT_APPROVALS_BUCKET,
  archiveBsmContentApproval,
  attachBsmContentApprovalToWorkspace,
  approvalStoragePath,
  createBsmGeneratedPageApproval,
  createBsmContentApprovalUpload,
  listBsmContentApprovalWorkspaces,
  normalizeApprovalFileName,
  updateBsmContentApproval,
  validateApprovalFile,
} from "@/lib/bsm/content-approvals";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ROUND_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";

function schemaCacheColumnError(table: string, column: string) {
  return {
    code: "PGRST204",
    message: `Could not find the '${column}' column of '${table}' in the schema cache`,
  };
}

function createFakeClient() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; id: string }> = [];
  const deletes: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, id: string) {
              expect(column).toBe("id");
              updates.push({ table, payload, id });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return {
            eq(column: string, id: string) {
              deletes.push({ table, filters: { [column]: id } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client, inserts, updates, deletes };
}

function createArchiveFakeClient(item: Record<string, unknown>) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; id: string }> = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, id: string) {
              expect(table).toBe("bsm_content_review_items");
              expect(column).toBe("id");
              expect(id).toBe(item.id);
              return {
                single: () => Promise.resolve({ data: item, error: null }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, id: string) {
              expect(table).toBe("bsm_content_review_items");
              expect(column).toBe("id");
              updates.push({ table, payload, id });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserts, updates };
}

class ChainUpdate {
  private filters: Record<string, unknown> = {};

  constructor(
    private table: string,
    private payload: Record<string, unknown>,
    private updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }>,
  ) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  then(resolve: (value: { error: null }) => unknown) {
    this.updates.push({ table: this.table, payload: this.payload, filters: { ...this.filters } });
    return Promise.resolve({ error: null }).then(resolve);
  }
}

class ChainDelete {
  private filters: Record<string, unknown> = {};

  constructor(
    private table: string,
    private deletes: Array<{ table: string; filters: Record<string, unknown> }>,
  ) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  then(resolve: (value: { error: null }) => unknown) {
    this.deletes.push({ table: this.table, filters: { ...this.filters } });
    return Promise.resolve({ error: null }).then(resolve);
  }
}

class ChainSelect {
  private filters: Record<string, unknown> = {};

  constructor(
    private table: string,
    private options: {
      collaborator?: Record<string, unknown> | null;
      existingItemProjectId?: string | null;
      existingReviewers?: Array<Record<string, unknown>>;
      missingSchemaCacheColumns?: Map<string, string[]>;
      projectStatus?: string;
      roundStatus?: string;
    } = {},
    private selectedColumns = "",
  ) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  in(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  is(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  maybeSingle() {
    if (this.table === "bsm_content_review_projects") {
      return Promise.resolve({
        data: {
          id: PROJECT_ID,
          shop_id: SHOP_ID,
          title: "July customer review",
          status: this.options.projectStatus ?? "ready",
          current_round_id: ROUND_ID,
          deleted_at: null,
        },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_project_collaborators") {
      return Promise.resolve({
        data: this.options.collaborator === undefined ? { role: "owner" } : this.options.collaborator,
        error: null,
      });
    }
    if (this.table === "bsm_content_review_versions") {
      return Promise.resolve({
        data: {
          id: VERSION_ID,
          original_filename: "proof-v1.pdf",
          content_type: "application/pdf",
          byte_size: 1024,
          storage_path: `${SHOP_ID}/${ITEM_ID}/${VERSION_ID}/proof-v1.pdf`,
          preview_type: "file",
          source_metadata_jsonb: {},
        },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_rounds") {
      return Promise.resolve({
        data: {
          id: ROUND_ID,
          status: this.options.roundStatus ?? "draft",
        },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_reviewers") {
      return Promise.resolve({ data: this.options.existingReviewers ?? [], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }

  single() {
    if (this.table === "bsm_content_review_items") {
      return Promise.resolve({
        data: {
          id: ITEM_ID,
          shop_id: SHOP_ID,
          customer_profile_id: PROFILE_ID,
          title: "Old proof",
          status: "in_review",
          content_type: "pdf",
          project_id: this.options.existingItemProjectId ?? PROJECT_ID,
          current_version_id: VERSION_ID,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
    const missingColumn = this.options.missingSchemaCacheColumns
      ?.get(this.table)
      ?.find((column) => this.selectedColumns.includes(column) || column in this.filters);
    if (missingColumn) {
      return Promise.resolve({
        data: [],
        error: schemaCacheColumnError(this.table, missingColumn),
      }).then(resolve as never);
    }

    if (this.table === "bsm_content_review_items") {
      return Promise.resolve({ data: [{ position: 2 }], error: null }).then(resolve);
    }
    if (this.table === "bsm_content_review_versions") {
      return Promise.resolve({ data: [{ version_number: 1 }], error: null }).then(resolve);
    }
    if (this.table === "bsm_content_review_invitations") {
      return Promise.resolve({
        data: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            reviewer_profile_id: PROFILE_ID,
            reviewer_email: "owner@example.com",
            reviewer_name: "Shop Owner",
          },
        ],
        error: null,
      }).then(resolve);
    }
    if (this.table === "bsm_content_review_reviewers") {
      return Promise.resolve({ data: this.options.existingReviewers ?? [], error: null }).then(resolve);
    }
    return Promise.resolve({ data: [], error: null }).then(resolve);
  }
}

function createWorkspaceFakeClient(options: {
  collaborator?: Record<string, unknown> | null;
  insertErrorsByTable?: Record<string, string>;
  existingItemProjectId?: string | null;
  existingReviewers?: Array<Record<string, unknown>>;
  missingSchemaCacheColumnsByTable?: Record<string, string[]>;
  projectStatus?: string;
  roundStatus?: string;
} = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> | Array<Record<string, unknown>> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const deletes: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const missingSchemaCacheColumns = new Map(
    Object.entries(options.missingSchemaCacheColumnsByTable ?? {}).map(([table, columns]) => [table, [...columns]]),
  );
  const client = {
    from(table: string) {
      return {
        select(columns?: string) {
          return new ChainSelect(table, { ...options, missingSchemaCacheColumns }, columns ?? "");
        },
        insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
          inserts.push({ table, payload });
          const missingColumn = missingSchemaCacheColumns.get(table)?.find((column) => {
            const rows = Array.isArray(payload) ? payload : [payload];
            return rows.some((row) => column in row);
          });
          if (missingColumn) return Promise.resolve({ error: schemaCacheColumnError(table, missingColumn) });
          const message = options.insertErrorsByTable?.[table];
          if (message) return Promise.resolve({ error: { message } });
          return Promise.resolve({ error: null });
        },
        update(payload: Record<string, unknown>) {
          return new ChainUpdate(table, payload, updates);
        },
        delete() {
          return new ChainDelete(table, deletes);
        },
      };
    },
  };
  return { client, inserts, updates, deletes };
}

class WorkspaceListSelect {
  private filters: Record<string, unknown> = {};

  constructor(private table: string) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  in(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  is(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
    if (this.table === "bsm_content_review_projects") {
      expect(this.filters.status).toEqual(["draft", "processing", "ready", "active", "completed"]);
      return Promise.resolve({
        data: [
          {
            id: PROJECT_ID,
            shop_id: SHOP_ID,
            title: "Production upload retest",
            status: "ready",
            current_round_id: ROUND_ID,
          },
          {
            id: "99999999-9999-4999-8999-999999999999",
            shop_id: SHOP_ID,
            title: "Active reviewer feedback",
            status: "active",
            current_round_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            shop_id: SHOP_ID,
            title: "Completed reviewer feedback",
            status: "completed",
            current_round_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          },
        ],
        error: null,
      }).then(resolve);
    }
    if (this.table === "bsm_content_review_items") {
      expect(this.filters.project_id).toEqual([
        PROJECT_ID,
        "99999999-9999-4999-8999-999999999999",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ]);
      return Promise.resolve({
        data: [
          { project_id: PROJECT_ID },
          { project_id: PROJECT_ID },
          { project_id: "99999999-9999-4999-8999-999999999999" },
          { project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        ],
        error: null,
      }).then(resolve);
    }
    throw new Error(`Unexpected table ${this.table}`);
  }
}

function createWorkspaceListFakeClient() {
  const selectedTables: string[] = [];
  const client = {
    from(table: string) {
      selectedTables.push(table);
      return {
        select() {
          return new WorkspaceListSelect(table);
        },
      };
    },
  };
  return { client, selectedTables };
}

describe("BSM content approval upload helpers", () => {
  it("accepts only supported file types and size limits", () => {
    expect(validateApprovalFile("application/pdf", 1024)).toEqual({
      extension: "pdf",
      contentType: "pdf",
      mimeType: "application/pdf",
    });
    expect(validateApprovalFile("", 1024, "proof.PDF")).toEqual({
      extension: "pdf",
      contentType: "pdf",
      mimeType: "application/pdf",
    });
    expect(validateApprovalFile("text/markdown", 1024, "copy.md")).toEqual({
      extension: "md",
      contentType: "document",
      mimeType: "text/markdown",
    });
    expect(validateApprovalFile("", 1024, "landing-page.html")).toEqual({
      extension: "html",
      contentType: "document",
      mimeType: "text/html",
    });
    expect(validateApprovalFile("text/html", 1024, "landing-page.html")).toEqual({
      extension: "html",
      contentType: "document",
      mimeType: "text/html",
    });
    expect(validateApprovalFile("text/plain", 1024, "uploaded-proof.html")).toEqual({
      extension: "html",
      contentType: "document",
      mimeType: "text/html",
    });

    expect(() => validateApprovalFile("application/zip", 1024)).toThrow(
      ApprovalUploadInputError,
    );
    expect(() => validateApprovalFile("application/pdf", 26 * 1024 * 1024)).toThrow(
      "under 25 MB",
    );
  });

  it("normalizes safe file names and rejects path traversal", () => {
    expect(normalizeApprovalFileName(" July Proof.pdf ")).toBe("July-Proof.pdf");
    expect(() => normalizeApprovalFileName("../secret.pdf")).toThrow(
      "Rename the file",
    );
  });

  it("lists operator-visible shop workspaces for authorized staff without requiring collaborator rows", async () => {
    const { client, selectedTables } = createWorkspaceListFakeClient();

    const result = await listBsmContentApprovalWorkspaces(client as never, {
      shopId: SHOP_ID,
      actorProfileId: ACTOR_ID,
    });

    expect(result).toEqual([
      {
        id: PROJECT_ID,
        shopId: SHOP_ID,
        title: "Production upload retest",
        status: "ready",
        currentRoundId: ROUND_ID,
        documentCount: 2,
      },
      {
        id: "99999999-9999-4999-8999-999999999999",
        shopId: SHOP_ID,
        title: "Active reviewer feedback",
        status: "active",
        currentRoundId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        documentCount: 1,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        shopId: SHOP_ID,
        title: "Completed reviewer feedback",
        status: "completed",
        currentRoundId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        documentCount: 1,
      },
    ]);
    expect(selectedTables).toEqual([
      "bsm_content_review_projects",
      "bsm_content_review_items",
    ]);
  });

  it("creates the review item, version, reviewer, event, and signed upload token", async () => {
    const { client, inserts, updates } = createFakeClient();
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-1" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await createBsmContentApprovalUpload(
      {
        shopId: SHOP_ID,
        customerProfileId: PROFILE_ID,
        actorProfileId: ACTOR_ID,
        title: "July homepage proof",
        contextNote: "Please confirm the offer and phone number.",
        fileName: "proof.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
      },
      { client: client as never, storage },
    );

    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_reviewers",
      "bsm_content_review_events",
    ]);
    expect(updates).toHaveLength(1);
    expect(storage.from).toHaveBeenCalledWith(BSM_CONTENT_APPROVALS_BUCKET);
    expect(result.upload.token).toBe("token-1");
    expect(result.item.title).toBe("July homepage proof");
    expect(result.item.currentVersion?.storagePath).toBe(result.upload.path);

    const item = inserts[0].payload;
    const version = inserts[1].payload;
    expect(item.shop_id).toBe(SHOP_ID);
    expect(item.customer_profile_id).toBe(PROFILE_ID);
    expect(item.content_type).toBe("pdf");
    expect(version.storage_path).toBe(
      approvalStoragePath({
        shopId: SHOP_ID,
        itemId: item.id as string,
        versionId: version.id as string,
        fileName: "proof.pdf",
      }),
    );
  });

  it("starts an HTML upload without requiring a customer reviewer", async () => {
    const { client, inserts } = createFakeClient();
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-html" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await createBsmContentApprovalUpload(
      {
        shopId: SHOP_ID,
        actorProfileId: ACTOR_ID,
        title: "HTML upload proof",
        contextNote: "Confirm the uploaded HTML document.",
        fileName: "landing-page.html",
        contentType: "text/html",
        byteSize: 2048,
      },
      { client: client as never, storage },
    );

    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_events",
    ]);
    expect(inserts[0].payload.required).toBe(false);
    expect(inserts.find((entry) => entry.table === "bsm_content_review_reviewers")).toBeUndefined();
    expect(result.upload.token).toBe("token-html");
    expect(result.item.customerProfileId).toBeNull();
    expect(result.item.contentType).toBe("document");
    expect(result.item.currentVersion?.contentType).toBe("text/html");
    expect(createSignedUploadUrl).toHaveBeenCalledOnce();
  });

  it("attaches an uploaded document to the selected Review Workspace current round without sending customer email", async () => {
    const { client, inserts } = createWorkspaceFakeClient();
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-1" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await createBsmContentApprovalUpload(
      {
        shopId: SHOP_ID,
        customerProfileId: PROFILE_ID,
        reviewWorkspaceProjectId: PROJECT_ID,
        actorProfileId: ACTOR_ID,
        title: "July homepage proof",
        contextNote: "Please confirm the offer and phone number.",
        fileName: "proof.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
      },
      { client: client as never, storage },
    );

    expect(result.item.reviewWorkspace).toMatchObject({
      projectId: PROJECT_ID,
      roundId: ROUND_ID,
      projectTitle: "July customer review",
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_items")?.payload).toMatchObject({
      project_id: PROJECT_ID,
      status: "in_review",
      processing_status: "ready",
      position: 3,
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_round_documents")?.payload).toMatchObject({
      project_id: PROJECT_ID,
      round_id: ROUND_ID,
      review_item_id: result.item.id,
      version_id: result.item.currentVersion?.id,
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_reviewers")?.payload).toEqual([
      expect.objectContaining({
        review_item_id: result.item.id,
        shop_id: SHOP_ID,
        profile_id: PROFILE_ID,
        invitation_id: "88888888-8888-4888-8888-888888888888",
        round_id: ROUND_ID,
        reviewer_email: "owner@example.com",
        reviewer_name: "Shop Owner",
        submission_status: "not_started",
      }),
    ]);
    expect(inserts.map((entry) => entry.table)).not.toContain("bsm_content_review_invitations");
    const version = inserts.find((entry) => entry.table === "bsm_content_review_versions")?.payload;
    const expectedPath = approvalStoragePath({
      shopId: SHOP_ID,
      itemId: result.item.id,
      versionId: result.item.currentVersion?.id ?? "",
      fileName: "proof.pdf",
    });
    const expectedOriginalPath = `${SHOP_ID}/${PROJECT_ID}/${result.item.id}/${result.item.currentVersion?.id}/original/proof.pdf`;
    expect(version).toMatchObject({
      storage_path: expectedPath,
      original_storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
      original_storage_path: expectedOriginalPath,
      processed_storage_path: null,
      processed_storage_bucket: null,
    });
    expect(result.upload.path).toBe(expectedPath);
    expect(result.item.currentVersion?.storagePath).toBe(expectedPath);
    expect(createSignedUploadUrl).toHaveBeenCalledOnce();
  });

  it("blocks uploaded workspace documents once the review has started", async () => {
    const { client, inserts } = createWorkspaceFakeClient({ projectStatus: "active", roundStatus: "active" });
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-queued" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    await expect(
      createBsmContentApprovalUpload(
        {
          shopId: SHOP_ID,
          customerProfileId: PROFILE_ID,
          reviewWorkspaceProjectId: PROJECT_ID,
          actorProfileId: ACTOR_ID,
          title: "Late homepage proof",
          contextNote: "This should wait for the next round.",
          fileName: "late-proof.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
        { client: client as never, storage },
      ),
    ).rejects.toThrow("This Review Workspace has already been started or closed");

    expect(inserts).toEqual([]);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("blocks attaching existing library items to closed Review Workspaces", async () => {
    const { client, inserts, updates } = createWorkspaceFakeClient({
      existingItemProjectId: null,
      projectStatus: "completed",
    });

    await expect(
      attachBsmContentApprovalToWorkspace(
        {
          itemId: ITEM_ID,
          reviewWorkspaceProjectId: PROJECT_ID,
          actorProfileId: ACTOR_ID,
        },
        { client: client as never },
      ),
    ).rejects.toThrow("This Review Workspace has already been started or closed");

    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("allows a super admin to upload into a Review Workspace without being a collaborator", async () => {
    const { client, inserts } = createWorkspaceFakeClient({ collaborator: null });
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-1" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await createBsmContentApprovalUpload(
      {
        shopId: SHOP_ID,
        customerProfileId: PROFILE_ID,
        reviewWorkspaceProjectId: PROJECT_ID,
        actorProfileId: ACTOR_ID,
        actorRole: "psg_superadmin",
        title: "July homepage proof",
        contextNote: "Please confirm the offer and phone number.",
        fileName: "proof.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
      },
      { client: client as never, storage },
    );

    expect(result.item.reviewWorkspace?.projectId).toBe(PROJECT_ID);
    expect(inserts.find((entry) => entry.table === "bsm_content_review_round_documents")?.payload).toMatchObject({
      project_id: PROJECT_ID,
      round_id: ROUND_ID,
      review_item_id: result.item.id,
    });
    expect(createSignedUploadUrl).toHaveBeenCalledOnce();
  });

  it("starts a Review Workspace upload with no customer reviewer when reviewer columns are stale in the schema cache", async () => {
    const { client, inserts } = createWorkspaceFakeClient({
      collaborator: null,
      missingSchemaCacheColumnsByTable: {
        bsm_content_review_reviewers: ["removed_at", "invitation_id", "round_id", "reviewer_email", "reviewer_name", "submission_status"],
      },
    });
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-1" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await createBsmContentApprovalUpload(
      {
        shopId: SHOP_ID,
        reviewWorkspaceProjectId: PROJECT_ID,
        actorProfileId: ACTOR_ID,
        actorRole: "psg_superadmin",
        title: "Production upload retest",
        contextNote: "Confirm this uploaded document.",
        fileName: "landing-page.html",
        contentType: "text/html",
        byteSize: 2048,
      },
      { client: client as never, storage },
    );

    expect(result.item.customerProfileId).toBeNull();
    expect(result.item.reviewWorkspace?.projectId).toBe(PROJECT_ID);
    expect(createSignedUploadUrl).toHaveBeenCalledOnce();

    const reviewerAttempts = inserts.filter((entry) => entry.table === "bsm_content_review_reviewers");
    expect(reviewerAttempts.length).toBeGreaterThan(1);
    const finalReviewerPayload = reviewerAttempts.at(-1)?.payload as Array<Record<string, unknown>>;
    expect(finalReviewerPayload).toEqual([
      expect.objectContaining({
        review_item_id: result.item.id,
        shop_id: SHOP_ID,
        profile_id: PROFILE_ID,
        reviewer_role: "reviewer",
        notification_preference: "email",
      }),
    ]);
    expect(finalReviewerPayload[0]).not.toHaveProperty("invitation_id");
  });

  it("still requires non-superadmin staff to be Review Workspace collaborators", async () => {
    const { client } = createWorkspaceFakeClient({ collaborator: null });
    const createSignedUploadUrl = vi.fn();
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    await expect(
      createBsmContentApprovalUpload(
        {
          shopId: SHOP_ID,
          customerProfileId: PROFILE_ID,
          reviewWorkspaceProjectId: PROJECT_ID,
          actorProfileId: ACTOR_ID,
          actorRole: "psg_internal",
          title: "July homepage proof",
          contextNote: "Please confirm the offer and phone number.",
          fileName: "proof.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
        { client: client as never, storage },
      ),
    ).rejects.toThrow("You do not have access to the selected Review Workspace");

    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("removes the draft review item if browser upload setup fails", async () => {
    const { client, inserts, deletes } = createWorkspaceFakeClient();
    const createSignedUploadUrl = vi.fn(async () => ({
      data: null,
      error: { message: "storage check rejected path" },
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    await expect(
      createBsmContentApprovalUpload(
        {
          shopId: SHOP_ID,
          customerProfileId: PROFILE_ID,
          reviewWorkspaceProjectId: PROJECT_ID,
          actorProfileId: ACTOR_ID,
          title: "July homepage proof",
          contextNote: "Please confirm the offer and phone number.",
          fileName: "proof.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
        { client: client as never, storage },
      ),
    ).rejects.toThrow("Could not start upload");

    const item = inserts.find((entry) => entry.table === "bsm_content_review_items")?.payload as
      | Record<string, unknown>
      | undefined;
    expect(item?.current_version_id).toBeUndefined();
    expect(deletes).toContainEqual({
      table: "bsm_content_review_items",
      filters: { id: item?.id },
    });
  });

  it("removes the draft review item if the version insert fails", async () => {
    const { client, inserts, deletes } = createWorkspaceFakeClient({
      insertErrorsByTable: {
        bsm_content_review_versions: "storage path violates check constraint",
      },
    });
    const createSignedUploadUrl = vi.fn();
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    await expect(
      createBsmContentApprovalUpload(
        {
          shopId: SHOP_ID,
          customerProfileId: PROFILE_ID,
          reviewWorkspaceProjectId: PROJECT_ID,
          actorProfileId: ACTOR_ID,
          title: "July homepage proof",
          contextNote: "Please confirm the offer and phone number.",
          fileName: "proof.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
        { client: client as never, storage },
      ),
    ).rejects.toThrow("Could not create review version");

    const item = inserts.find((entry) => entry.table === "bsm_content_review_items")?.payload as
      | Record<string, unknown>
      | undefined;
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
    expect(deletes).toContainEqual({
      table: "bsm_content_review_items",
      filters: { id: item?.id },
    });
  });

  it("creates generated page review items without a storage upload", async () => {
    const { client, inserts, updates } = createFakeClient();

    const result = await createBsmGeneratedPageApproval(
      {
        shopId: SHOP_ID,
        customerProfileId: PROFILE_ID,
        actorProfileId: ACTOR_ID,
        title: "July landing page",
        contextNote: "Please review the offer and hero section.",
        generatedPagePath: "/generated/wallace/july-landing-page",
        previewUrl: "https://preview.example/wallace/july",
        sourceContentItemId: "44444444-4444-4444-8444-444444444444",
        snapshot: { campaign: "July" },
      },
      { client: client as never },
    );

    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_reviewers",
      "bsm_content_review_events",
    ]);
    expect(updates).toHaveLength(1);
    expect(result.item.sourceKind).toBe("generated_page");
    expect(result.item.currentVersion?.previewType).toBe("generated_page");
    expect(result.item.currentVersion?.sourceMetadata).toMatchObject({
      sourceKind: "generated_page",
      generatedPagePath: "/generated/wallace/july-landing-page",
      previewUrl: "https://preview.example/wallace/july",
      campaign: "July",
    });

    const item = inserts[0].payload;
    const version = inserts[1].payload;
    expect(item.content_type).toBe("generated_page");
    expect(item.required).toBe(false);
    expect(item.source_content_item_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(version.storage_path).toBeNull();
    expect(version.source_metadata_jsonb).toMatchObject({
      generatedPagePath: "/generated/wallace/july-landing-page",
    });
  });

  it("archives review items and records the archive event", async () => {
    const item = {
      id: "55555555-5555-4555-8555-555555555555",
      shop_id: SHOP_ID,
      title: "Old proof",
      status: "draft",
    };
    const { client, inserts, updates } = createArchiveFakeClient(item);

    const result = await archiveBsmContentApproval(
      { itemId: item.id, actorProfileId: ACTOR_ID },
      { client: client as never },
    );

    expect(result).toEqual({
      id: item.id,
      shopId: SHOP_ID,
      title: "Old proof",
      status: "archived",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({ status: "archived" });
    expect(updates[0].payload.archived_at).toEqual(expect.any(String));
    expect(inserts).toEqual([
      {
        table: "bsm_content_review_events",
        payload: expect.objectContaining({
          shop_id: SHOP_ID,
          review_item_id: item.id,
          event_type: "review_item_archived",
          actor_profile_id: ACTOR_ID,
        }),
      },
    ]);
  });

  it("saves an edit as a new usable version in the selected Review Workspace round", async () => {
    const { client, inserts, updates } = createWorkspaceFakeClient();
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-2" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await updateBsmContentApproval(
      {
        itemId: ITEM_ID,
        actorProfileId: ACTOR_ID,
        title: "Updated proof",
        contextNote: "Use this updated offer.",
        fileName: "proof-v2.pdf",
        contentType: "application/pdf",
        byteSize: 4096,
      },
      { client: client as never, storage },
    );

    expect(result.upload?.token).toBe("token-2");
    expect(result.item.currentVersion?.originalFilename).toBe("proof-v2.pdf");
    expect(inserts.find((entry) => entry.table === "bsm_content_review_versions")?.payload).toMatchObject({
      review_item_id: ITEM_ID,
      project_id: PROJECT_ID,
      round_id: ROUND_ID,
      version_number: 2,
      status: "current",
    });
    const version = inserts.find((entry) => entry.table === "bsm_content_review_versions")?.payload;
    const expectedPath = approvalStoragePath({
      shopId: SHOP_ID,
      itemId: ITEM_ID,
      versionId: result.item.currentVersion?.id ?? "",
      fileName: "proof-v2.pdf",
    });
    const expectedOriginalPath = `${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${result.item.currentVersion?.id}/original/proof-v2.pdf`;
    expect(version).toMatchObject({
      storage_path: expectedPath,
      original_storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
      original_storage_path: expectedOriginalPath,
      processed_storage_path: null,
      processed_storage_bucket: null,
    });
    expect(result.upload?.path).toBe(expectedPath);
    expect(updates.find((entry) => entry.table === "bsm_content_review_round_documents")?.payload).toMatchObject({
      version_id: result.item.currentVersion?.id,
    });
    expect(updates.find((entry) => entry.table === "bsm_content_review_items")?.payload).toMatchObject({
      title: "Updated proof",
      admin_context_note: "Use this updated offer.",
      current_version_id: result.item.currentVersion?.id,
      processing_status: "ready",
    });
    expect(inserts.map((entry) => entry.table)).not.toContain("bsm_content_review_invitations");
  });

  it("attaches an existing uploaded library item to the selected Review Workspace round", async () => {
    const { client, inserts, updates } = createWorkspaceFakeClient({
      existingItemProjectId: null,
      existingReviewers: [
        {
          profile_id: PROFILE_ID,
          reviewer_email: null,
          invitation_id: null,
        },
      ],
    });

    const result = await attachBsmContentApprovalToWorkspace(
      {
        itemId: ITEM_ID,
        reviewWorkspaceProjectId: PROJECT_ID,
        actorProfileId: ACTOR_ID,
      },
      { client: client as never },
    );

    expect(result.item.reviewWorkspace).toMatchObject({
      projectId: PROJECT_ID,
      roundId: ROUND_ID,
      projectTitle: "July customer review",
    });
    expect(updates.find((entry) => entry.table === "bsm_content_review_items")?.payload).toMatchObject({
      project_id: PROJECT_ID,
      status: "in_review",
      processing_status: "ready",
      position: 3,
    });
    expect(updates.find((entry) => entry.table === "bsm_content_review_versions")?.payload).toMatchObject({
      project_id: PROJECT_ID,
      round_id: ROUND_ID,
      introduced_by_round_id: ROUND_ID,
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_round_documents")?.payload).toMatchObject({
      project_id: PROJECT_ID,
      round_id: ROUND_ID,
      review_item_id: ITEM_ID,
      version_id: VERSION_ID,
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_reviewers")).toBeUndefined();
    expect(inserts.find((entry) => entry.table === "bsm_content_review_events")?.payload).toMatchObject({
      review_item_id: ITEM_ID,
      version_id: VERSION_ID,
      event_type: "review_workspace_document_attached",
    });
  });
});
