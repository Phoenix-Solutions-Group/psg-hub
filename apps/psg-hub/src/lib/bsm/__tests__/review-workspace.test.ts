import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addGuestReviewPinComment,
  createReviewWorkspaceDeletionTombstone,
  createReviewWorkspaceProject,
  enqueueReviewWorkspaceProcessingJob,
  requireGuestReviewSession,
  requireReviewWorkspaceStaffAccess,
} from "@/lib/bsm/review-workspace";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const ROUND_ID = "44444444-4444-4444-8444-444444444444";
const INVITATION_ID = "55555555-5555-4555-8555-555555555555";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const REVIEW_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const VERSION_ID = "88888888-8888-4888-8888-888888888888";
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260728183000_bsm_review_workspace_foundation.sql"),
  "utf8",
);

function createFakeClient(options: { collaborator?: boolean; expiredSession?: boolean } = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; payload: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];
  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return {
            select() {
              return this;
            },
            single: () => Promise.resolve({ data: { id: payload.id ?? "inserted-1", thread_id: payload.thread_id, body: payload.body, draft_status: payload.draft_status }, error: null }),
            then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
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
        select() {
          return new Query(table, options);
        },
      };
    },
  };
  return { client, inserts, upserts };
}

class Query {
  private filters: Record<string, unknown> = {};

  constructor(private table: string, private options: { collaborator?: boolean; expiredSession?: boolean }) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  is(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  maybeSingle() {
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
            status: "sent",
            expires_at: expires,
            revoked_at: null,
            reviewer_email: "owner@example.com",
            project: { id: PROJECT_ID, deleted_at: null },
          },
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
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
        options: { onConflict: "idempotency_key", ignoreDuplicates: false },
      }),
      expect.objectContaining({
        table: "bsm_content_review_deletion_tombstones",
        options: { onConflict: "project_id", ignoreDuplicates: false },
      }),
    ]);
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

  it("keeps the database foundation shop-scoped, reviewer-private, immutable, and default-deny", () => {
    expect(MIGRATION).toContain("alter table public.bsm_content_review_projects enable row level security");
    expect(MIGRATION).toContain("private.bsm_content_review_user_can_access_project");
    expect(MIGRATION).toContain("private.bsm_content_review_user_can_access_invitation");
    expect(MIGRATION).toContain("owner_invitation_id");
    expect(MIGRATION).toContain("bsm_content_review_comments_submitted_no_mutate");
    expect(MIGRATION).toContain("bsm_content_review_decisions_no_mutate");
    expect(MIGRATION).toContain("on public.bsm_content_review_processing_jobs (idempotency_key)");
    expect(MIGRATION).toContain("Guest reviewers are intentionally not granted anon database access");
  });
});
