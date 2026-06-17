import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleApiError } from "../client";

const markErrorMock = vi.fn();
vi.mock("../accounts", () => ({
  getLinkedAccount: vi.fn(),
  markAccountError: (...a: unknown[]) => markErrorMock(...a),
}));

import { syncGbpReviewReplies } from "../gbp-reviews-reply-sync";

type Row = {
  id: string;
  draft_text: string | null;
  version: number;
  published_version: number | null;
  publish_attempts: number;
  review_items: { shop_id: string; external_review_id: string | null } | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "resp-1",
    draft_text: "Thank you for the review!",
    version: 1,
    published_version: null,
    publish_attempts: 0,
    review_items: {
      shop_id: "shop-1",
      external_review_id: "accounts/1/locations/2/reviews/r1",
    },
    ...overrides,
  };
}

function makeService(opts: {
  rows?: Row[];
  rowsError?: { message: string };
  accountId?: string | null;
}) {
  const calls = {
    updates: [] as { patch: Record<string, unknown>; guard: string }[],
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "review_responses") {
        return {
          // SELECT: .select().eq('status','approved').neq('publish_status','publishing')
          select: () => ({
            eq: () => ({
              neq: async () =>
                opts.rowsError
                  ? { data: null, error: opts.rowsError }
                  : { data: opts.rows ?? [], error: null },
            }),
          }),
          // UPDATE: .update(patch).eq('id',id)[.eq('version',v)]
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              // single-.eq failure path (awaited here)
              then: (resolve: (v: unknown) => unknown) => {
                calls.updates.push({ patch, guard: "id" });
                return Promise.resolve({ data: null, error: null }).then(resolve);
              },
              // chained-.eq success path (id+version; awaited on the second .eq)
              eq: () => ({
                then: (resolve: (v: unknown) => unknown) => {
                  calls.updates.push({ patch, guard: "id+version" });
                  return Promise.resolve({ data: null, error: null }).then(resolve);
                },
              }),
            }),
          }),
        };
      }
      if (table === "google_oauth_accounts") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.order = () => b;
        b.limit = () => b;
        b.maybeSingle = async () => ({
          data: opts.accountId ? { id: opts.accountId } : null,
          error: null,
        });
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  markErrorMock.mockReset();
});

describe("syncGbpReviewReplies", () => {
  it("publishes an approved + dirty row and records published_version=version (optimistic guard)", async () => {
    const { client, calls } = makeService({ rows: [row({ version: 3 })] });
    const publishReply = vi.fn(async () => ({ reviewReplyState: "APPROVED" }));
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });

    expect(res).toEqual({ published: 1, skipped: 0, failed: 0 });
    expect(publishReply).toHaveBeenCalledWith(
      "shop-1",
      "accounts/1/locations/2/reviews/r1",
      "Thank you for the review!",
      undefined
    );
    const u = calls.updates.at(-1)!;
    expect(u.guard).toBe("id+version");
    expect(u.patch).toMatchObject({
      publish_status: "published",
      published_version: 3,
    });
  });

  it("skips a row that is not dirty (published_version == version) — a re-run nets zero", async () => {
    const { client } = makeService({
      rows: [row({ version: 2, published_version: 2 })],
    });
    const publishReply = vi.fn();
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 0, skipped: 1, failed: 0 });
    expect(publishReply).not.toHaveBeenCalled();
  });

  it("re-publishes an edited-after-publish row (version > published_version)", async () => {
    const { client } = makeService({
      rows: [row({ version: 5, published_version: 4 })],
    });
    const publishReply = vi.fn(async () => ({ reviewReplyState: "APPROVED" }));
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res.published).toBe(1);
    expect(publishReply).toHaveBeenCalledOnce();
  });

  it("reflects a PENDING reviewReplyState as 'publishing' (submitted, NOT reported published)", async () => {
    const { client, calls } = makeService({ rows: [row()] });
    const publishReply = vi.fn(async () => ({ reviewReplyState: "PENDING" }));
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 1, skipped: 0, failed: 0 });
    expect(calls.updates.at(-1)!.patch).toMatchObject({ publish_status: "publishing" });
  });

  it("records a REJECTED reply as publish_failed (moderation_rejected), counted failed", async () => {
    const { client, calls } = makeService({ rows: [row()] });
    const publishReply = vi.fn(async () => ({ reviewReplyState: "REJECTED" }));
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 0, skipped: 0, failed: 1 });
    expect(calls.updates.at(-1)!.patch).toMatchObject({
      publish_status: "publish_failed",
      publish_error: "moderation_rejected",
    });
  });

  it("contains an auth_failed publish: flips the account + publish_failed", async () => {
    const { client, calls } = makeService({
      rows: [row()],
      accountId: "acct-1",
    });
    const publishReply = vi.fn(async () => {
      throw new GoogleApiError("auth_failed", "invalid_grant");
    });
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 0, skipped: 0, failed: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("acct-1", "invalid_grant");
    expect(calls.updates.at(-1)!.patch).toMatchObject({
      publish_status: "publish_failed",
      publish_attempts: 1,
      published_version: 1, // permanent → pinned
    });
  });

  it("an unverified-location WRITE rejection (bad_request) is publish_failed but does NOT flip", async () => {
    const { client } = makeService({ rows: [row()], accountId: "acct-1" });
    const publishReply = vi.fn(async () => {
      throw new GoogleApiError("bad_request", "location not verified");
    });
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 0, skipped: 0, failed: 1 });
    expect(markErrorMock).not.toHaveBeenCalled();
  });

  it("leaves published_version behind on a TRANSIENT failure so it retries next run", async () => {
    const { client, calls } = makeService({ rows: [row()] });
    const publishReply = vi.fn(async () => {
      throw new GoogleApiError("rate_limited", "429");
    });
    await syncGbpReviewReplies(client, { publishReply: publishReply as never });
    const u = calls.updates.at(-1)!;
    expect(u.patch).toMatchObject({ publish_status: "publish_failed" });
    expect(u.patch).not.toHaveProperty("published_version");
  });

  it("skips a Places-only row (no external_review_id) — never posts", async () => {
    const { client } = makeService({
      rows: [row({ review_items: { shop_id: "shop-1", external_review_id: null } })],
    });
    const publishReply = vi.fn();
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 0, skipped: 1, failed: 0 });
    expect(publishReply).not.toHaveBeenCalled();
  });

  it("skips an empty draft (never posts a blank reply)", async () => {
    const { client } = makeService({ rows: [row({ draft_text: "   " })] });
    const publishReply = vi.fn();
    const res = await syncGbpReviewReplies(client, {
      publishReply: publishReply as never,
    });
    expect(res).toEqual({ published: 0, skipped: 1, failed: 0 });
    expect(publishReply).not.toHaveBeenCalled();
  });

  it("rethrows on a review_responses read error", async () => {
    const { client } = makeService({ rowsError: { message: "db down" } });
    await expect(syncGbpReviewReplies(client)).rejects.toThrow(/db down/);
  });
});
