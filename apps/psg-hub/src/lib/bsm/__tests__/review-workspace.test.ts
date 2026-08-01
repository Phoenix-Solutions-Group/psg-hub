import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addGuestReviewPinComment,
  createInternalReviewWorkspaceSlice,
  createReviewWorkspaceDeletionTombstone,
  createReviewWorkspaceProject,
  enqueueReviewWorkspaceProcessingJob,
  getGuestReviewWorkspace,
  getStaffReviewWorkspaceResult,
  listStaffReviewWorkspaces,
  requireGuestReviewSession,
  requireReviewWorkspaceStaffAccess,
  removeReviewWorkspaceProject,
  submitGuestReviewRound,
} from "@/lib/bsm/review-workspace";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const ROUND_ID = "44444444-4444-4444-8444-444444444444";
const INVITATION_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const REVIEW_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const VERSION_ID = "88888888-8888-4888-8888-888888888888";
const SECTION_ID = "99999999-9999-4999-8999-999999999999";
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260728183000_bsm_review_workspace_foundation.sql"),
  "utf8",
);
const PROCESSING_CONTRACT_MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260728174500_bsm_review_workspace_processing_contract.sql"),
  "utf8",
);

function collectProcessingJobColumnsAfterMigrations(...migrations: string[]) {
  const columns = new Set<string>();
  for (const migration of migrations) {
    const createMatch = migration.match(/create table if not exists public\.bsm_content_review_processing_jobs \(([\s\S]*?)\n\);/);
    if (createMatch) {
      for (const line of createMatch[1].split("\n")) {
        const match = line.trim().match(/^([a-z_][a-z0-9_]*)\s/);
        if (match && match[1] !== "constraint") columns.add(match[1]);
      }
    }
    const alterMatches = migration.matchAll(/add column if not exists ([a-z_][a-z0-9_]*)\s/g);
    for (const match of alterMatches) columns.add(match[1]);
  }
  return columns;
}

function createFakeClient(options: FakeClientOptions = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; payload: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const schemaCacheMisses = new Map(
    Object.entries(options.missingSchemaCacheColumns ?? {}).map(([table, columns]) => [table, [...columns]]),
  );
  const client = {
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string) {
            return Promise.resolve({
              data: { signedUrl: `https://storage.example/${bucket}/${path}?token=review` },
              error: null,
            });
          },
        };
      },
    },
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          const missingColumns = schemaCacheMisses.get(table) ?? [];
          const missingColumnIndex = missingColumns.findIndex((column) => column in payload);
          const missingColumn = missingColumnIndex >= 0 ? missingColumns.splice(missingColumnIndex, 1)[0] : null;
          const legacyEventNullItemError =
            options.legacyEventsRequireReviewItem &&
            table === "bsm_content_review_events" &&
            payload.review_item_id == null;
          const error = missingColumn
            ? {
                code: "PGRST204",
                message: `Could not find the '${missingColumn}' column of '${table}' in the schema cache`,
              }
            : legacyEventNullItemError
              ? {
                  code: "23502",
                  message: 'null value in column "review_item_id" of relation "bsm_content_review_events" violates not-null constraint',
                }
            : null;
          return {
            select() {
              return this;
            },
            single: () => Promise.resolve({ data: { id: payload.id ?? "inserted-1", thread_id: payload.thread_id, body: payload.body, draft_status: payload.draft_status }, error }),
            then: (resolve: (value: { error: typeof error }) => unknown) => Promise.resolve({ error }).then(resolve),
          };
        },
        upsert(payload: Record<string, unknown>, upsertOptions?: Record<string, unknown>) {
          upserts.push({ table, payload, options: upsertOptions });
          return {
            select() {
              return this;
            },
            single: () => Promise.resolve({ data: { id: "job-1", project_id: payload.project_id, status: payload.status, idempotency_key: payload.idempotency_key }, error: null }),
          };
        },
        update(payload: Record<string, unknown>) {
          return new MutationQuery(table, payload, updates);
        },
        select() {
          return new Query(table, options);
        },
      };
    },
  };
  return { client, inserts, upserts, updates };
}

type FakeClientOptions = {
  collaborator?: boolean;
  expiredSession?: boolean;
  emptyVersionMetadata?: boolean;
  uploadedFileProof?: boolean;
  submitted?: boolean;
  hasPin?: boolean;
  legacyEventsRequireReviewItem?: boolean;
  missingSchemaCacheColumns?: Record<string, string[]>;
  roundDocumentInScope?: boolean;
};

