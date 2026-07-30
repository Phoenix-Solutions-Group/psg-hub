import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  addBsmCustomerReviewComment,
  getBsmReviewCurrentFileDownload,
  getBsmReviewCommentAttachmentDownload,
  recordBsmCustomerReviewDecision,
  requestBsmContentRestore,
} from "@/lib/bsm/customer-content-review";

const REVIEW_ITEM_ID = "11111111-1111-4111-8111-111111111111";
const SHOP_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ATTACHMENT_ID = "55555555-5555-4555-8555-555555555555";

const serviceState = {
  inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }>,
  uploads: [] as Array<{ bucket: string; path: string; contentType: string }>,
  downloads: [] as Array<{ bucket: string; path: string }>,
  opsRole: null as "psg_internal" | "psg_superadmin" | null,
  opsFunctions: new Set<string>(),
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createFakeServiceClient(),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  getOpsAccess: () =>
    Promise.resolve({
      role: serviceState.opsRole,
      functions: serviceState.opsFunctions,
    }),
  hasOpsFn: (access: { role: string | null; functions: Set<string> }, fn: string) =>
    access.role === "psg_superadmin" || (access.role === "psg_internal" && access.functions.has(fn)),
}));

function createAccessClient(role: string | null = "owner") {
  return {
    from(table: string) {
      return {
        select() {
          return new Query(table, role, false);
        },
      };
    },
  };
}

function createFakeServiceClient() {
  return {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          serviceState.inserts.push({ table, payload });
          return new Query(table, "owner", true, payload);
        },
        update(payload: Record<string, unknown>) {
          return new Query(table, "owner", true, payload, "update");
        },
        select() {
          return new Query(table, "owner", true);
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, _bytes: Uint8Array, options: { contentType?: string }) {
            serviceState.uploads.push({ bucket, path, contentType: options.contentType ?? "" });
            return Promise.resolve({ data: { path }, error: null });
          },
          download(path: string) {
            serviceState.downloads.push({ bucket, path });
            return Promise.resolve({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), error: null });
          },
        };
      },
    },
  };
}

class Query {
  private filters: Record<string, unknown> = {};

