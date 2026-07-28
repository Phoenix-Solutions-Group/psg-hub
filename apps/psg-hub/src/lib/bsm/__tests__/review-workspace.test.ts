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
  requireGuestReviewSession,
  requireReviewWorkspaceStaffAccess,
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

function createFakeClient(options: { collaborator?: boolean; expiredSession?: boolean; submitted?: boolean; hasPin?: boolean } = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; payload: Record<string, unknown>; options: Record<string, unknown> | undefined }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
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

type FakeClientOptions = { collaborator?: boolean; expiredSession?: boolean; submitted?: boolean; hasPin?: boolean };

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
        data: [{ id: REVIEW_ITEM_ID, title: "Home page", processing_status: "ready", section_id: SECTION_ID }],
        error: null,
      };
    }
    if (this.table === "bsm_content_review_sections") {
      return { data: [{ id: SECTION_ID, title: "Website" }], error: null };
    }
    return { data: [], error: null };
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
      return Promise.resolve({ data: { id: PROJECT_ID, title: "Website review", status: "active" }, error: null });
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
      "bsm_content_review_events",
      "bsm_content_review_sections",
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_rounds",
      "bsm_content_review_round_documents",
      "bsm_content_review_invitations",
      "bsm_content_review_reviewers",
      "bsm_content_review_events",
    ]);
    expect(inserts.find((entry) => entry.table === "bsm_content_review_items")?.payload).toMatchObject({
      project_id: slice.projectId,
      processing_status: "ready",
      position: 1,
    });
    expect(inserts.find((entry) => entry.table === "bsm_content_review_invitations")?.payload).toMatchObject({
      reviewer_email: "owner@example.com",
      status: "sent",
    });
    expect(updates.some((entry) => entry.table === "bsm_content_review_projects" && entry.payload.status === "active")).toBe(true);
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
      },
    ]);
    expect(workspace.comments).toEqual([
      expect.objectContaining({
        body: "Owner one private note",
        draftStatus: "draft",
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