class Query {
  private filters: Record<string, unknown> = {};

  constructor(private table: string, private options: FakeClientOptions) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters[column] = value;
    return this;
  }

  limit(value: number) {
    this.filters.limit = value;
    return this;
  }

  order() {
    return this;
  }

  is(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
    return Promise.resolve(this.rows()).then(resolve);
  }

  private rows() {
    if (this.table === "bsm_content_review_round_documents") {
      const isInScope = this.options.roundDocumentInScope ?? true;
      if (!isInScope) return { data: [], error: null };
      return { data: [{ review_item_id: REVIEW_ITEM_ID, version_id: VERSION_ID }], error: null };
    }
    if (this.table === "bsm_content_review_comments") {
      if (this.filters.limit === 1) {
        return { data: this.options.hasPin === false ? [] : [{ id: "comment-1" }], error: null };
      }
      return {
        data: [
          {
            id: "comment-1",
            review_item_id: REVIEW_ITEM_ID,
            version_id: VERSION_ID,
            body: "Owner one private note",
            pin_number: 1,
            draft_status: "draft",
          },
        ],
        error: null,
      };
    }
    if (this.table === "bsm_content_review_items") {
      return {
        data: [{
          id: REVIEW_ITEM_ID,
          current_version_id: VERSION_ID,
          title: "Home page",
          processing_status: "ready",
          status: "in_review",
          section_id: SECTION_ID,
          version: {
            id: VERSION_ID,
            preview_url: "/dashboard/content",
            generated_page_path: "/dashboard/content",
            source_metadata_jsonb: {
              proofContent: {
                eyebrow: "Website",
                headline: "Home page",
                body: "Demo-safe page copy is visible in the private review workspace.",
                bullets: ["Confirm the offer", "Confirm the next step"],
                cta: "Schedule my repair review",
                sourceUrl: null,
              },
            },
            snapshot_jsonb: {},
          },
        }],
        error: null,
      };
    }
    if (this.table === "bsm_content_review_versions") {
      if (this.options.uploadedFileProof) {
        return {
          data: [
            {
              id: VERSION_ID,
              original_filename: "homepage-proof.pdf",
              content_type: "application/pdf",
              preview_url: null,
              generated_page_path: null,
              storage_bucket: "bsm-content-approvals",
              storage_path: `${SHOP_ID}/${REVIEW_ITEM_ID}/${VERSION_ID}/homepage-proof.pdf`,
              processed_storage_bucket: null,
              processed_storage_path: null,
              source_metadata_jsonb: {},
              snapshot_jsonb: {},
            },
          ],
          error: null,
        };
      }
      const sourceMetadata = this.options.emptyVersionMetadata
        ? {}
        : {
            previewUrl: "/dashboard/content",
            generatedPagePath: "/dashboard/content",
            proofContent: {
              eyebrow: "Website",
              headline: "Home page",
              body: "Demo-safe page copy is visible in the private review workspace.",
              bullets: ["Confirm the offer", "Confirm the next step"],
              cta: "Schedule my repair review",
              sourceUrl: null,
            },
          };
      return {
        data: [
          {
            id: VERSION_ID,
            original_filename: null,
            content_type: "text/html",
            preview_url: "/dashboard/content",
            generated_page_path: "/dashboard/content",
            storage_bucket: null,
            storage_path: null,
            processed_storage_bucket: null,
            processed_storage_path: null,
            source_metadata_jsonb: sourceMetadata,
            snapshot_jsonb: sourceMetadata,
          },
        ],
        error: null,
      };
    }
    if (this.table === "bsm_content_review_sections") {
      return { data: [{ id: SECTION_ID, title: "Website" }], error: null };
    }
    if (this.table === "bsm_content_review_decisions") {
      return {
        data: this.options.submitted
          ? [
              {
                review_item_id: REVIEW_ITEM_ID,
                version_id: VERSION_ID,
                decision: "changes_requested",
                message: "Update the offer.",
                submitted_at: "2026-07-28T19:00:00.000Z",
              },
            ]
          : [],
        error: null,
      };
    }
    if (this.table === "bsm_content_review_rounds") {
      return { data: [{ id: ROUND_ID, status: "submitted", outcome: "changes_requested", completed_at: "2026-07-28T19:00:00.000Z" }], error: null };
    }
    if (this.table === "bsm_content_review_projects") {
      return {
        data: [{
          id: PROJECT_ID,
          shop_id: SHOP_ID,
          title: "Website review",
          status: "active",
          current_round_id: ROUND_ID,
          updated_at: "2026-07-28T19:00:00.000Z",
          created_at: "2026-07-28T18:00:00.000Z",
          company: { name: "Alpha Auto Body" },
        }],
        error: null,
      };
    }
    if (this.table === "bsm_content_review_project_collaborators") {
      return {
        data: [{
          role: "collaborator",
          project: {
            id: PROJECT_ID,
            shop_id: SHOP_ID,
            title: "Website review",
            status: "active",
            current_round_id: ROUND_ID,
            updated_at: "2026-07-28T19:00:00.000Z",
            created_at: "2026-07-28T18:00:00.000Z",
            company: { name: "Alpha Auto Body" },
          },
        }],
        error: null,
      };
    }
    return { data: [], error: null };
  }

  maybeSingle() {
    if (this.table === "bsm_content_review_round_documents") {
      const isInScope = this.options.roundDocumentInScope ?? true;
      const reviewItemId = String(this.filters.review_item_id ?? "");
      const versionId = String(this.filters.version_id ?? "");
      const requestedInScope = reviewItemId === REVIEW_ITEM_ID && versionId === VERSION_ID;
      return Promise.resolve({
        data: isInScope && requestedInScope ? { review_item_id: REVIEW_ITEM_ID, version_id: VERSION_ID } : null,
        error: null,
      });
    }
    if (this.table === "bsm_content_review_projects") {
      return Promise.resolve({
        data: { id: PROJECT_ID, shop_id: SHOP_ID, status: "draft", deleted_at: null },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_project_collaborators") {
      return Promise.resolve({
        data: this.options.collaborator === false ? null : { role: "collaborator" },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_sessions") {
      const expires = this.options.expiredSession
        ? "2026-01-01T00:00:00.000Z"
        : "2999-01-01T00:00:00.000Z";
      return Promise.resolve({
        data: {
          id: SESSION_ID,
          invitation_id: INVITATION_ID,
          project_id: PROJECT_ID,
          round_id: ROUND_ID,
          shop_id: SHOP_ID,
          expires_at: expires,
          revoked_at: null,
          invitation: {
            id: INVITATION_ID,
            status: this.options.submitted ? "submitted" : "sent",
            submitted_at: this.options.submitted ? "2026-07-28T19:00:00.000Z" : null,
            expires_at: expires,
            revoked_at: null,
            reviewer_email: "owner@example.com",
            project: { id: PROJECT_ID, deleted_at: null },
          },
        },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_invitations") {
      return Promise.resolve({
        data: {
          id: INVITATION_ID,
          project_id: PROJECT_ID,
          round_id: ROUND_ID,
          shop_id: SHOP_ID,
          reviewer_email: "owner@example.com",
          status: this.options.submitted ? "submitted" : "sent",
          submitted_at: this.options.submitted ? "2026-07-28T19:00:00.000Z" : null,
          token_hash: "fixture-token-hash",
          code_hash: "fixture-code-hash",
          code_attempt_count: 0,
          expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  single() {
    if (this.table === "bsm_content_review_projects") {
      return Promise.resolve({ data: { id: PROJECT_ID, shop_id: SHOP_ID, title: "Website review", status: "active", current_round_id: ROUND_ID }, error: null });
    }
    if (this.table === "bsm_content_review_rounds") {
      return Promise.resolve({ data: { id: ROUND_ID, status: "active" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
}

class MutationQuery {
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

describe("BSM review workspace foundation service", () => {
  it("creates a shop-scoped project with the creator as owner and an event row", async () => {
    const { client, inserts } = createFakeClient();

    const project = await createReviewWorkspaceProject(
      { shopId: SHOP_ID, title: "Website review", actorProfileId: ACTOR_ID },
      { client: client as never },
    );

    expect(project).toMatchObject({ shopId: SHOP_ID, status: "draft" });
    expect(project.id).toEqual(expect.any(String));
    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_projects",
      "bsm_content_review_project_collaborators",
      "bsm_content_review_events",
    ]);
    expect(inserts[0].payload).toMatchObject({
      shop_id: SHOP_ID,
      owner_profile_id: ACTOR_ID,
      created_by_profile_id: ACTOR_ID,
    });
    expect(inserts[1].payload).toMatchObject({
      profile_id: ACTOR_ID,
      role: "owner",
    });
    expect(inserts[1].payload.project_id).toBe(project.id);
  });

  it("requires named project collaborator access after the ops gate", async () => {
    const allowed = createFakeClient();
    await expect(
      requireReviewWorkspaceStaffAccess(allowed.client as never, PROJECT_ID, ACTOR_ID),
    ).resolves.toMatchObject({ projectId: PROJECT_ID, shopId: SHOP_ID, role: "collaborator" });

    const denied = createFakeClient({ collaborator: false });
    await expect(
      requireReviewWorkspaceStaffAccess(denied.client as never, PROJECT_ID, ACTOR_ID),
    ).rejects.toThrow("You do not have access");
  });

  it("lets a superadmin list and open review workspaces without collaborator rows", async () => {
    const { client } = createFakeClient({ collaborator: false });

    await expect(
      listStaffReviewWorkspaces(ACTOR_ID, "psg_superadmin", { client: client as never }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: PROJECT_ID,
        shopId: SHOP_ID,
        shopName: "Alpha Auto Body",
        role: "superadmin",
      }),
    ]);
    await expect(
      requireReviewWorkspaceStaffAccess(client as never, PROJECT_ID, ACTOR_ID, "psg_superadmin"),
    ).resolves.toMatchObject({ projectId: PROJECT_ID, shopId: SHOP_ID, role: "superadmin" });
  });

  it("soft-removes a review workspace for superadmins and queues purge cleanup", async () => {
    const { client, updates, upserts, inserts } = createFakeClient({ collaborator: false });

    await expect(
      removeReviewWorkspaceProject(
        {
          projectId: PROJECT_ID,
          actorProfileId: ACTOR_ID,
          actorRole: "psg_superadmin",
          reason: "Duplicate QA workspace.",
        },
        { client: client as never, now: new Date("2026-07-28T20:00:00.000Z") },
      ),
    ).resolves.toMatchObject({ projectId: PROJECT_ID, status: "deleted" });

    expect(updates).toContainEqual(expect.objectContaining({
      table: "bsm_content_review_projects",
      payload: expect.objectContaining({
        status: "deleted",
        deleted_at: "2026-07-28T20:00:00.000Z",
        recover_until: "2026-08-27T20:00:00.000Z",
      }),
      filters: { id: PROJECT_ID },
    }));
    expect(upserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "bsm_content_review_deletion_tombstones",
        payload: expect.objectContaining({
          project_id: PROJECT_ID,
          reason: "Duplicate QA workspace.",
          retention_policy: "30_day_recoverable_delete",
        }),
      }),
      expect.objectContaining({
        table: "bsm_content_review_processing_jobs",
        payload: expect.objectContaining({
          kind: "purge",
          idempotency_key: "purge:22222222-2222-4222-8222-222222222222:2026-07-28T20:00:00.000Z",
        }),
      }),
    ]));
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "bsm_content_review_events",
        payload: expect.objectContaining({ event_type: "review_workspace_project_removed" }),
      }),
    ]));
  });

  it("uses idempotency keys for processing jobs and deletion tombstones", async () => {
    const { client, upserts } = createFakeClient();

    await enqueueReviewWorkspaceProcessingJob(
      {
        projectId: PROJECT_ID,
        shopId: SHOP_ID,
        kind: "upload_scan",
        idempotencyKey: "scan:project:item:version",
        actorProfileId: ACTOR_ID,
        reviewItemId: REVIEW_ITEM_ID,
        versionId: VERSION_ID,
      },
      { client: client as never },
    );
    await createReviewWorkspaceDeletionTombstone(
      {
        projectId: PROJECT_ID,
        shopId: SHOP_ID,
        deletedByProfileId: ACTOR_ID,
        deletedAt: "2026-07-28T18:30:00.000Z",
        purgedAt: "2026-08-27T18:30:00.000Z",
      },
      { client: client as never },
    );

    expect(upserts).toEqual([
      expect.objectContaining({
        table: "bsm_content_review_processing_jobs",
        payload: expect.objectContaining({
          project_id: PROJECT_ID,
          shop_id: SHOP_ID,
          kind: "upload_scan",
          status: "queued",
          idempotency_key: "scan:project:item:version",
          review_item_id: REVIEW_ITEM_ID,
          version_id: VERSION_ID,
          created_by_profile_id: ACTOR_ID,
          input_jsonb: {},
        }),
        options: { onConflict: "idempotency_key", ignoreDuplicates: false },
      }),
      expect.objectContaining({
        table: "bsm_content_review_deletion_tombstones",
        options: { onConflict: "project_id", ignoreDuplicates: false },
      }),
    ]);
  });

  it("creates the internal vertical slice project, ordered document, round, and test-only invite/code", async () => {
    const { client, inserts, updates } = createFakeClient();

    const slice = await createInternalReviewWorkspaceSlice(
      {
        shopId: SHOP_ID,
        title: "Website approval",
        description: "Review the new home page.",
        actorProfileId: ACTOR_ID,
        reviewerEmail: "Owner@Example.com",
        reviewerName: "Owner",
        documents: [{ sectionTitle: "Website", title: "Home page", sourceUrl: "https://example.com", position: 1 }],
      },
      { client: client as never, now: new Date("2026-07-28T19:00:00.000Z") },
    );

    expect(slice).toMatchObject({ invitationId: expect.any(String), inviteToken: expect.any(String), inviteCode: expect.stringMatching(/^\d{6}$/) });
    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_projects",
      "bsm_content_review_project_collaborators",
      "bsm_content_review_sections",
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_events",
      "bsm_content_review_rounds",
      "bsm_content_review_round_documents",
      "bsm_content_review_invitations",
      "bsm_content_review_reviewers",
      "bsm_content_review_events",
    ]);
    expect(inserts.find((entry) => entry.table === "bsm_content_review_items")?.payload).toMatchObject({
      project_id: slice.projectId,
      source_kind: "generated_page",
      processing_status: "ready",
      status: "in_review",
      position: 1,
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_versions")?.payload).toMatchObject({
      generated_page_path: "https://example.com",
      snapshot_jsonb: {
        sourceKind: "internal_review_workspace",
        sourceUrl: "https://example.com",
        generatedPagePath: "https://example.com",
        previewUrl: "https://example.com",
        proofContent: expect.objectContaining({
          eyebrow: "Website",
          headline: "Home page",
          body: "Review the new home page.",
          cta: "Schedule my repair review",
          sourceUrl: "https://example.com",
        }),
      },
      scan_status: "clean",
      conversion_status: "not_needed",
      sanitization_status: "complete",
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_invitations")?.payload).toMatchObject({
      reviewer_email: "owner@example.com",
      status: "sent",
    });
    expect(inserts.filter((entry) => entry.table === "bsm_content_review_events")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          event_type: "review_workspace_project_created",
          review_item_id: slice.documents[0]?.itemId,
          version_id: slice.documents[0]?.versionId,
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          event_type: "review_workspace_round_started",
          review_item_id: slice.documents[0]?.itemId,
          version_id: slice.documents[0]?.versionId,
        }),
      }),
    ]);
    expect(updates.some((entry) => entry.table === "bsm_content_review_projects" && entry.payload.status === "active")).toBe(true);
  });

  it("retries review item creation without source_kind against a stale schema cache", async () => {
    const { client, inserts } = createFakeClient({
      missingSchemaCacheColumns: { bsm_content_review_items: ["source_kind"] },
    });

    await createInternalReviewWorkspaceSlice(
      {
        shopId: SHOP_ID,
        title: "Website approval",
        actorProfileId: ACTOR_ID,
        reviewerEmail: "Owner@Example.com",
        documents: [{ sectionTitle: "Website", title: "Home page", sourceUrl: "https://example.com", position: 1 }],
      },
      { client: client as never, now: new Date("2026-07-28T19:00:00.000Z") },
    );

    const itemInserts = inserts.filter((entry) => entry.table === "bsm_content_review_items");
    expect(itemInserts).toHaveLength(2);
    expect(itemInserts[0].payload).toHaveProperty("source_kind", "generated_page");
    expect(itemInserts[1].payload).not.toHaveProperty("source_kind");
  });

  it("creates an internal slice when the hosted event table still requires document-scoped events", async () => {
    const { client, inserts } = createFakeClient({ legacyEventsRequireReviewItem: true });

    const slice = await createInternalReviewWorkspaceSlice(
      {
        shopId: SHOP_ID,
        title: "Website approval",
        actorProfileId: ACTOR_ID,
        reviewerEmail: "Owner@Example.com",
        documents: [{ sectionTitle: "Website", title: "Home page", sourceUrl: "https://example.com", position: 1 }],
      },
      { client: client as never, now: new Date("2026-07-28T19:00:00.000Z") },
    );

    expect(slice).toMatchObject({ inviteToken: expect.any(String), inviteCode: expect.stringMatching(/^\d{6}$/) });
    expect(inserts.filter((entry) => entry.table === "bsm_content_review_events")).toHaveLength(2);
  });

  it("retries review workspace version and reviewer inserts without optional cached columns", async () => {
    const { client, inserts } = createFakeClient({
      missingSchemaCacheColumns: {
        bsm_content_review_versions: ["status", "processed_content_type"],
        bsm_content_review_reviewers: ["invitation_id", "submission_status"],
      },
    });

    const slice = await createInternalReviewWorkspaceSlice(
      {
        shopId: SHOP_ID,
        title: "Website approval",
        actorProfileId: ACTOR_ID,
        reviewerEmail: "Owner@Example.com",
        documents: [{ sectionTitle: "Website", title: "Home page", sourceUrl: "https://example.com", position: 1 }],
      },
      { client: client as never, now: new Date("2026-07-28T19:00:00.000Z") },
    );

    expect(slice).toMatchObject({ inviteToken: expect.any(String), inviteCode: expect.stringMatching(/^\d{6}$/) });

    const versionInserts = inserts.filter((entry) => entry.table === "bsm_content_review_versions");
    expect(versionInserts).toHaveLength(3);
    expect(versionInserts[0].payload).toHaveProperty("status", "current");
    expect(versionInserts[1].payload).not.toHaveProperty("status");
    expect(versionInserts[1].payload).toHaveProperty("processed_content_type", "text/html");
    expect(versionInserts[2].payload).not.toHaveProperty("status");
    expect(versionInserts[2].payload).not.toHaveProperty("processed_content_type");

    const reviewerInserts = inserts.filter((entry) => entry.table === "bsm_content_review_reviewers");
    expect(reviewerInserts).toHaveLength(3);
    expect(reviewerInserts[0].payload).toHaveProperty("invitation_id", slice.invitationId);
    expect(reviewerInserts[1].payload).not.toHaveProperty("invitation_id");
    expect(reviewerInserts[1].payload).toHaveProperty("submission_status", "not_started");
    expect(reviewerInserts[2].payload).not.toHaveProperty("invitation_id");
    expect(reviewerInserts[2].payload).not.toHaveProperty("submission_status");
  });

  it("requires a live invitation-backed reviewer session for guest access", async () => {
    const allowed = createFakeClient();
    await expect(requireGuestReviewSession(allowed.client as never, "session-hash")).resolves.toMatchObject({
      invitationId: INVITATION_ID,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
    });

    const expired = createFakeClient({ expiredSession: true });
    await expect(requireGuestReviewSession(expired.client as never, "session-hash")).rejects.toThrow(
      "expired or was revoked",
    );
  });

  it("loads only the active reviewer invitation comments in the guest workspace", async () => {
    const { client } = createFakeClient();

    const workspace = await getGuestReviewWorkspace("session-hash", { client: client as never });

    expect(workspace.documents).toEqual([
      {
        itemId: REVIEW_ITEM_ID,
        versionId: VERSION_ID,
        title: "Home page",
        processingStatus: "ready",
        sectionTitle: "Website",
        originalFilename: null,
        contentType: "text/html",
        previewUrl: "/dashboard/content",
        generatedPagePath: "/dashboard/content",
        proofUrl: "/dashboard/content",
        proofContent: {
          eyebrow: "Website",
          headline: "Home page",
          body: "Demo-safe page copy is visible in the private review workspace.",
          bullets: ["Confirm the offer", "Confirm the next step"],
          cta: "Schedule my repair review",
          sourceUrl: null,
        },
      },
    ]);
    expect(workspace.comments).toEqual([
      expect.objectContaining({
        body: "Owner one private note",
        draftStatus: "draft",
      }),
    ]);
    expect(workspace.reviewer.readOnly).toBe(false);
  });

  it("falls back to version proof columns when metadata is empty", async () => {
    const { client } = createFakeClient({ emptyVersionMetadata: true });

    const workspace = await getGuestReviewWorkspace("session-hash", { client: client as never });

    expect(workspace.documents[0]).toMatchObject({
      previewUrl: "/dashboard/content",
      generatedPagePath: "/dashboard/content",
      proofUrl: "/dashboard/content",
    });
  });

  it("returns a signed proof URL for uploaded files in the guest workspace", async () => {
    const { client } = createFakeClient({ uploadedFileProof: true });

    const workspace = await getGuestReviewWorkspace("session-hash", { client: client as never });

    expect(workspace.documents[0]).toMatchObject({
      originalFilename: "homepage-proof.pdf",
      contentType: "application/pdf",
      previewUrl: null,
      generatedPagePath: null,
      proofUrl:
        "https://storage.example/bsm-content-approvals/11111111-1111-4111-8111-111111111111/77777777-7777-4777-8777-777777777777/88888888-8888-4888-8888-888888888888/homepage-proof.pdf?token=review",
      proofContent: null,
    });
  });

  it("loads staff result proof content with submitted comments and decisions", async () => {
    const { client } = createFakeClient({ submitted: true });

    const result = await getStaffReviewWorkspaceResult(PROJECT_ID, ACTOR_ID, { client: client as never });

    expect(result.documents[0]).toMatchObject({
      title: "Home page",
      proofContent: expect.objectContaining({
        headline: "Home page",
        body: "Demo-safe page copy is visible in the private review workspace.",
      }),
    });
    expect(result.submittedComments).toEqual([
      expect.objectContaining({
        body: "Owner one private note",
      }),
    ]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        decision: "changes_requested",
        message: "Update the offer.",
      }),
    ]);
  });

  it("stores reviewer pin comments against the reviewer invitation only", async () => {
    const { client, inserts } = createFakeClient();

    await addGuestReviewPinComment(
      {
        sessionHash: "session-hash",
        reviewItemId: REVIEW_ITEM_ID,
        versionId: VERSION_ID,
        body: "Please update this offer.",
        pinNumber: 1,
        viewport: "desktop",
        xRatio: 0.4,
        yRatio: 0.6,
      },
      { client: client as never },
    );

    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_comment_threads",
      "bsm_content_review_comments",
      "bsm_content_review_events",
    ]);
    expect(inserts[0].payload).toMatchObject({
      owner_invitation_id: INVITATION_ID,
      round_id: ROUND_ID,
      review_item_id: REVIEW_ITEM_ID,
      version_id: VERSION_ID,
    });
    expect(inserts[0].payload.project_id).toBe(PROJECT_ID);
    expect(inserts[1].payload).toMatchObject({
      invitation_id: INVITATION_ID,
      reviewer_session_id: SESSION_ID,
      author_profile_id: null,
      draft_status: "draft",
      x_ratio: 0.4,
      y_ratio: 0.6,
    });
  });

  it("blocks new reviewer comments after submit", async () => {
    const submitted = createFakeClient({ submitted: true });

    await expect(
      addGuestReviewPinComment(
        {
          sessionHash: "session-hash",
          reviewItemId: REVIEW_ITEM_ID,
          versionId: VERSION_ID,
          body: "Please update this offer.",
          pinNumber: 1,
          viewport: "desktop",
          xRatio: 0.4,
          yRatio: 0.6,
        },
        { client: submitted.client as never },
      ),
    ).rejects.toThrow("already submitted");

    const workspace = await getGuestReviewWorkspace("session-hash", { client: submitted.client as never });
    expect(workspace.reviewer.readOnly).toBe(true);
    expect(workspace.decisions).toEqual([
      expect.objectContaining({ decision: "changes_requested", message: "Update the offer." }),
    ]);
  });

  it("locks comments and records immutable decisions on one-time submit", async () => {
    const { client, inserts, updates } = createFakeClient();

    await expect(
      submitGuestReviewRound(
        {
          sessionHash: "session-hash",
          decisions: [{ reviewItemId: REVIEW_ITEM_ID, versionId: VERSION_ID, decision: "changes_requested", message: "Update the offer." }],
        },
        { client: client as never, now: new Date("2026-07-28T19:30:00.000Z") },
      ),
    ).resolves.toMatchObject({ status: "submitted", invitationId: INVITATION_ID });

    expect(inserts.find((entry) => entry.table === "bsm_content_review_decisions")?.payload).toMatchObject({
      invitation_id: INVITATION_ID,
      decision: "changes_requested",
      locked_at: "2026-07-28T19:30:00.000Z",
    });
    expect(updates.find((entry) => entry.table === "bsm_content_review_comments")?.payload).toMatchObject({
      draft_status: "locked",
      locked_at: "2026-07-28T19:30:00.000Z",
    });
  });

  it("rejects pin comments for documents outside the active review round", async () => {
    const { client } = createFakeClient({ roundDocumentInScope: false });

    await expect(
      addGuestReviewPinComment(
        {
          sessionHash: "session-hash",
          reviewItemId: "99999999-9999-4999-8999-999999999998",
          versionId: VERSION_ID,
          body: "Please update this offer.",
          pinNumber: 1,
          viewport: "desktop",
          xRatio: 0.4,
          yRatio: 0.6,
        },
        { client: client as never },
      ),
    ).rejects.toThrow("This review document is not part of the active round");
  });

  it("rejects review round submission for documents outside the active review round", async () => {
    const { client } = createFakeClient({ roundDocumentInScope: false });

    await expect(
      submitGuestReviewRound(
        {
          sessionHash: "session-hash",
          decisions: [{ reviewItemId: "99999999-9999-4999-8999-999999999998", versionId: VERSION_ID, decision: "approved" }],
        },
        { client: client as never },
      ),
    ).rejects.toThrow("This review document is not part of the active round");
  });

  it("rejects review round submission for documents outside scope even when requesting pin comments", async () => {
    const { client } = createFakeClient({ roundDocumentInScope: false, hasPin: true });

    await expect(
      submitGuestReviewRound(
        {
          sessionHash: "session-hash",
          decisions: [{ reviewItemId: "99999999-9999-4999-8999-999999999998", versionId: VERSION_ID, decision: "changes_requested", message: "Please add more details." }],
        },
        { client: client as never },
      ),
    ).rejects.toThrow("This review document is not part of the active round");
  });

  it("rejects duplicate submit and changes-requested decisions without a pin", async () => {
    const submitted = createFakeClient({ submitted: true });
    await expect(
      submitGuestReviewRound(
        { sessionHash: "session-hash", decisions: [{ reviewItemId: REVIEW_ITEM_ID, versionId: VERSION_ID, decision: "approved" }] },
        { client: submitted.client as never },
      ),
    ).rejects.toThrow("already submitted");

    const noPin = createFakeClient({ hasPin: false });
    await expect(
      submitGuestReviewRound(
        { sessionHash: "session-hash", decisions: [{ reviewItemId: REVIEW_ITEM_ID, versionId: VERSION_ID, decision: "changes_requested" }] },
        { client: noPin.client as never },
      ),
    ).rejects.toThrow("requires at least one pin");
  });

  it("keeps route exposure behind an explicit internal feature gate", async () => {
    const { bsmReviewWorkspaceInternalEnabled } = await import("@/lib/bsm/review-workspace");

    expect(bsmReviewWorkspaceInternalEnabled({})).toBe(false);
    expect(bsmReviewWorkspaceInternalEnabled({ BSM_REVIEW_WORKSPACE_INTERNAL_ENABLED: "1" })).toBe(true);
    expect(bsmReviewWorkspaceInternalEnabled({ BSM_REVIEW_WORKSPACE_INTERNAL_ENABLED: "true" })).toBe(true);
  });

  it("keeps the database foundation shop-scoped, reviewer-private, immutable, and default-deny", () => {
    expect(MIGRATION).toContain("alter table public.bsm_content_review_projects enable row level security");
    expect(MIGRATION).toContain("private.bsm_content_review_user_can_access_project");
    expect(MIGRATION).toContain("private.bsm_content_review_user_can_access_invitation");
    expect(MIGRATION).toContain("owner_invitation_id");
    expect(MIGRATION).toContain("alter table if exists public.bsm_content_review_events");
    expect(MIGRATION).toContain("alter column review_item_id drop not null");
    expect(MIGRATION).toContain("bsm_content_review_comments_submitted_no_mutate");
    expect(MIGRATION).toContain("bsm_content_review_decisions_no_mutate");
    expect(MIGRATION).toContain("on public.bsm_content_review_processing_jobs (idempotency_key)");
    expect(MIGRATION).toContain("revoke all on table public.bsm_content_review_processing_jobs from authenticated");
    expect(MIGRATION).not.toContain("grant select on table public.bsm_content_review_processing_jobs to authenticated");
    expect(MIGRATION).toContain("Guest reviewers are intentionally not granted anon database access");
  });

  it("keeps processing-job migrations compatible with the enqueue service write contract", () => {
    const migratedColumns = collectProcessingJobColumnsAfterMigrations(PROCESSING_CONTRACT_MIGRATION, MIGRATION);

    expect([...migratedColumns].sort()).toEqual(
      expect.arrayContaining([
        "project_id",
        "shop_id",
        "kind",
        "status",
        "idempotency_key",
        "review_item_id",
        "version_id",
        "round_id",
        "created_by_profile_id",
        "input_jsonb",
      ]),
    );
  });
});