  constructor(
    private table: string,
    private role: string | null,
    private service: boolean,
    private payload: Record<string, unknown> = {},
    private operation: "insert" | "update" | "select" = "select",
  ) {}

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  maybeSingle() {
    if (this.table === "bsm_content_review_items") {
      return Promise.resolve({
        data: {
          id: REVIEW_ITEM_ID,
          shop_id: SHOP_ID,
          title: "July landing page",
          status: "in_review",
          content_type: "generated_page",
          admin_context_note: "Please review.",
          current_version_id: VERSION_ID,
          updated_at: "2026-07-23T00:00:00.000Z",
        },
        error: null,
      });
    }
    if (this.table === "shop_users") {
      if (!this.role) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { role: this.role }, error: null });
    }
    if (this.table === "bsm_content_review_versions") {
      return Promise.resolve({
        data: {
          id: VERSION_ID,
          review_item_id: REVIEW_ITEM_ID,
          original_filename: "review-proof.pdf",
          content_type: "application/pdf",
          byte_size: 3,
          storage_bucket: "bsm-content-approvals",
          storage_path: `${SHOP_ID}/${REVIEW_ITEM_ID}/${VERSION_ID}/review-proof.pdf`,
        },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_comment_attachments") {
      if (this.filters.id !== ATTACHMENT_ID) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({
        data: {
          id: ATTACHMENT_ID,
          shop_id: SHOP_ID,
          original_filename: "reply-photo.png",
          content_type: "image/png",
          byte_size: 3,
          storage_bucket: "bsm-content-approvals",
          storage_path: `${SHOP_ID}/${REVIEW_ITEM_ID}/comments/comment-1/${ATTACHMENT_ID}/reply-photo.png`,
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  select() {
    return this;
  }

  single() {
    if (this.table === "bsm_content_review_comments") {
      return Promise.resolve({
        data: { id: this.payload.id ?? "comment-1", body: this.payload.body, created_at: "2026-07-23T00:00:00.000Z" },
        error: null,
      });
    }
    if (this.table === "bsm_content_review_decisions") {
      return Promise.resolve({
        data: { id: "decision-1", decision: this.payload.decision, message: this.payload.message, created_at: "2026-07-23T00:00:00.000Z" },
        error: null,
      });
    }
    if (this.table === "bsm_content_restore_requests") {
      return Promise.resolve({
        data: { id: "restore-1", requested_version_id: VERSION_ID, reason: this.payload.reason, status: "pending", created_at: "2026-07-23T00:00:00.000Z" },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  then(resolve: (value: { error: null }) => unknown) {
    if (this.operation === "update") {
      serviceState.updates.push({ table: this.table, payload: this.payload, filters: this.filters });
    }
    return Promise.resolve({ error: null }).then(resolve);
  }
}

describe("customer content review actions", () => {
  it("records an event when a customer comment is added", async () => {
    serviceState.inserts = [];
    serviceState.updates = [];
    serviceState.uploads = [];
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    await addBsmCustomerReviewComment(createAccessClient() as never, REVIEW_ITEM_ID, USER_ID, "Looks good.");

    expect(serviceState.inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_comments",
      "bsm_content_review_events",
    ]);
    expect(serviceState.inserts[1].payload).toMatchObject({
      shop_id: SHOP_ID,
      review_item_id: REVIEW_ITEM_ID,
      version_id: VERSION_ID,
      event_type: "comment_created",
      actor_profile_id: USER_ID,
      payload_jsonb: {
        commentId: expect.any(String),
        visibility: "shop_and_psg",
      },
    });
  });

  it("uploads one screened phone photo with a customer comment", async () => {
    serviceState.inserts = [];
    serviceState.updates = [];
    serviceState.uploads = [];
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await addBsmCustomerReviewComment(createAccessClient() as never, REVIEW_ITEM_ID, USER_ID, "Logo attached.", {
      fileName: "logo photo.png",
      contentType: "image/png",
      byteSize: png.byteLength,
      bytes: png,
    });

    expect(serviceState.uploads).toHaveLength(1);
    expect(serviceState.uploads[0]).toMatchObject({
      bucket: "bsm-content-approvals",
      contentType: "image/png",
    });
    expect(serviceState.uploads[0].path).toContain(`${SHOP_ID}/${REVIEW_ITEM_ID}/comments/`);
    expect(serviceState.inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_comments",
      "bsm_content_review_comment_attachments",
      "bsm_content_review_events",
    ]);
    expect(serviceState.inserts[1].payload).toMatchObject({
      shop_id: SHOP_ID,
      review_item_id: REVIEW_ITEM_ID,
      uploader_profile_id: USER_ID,
      storage_bucket: "bsm-content-approvals",
      original_filename: "logo-photo.png",
      content_type: "image/png",
      byte_size: png.byteLength,
      screening_status: "passed_basic_screen",
    });
    expect(serviceState.inserts[2].payload.payload_jsonb).toMatchObject({
      attachmentScreeningStatus: "passed_basic_screen",
    });
  });

  it("rejects unsupported or spoofed reply attachments before upload", async () => {
    serviceState.inserts = [];
    serviceState.updates = [];
    serviceState.uploads = [];
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    await expect(
      addBsmCustomerReviewComment(createAccessClient() as never, REVIEW_ITEM_ID, USER_ID, "Not a photo.", {
        fileName: "notes.txt",
        contentType: "text/plain",
        byteSize: 5,
        bytes: new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(serviceState.uploads).toEqual([]);
    expect(serviceState.inserts).toEqual([]);

    await expect(
      addBsmCustomerReviewComment(createAccessClient() as never, REVIEW_ITEM_ID, USER_ID, "Too large.", {
        fileName: "large.png",
        contentType: "image/png",
        byteSize: 8 * 1024 * 1024 + 1,
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(serviceState.uploads).toEqual([]);
    expect(serviceState.inserts).toEqual([]);
  });

  it("does not upload or record an attachment for a different shop customer", async () => {
    serviceState.inserts = [];
    serviceState.updates = [];
    serviceState.uploads = [];
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);

    await expect(
      addBsmCustomerReviewComment(createAccessClient(null) as never, REVIEW_ITEM_ID, USER_ID, "Wrong shop.", {
        fileName: "photo.jpg",
        contentType: "image/jpeg",
        byteSize: jpg.byteLength,
        bytes: jpg,
      }),
    ).rejects.toMatchObject({ status: 403 });

    expect(serviceState.uploads).toEqual([]);
    expect(serviceState.inserts).toEqual([]);
  });

  it("downloads a reply attachment for a same-shop customer", async () => {
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    const attachment = await getBsmReviewCommentAttachmentDownload(
      createAccessClient() as never,
      ATTACHMENT_ID,
      USER_ID,
    );

    expect(attachment).toMatchObject({
      originalFilename: "reply-photo.png",
      contentType: "image/png",
      byteSize: 3,
    });
    expect(serviceState.downloads).toEqual([
      {
        bucket: "bsm-content-approvals",
        path: `${SHOP_ID}/${REVIEW_ITEM_ID}/comments/comment-1/${ATTACHMENT_ID}/reply-photo.png`,
      },
    ]);
  });

  it("denies reply attachment downloads for a different shop customer", async () => {
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    await expect(
      getBsmReviewCommentAttachmentDownload(createAccessClient(null) as never, ATTACHMENT_ID, USER_ID),
    ).rejects.toMatchObject({ status: 403 });

    expect(serviceState.downloads).toEqual([]);
  });

  it("downloads a reply attachment for PSG staff with approval access", async () => {
    serviceState.downloads = [];
    serviceState.opsRole = "psg_internal";
    serviceState.opsFunctions = new Set(["manage_bsm_content_approvals"]);

    const attachment = await getBsmReviewCommentAttachmentDownload(
      createAccessClient(null) as never,
      ATTACHMENT_ID,
      USER_ID,
    );

    expect(attachment.originalFilename).toBe("reply-photo.png");
    expect(serviceState.downloads).toHaveLength(1);
  });

  it("downloads the current uploaded review file for a same-shop customer", async () => {
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    const file = await getBsmReviewCurrentFileDownload(createAccessClient() as never, REVIEW_ITEM_ID, USER_ID);

    expect(file).toMatchObject({
      originalFilename: "review-proof.pdf",
      contentType: "application/pdf",
      byteSize: 3,
    });
    expect(serviceState.downloads).toEqual([
      {
        bucket: "bsm-content-approvals",
        path: `${SHOP_ID}/${REVIEW_ITEM_ID}/${VERSION_ID}/review-proof.pdf`,
      },
    ]);
  });

  it("denies current review file downloads for a different shop customer", async () => {
    serviceState.downloads = [];
    serviceState.opsRole = null;
    serviceState.opsFunctions = new Set();

    await expect(
      getBsmReviewCurrentFileDownload(createAccessClient(null) as never, REVIEW_ITEM_ID, USER_ID),
    ).rejects.toMatchObject({ status: 403 });

    expect(serviceState.downloads).toEqual([]);
  });

  it("records an event when a customer decision changes approval status", async () => {
    serviceState.inserts = [];
    serviceState.updates = [];
    serviceState.uploads = [];

    await recordBsmCustomerReviewDecision(
      createAccessClient() as never,
      REVIEW_ITEM_ID,
      USER_ID,
      "approve",
      "Approved.",
    );

    expect(serviceState.inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_decisions",
      "bsm_content_review_events",
    ]);
    expect(serviceState.updates[0]).toMatchObject({
      table: "bsm_content_review_items",
      payload: { status: "approved" },
      filters: { id: REVIEW_ITEM_ID, shop_id: SHOP_ID },
    });
    expect(serviceState.inserts[1].payload).toMatchObject({
      shop_id: SHOP_ID,
      review_item_id: REVIEW_ITEM_ID,
      version_id: VERSION_ID,
      event_type: "decision_recorded",
      actor_profile_id: USER_ID,
      payload_jsonb: { decisionId: "decision-1", decision: "approve", actorRole: "customer" },
    });
  });

  it("records an event when a customer requests a version restore", async () => {
    serviceState.inserts = [];
    serviceState.updates = [];
    serviceState.uploads = [];

    await requestBsmContentRestore(
      createAccessClient() as never,
      REVIEW_ITEM_ID,
      USER_ID,
      VERSION_ID,
      "Use the earlier version.",
    );

    expect(serviceState.inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_restore_requests",
      "bsm_content_review_events",
    ]);
    expect(serviceState.inserts[1].payload).toMatchObject({
      shop_id: SHOP_ID,
      review_item_id: REVIEW_ITEM_ID,
      version_id: VERSION_ID,
      event_type: "restore_requested",
      actor_profile_id: USER_ID,
      payload_jsonb: { restoreRequestId: "restore-1", requestedVersionId: VERSION_ID },
    });
  });

  it("keeps attachment reads and paths separated by customer shop in the migration", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260728190000_bsm_content_review_comment_attachments.sql"),
      "utf8",
    );

    expect(migration).toContain("bsm_content_review_comment_attachments_one_per_comment unique (comment_id)");
    expect(migration).toContain("i.shop_id in (select public.user_shop_ids())");
    expect(migration).toContain("|| shop_id::text");
    expect(migration).toContain("No authenticated INSERT/UPDATE/DELETE policies");
  });
});
