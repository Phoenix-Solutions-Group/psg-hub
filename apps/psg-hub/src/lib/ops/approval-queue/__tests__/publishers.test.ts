import { describe, it, expect, vi } from "vitest";
import { gbpPostPublisher } from "@/lib/ops/approval-queue/publishers";
import type { ApprovalQueueRow } from "@/lib/ops/approval-queue/gate";
import type { GbpPostRequestFn } from "@/lib/google-oauth/gbp-post";

const RESOURCE = "accounts/111/locations/555";

const row = (payload: Record<string, unknown>): ApprovalQueueRow => ({
  id: "apr-1",
  shop_id: "shop-1",
  action_type: "gbp_post",
  title: "Spring promo",
  summary: "Spring promo",
  payload_jsonb: payload,
  status: "approved",
  proposed_by: "agent:gbp",
  decided_by_profile_id: "user-1",
  decided_by_name: null,
  decided_at: "2026-06-23T00:00:00Z",
  decision_notes: null,
  published_at: null,
  publish_error: null,
});

describe("gbpPostPublisher", () => {
  it("creates the local post from payload_jsonb and returns the post name as ref", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { name: `${RESOURCE}/localPosts/abc`, state: "LIVE" },
    });
    const publish = gbpPostPublisher({
      request: request as unknown as GbpPostRequestFn,
      resourcePath: RESOURCE,
    });
    const out = await publish(row({ summary: "We now do free estimates!" }));
    expect(out).toEqual({ ref: `${RESOURCE}/localPosts/abc` });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0].data).toMatchObject({
      summary: "We now do free estimates!",
      topicType: "STANDARD",
    });
  });

  it("treats PROCESSING as a successful submit (not a failure)", async () => {
    const request = vi.fn().mockResolvedValue({ data: { name: "n", state: "PROCESSING" } });
    const publish = gbpPostPublisher({
      request: request as unknown as GbpPostRequestFn,
      resourcePath: RESOURCE,
    });
    await expect(publish(row({ summary: "hi" }))).resolves.toEqual({ ref: "n" });
  });

  it("THROWS when GBP returns REJECTED (→ publish_failed in the gate)", async () => {
    const request = vi.fn().mockResolvedValue({ data: { name: "n", state: "REJECTED" } });
    const publish = gbpPostPublisher({
      request: request as unknown as GbpPostRequestFn,
      resourcePath: RESOURCE,
    });
    await expect(publish(row({ summary: "hi" }))).rejects.toThrow(/rejected/i);
  });

  it("THROWS on an invalid payload without issuing a request (defence in depth)", async () => {
    const request = vi.fn();
    const publish = gbpPostPublisher({
      request: request as unknown as GbpPostRequestFn,
      resourcePath: RESOURCE,
    });
    // Enqueued via the generic /api/approvals surface with a non-GBP payload.
    await expect(publish(row({ not: "a post" }))).rejects.toThrow(/invalid/i);
    expect(request).not.toHaveBeenCalled();
  });
});
