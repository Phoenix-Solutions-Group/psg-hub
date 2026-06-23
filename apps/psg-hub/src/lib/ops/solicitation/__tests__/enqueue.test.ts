import { describe, it, expect } from "vitest";
import { enqueueSolicitation, SolicitationComplianceError } from "../enqueue";
import { verifyUnsubscribeToken } from "../token";
import type {
  ApprovalQueueRow,
  ApprovalQueueStore,
} from "../../approval-queue/gate";
import type { SolicitationPayload } from "../types";

/** Minimal in-memory approval store capturing the inserted row. */
function fakeApprovalStore() {
  const inserted: ApprovalQueueRow[] = [];
  const store: ApprovalQueueStore = {
    async insert(row) {
      const stored = { ...row, id: `appr-${inserted.length + 1}` };
      inserted.push(stored);
      return stored;
    },
    async get() {
      return null;
    },
    async update(id, patch) {
      return { ...(inserted[0] as ApprovalQueueRow), ...patch, id };
    },
    async listByShop() {
      return inserted;
    },
  };
  return { store, inserted };
}

const baseArgs = {
  shopId: "shop-1",
  shopName: "Westside Collision",
  channels: ["email", "sms"] as const,
  recipient: { firstName: "Jordan", email: "jordan@shop.com", phone: "+15558675309" },
  consent: { email: true, sms: true },
  reviewUrl: "https://g.page/r/westside/review",
  senderPostalAddress: "123 Main St, Springfield, IL 62704",
  appBaseUrl: "https://hub.psgweb.me/",
  proposedBy: "review-cron",
};

describe("enqueueSolicitation", () => {
  it("queues a pending review_solicitation with a compliant draft", async () => {
    const { store, inserted } = fakeApprovalStore();
    const row = await enqueueSolicitation(store, { ...baseArgs, channels: ["email", "sms"] });

    expect(inserted).toHaveLength(1);
    expect(row.action_type).toBe("review_solicitation");
    expect(row.status).toBe("pending");
    expect(row.proposed_by).toBe("review-cron");

    const payload = row.payload_jsonb as unknown as SolicitationPayload;
    expect(payload.channels).toEqual(["email", "sms"]);
    expect(payload.draft.email?.subject).toContain("Westside Collision");
    expect(payload.draft.sms?.body).toMatch(/reply stop/i);
  });

  it("mints a verifiable, absolute unsubscribe link into the email", async () => {
    const { store } = fakeApprovalStore();
    const row = await enqueueSolicitation(store, { ...baseArgs, channels: ["email"] });
    const payload = row.payload_jsonb as unknown as SolicitationPayload;
    const html = payload.draft.email?.html ?? "";

    const match = html.match(/api\/unsubscribe\?token=([^"&]+)/);
    expect(match).not.toBeNull();
    const token = decodeURIComponent(match![1]);
    // No double slash from the trailing slash in appBaseUrl.
    expect(html).toContain("https://hub.psgweb.me/api/unsubscribe");
    expect(verifyUnsubscribeToken(token)).toEqual({
      channel: "email",
      contact: "jordan@shop.com",
    });
  });

  it("REFUSES to queue an email draft with no recipient email (no unsubscribe link)", async () => {
    const { store, inserted } = fakeApprovalStore();
    await expect(
      enqueueSolicitation(store, {
        ...baseArgs,
        channels: ["email"],
        recipient: { firstName: "Jordan", email: null },
      })
    ).rejects.toBeInstanceOf(SolicitationComplianceError);
    expect(inserted).toHaveLength(0);
  });

  it("queues an SMS-only solicitation without needing an unsubscribe URL", async () => {
    const { store } = fakeApprovalStore();
    const row = await enqueueSolicitation(store, {
      ...baseArgs,
      channels: ["sms"],
      recipient: { firstName: "Jordan", phone: "+15558675309" },
    });
    const payload = row.payload_jsonb as unknown as SolicitationPayload;
    expect(payload.draft.sms?.body).toMatch(/reply stop/i);
    expect(payload.draft.email).toBeUndefined();
  });
});
