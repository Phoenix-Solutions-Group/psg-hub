import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBsmApprovalNotificationCopy,
  bsmApprovalReviewUrl,
  normalizeBsmApprovalAdminEmails,
  notifyBsmApprovalAdmins,
} from "../approval-notifications";

type Row = Record<string, unknown>;

function makeClient(options: { roles?: string[]; duplicateKeys?: Set<string> } = {}) {
  const notifications: Row[] = [];
  const updates: Array<{ id: string; patch: Row }> = [];
  let nextId = 1;
  const duplicateKeys = options.duplicateKeys ?? new Set<string>();

  const client = {
    from: (table: string) => {
      if (table === "app_user_roles") {
        return {
          select: () => ({
            in: async () => ({
              data: (options.roles ?? []).map((profileId) => ({ profile_id: profileId })),
              error: null,
            }),
          }),
        };
      }

      if (table !== "bsm_content_approval_notifications") {
        throw new Error(`unexpected table ${table}`);
      }

      return {
        insert: (row: Row) => {
          const key = [
            row.event_key,
            row.channel,
            row.recipient_profile_id ?? "",
            String(row.recipient_email ?? "").toLowerCase(),
          ].join("|");

          return {
            select: () => ({
              single: async () => {
                if (duplicateKeys.has(key)) {
                  return { data: null, error: { code: "23505", message: "duplicate" } };
                }
                duplicateKeys.add(key);
                const stored: Row = { ...row, id: `note-${nextId++}` };
                notifications.push(stored);
                return {
                  data: {
                    id: stored.id,
                    title: stored.title,
                    body: stored.body,
                    action_url: stored.action_url,
                    recipient_email: stored.recipient_email,
                  },
                  error: null,
                };
              },
            }),
          };
        },
        update: (patch: Row) => ({
          eq: async (_column: string, id: string) => {
            updates.push({ id, patch });
            const row = notifications.find((item) => item.id === id);
            if (row) Object.assign(row, patch);
            return { error: null };
          },
        }),
      };
    },
  };

  return { client: client as unknown as SupabaseClient, notifications, updates, duplicateKeys };
}

const input = {
  shopId: "00000000-0000-0000-0000-000000000001",
  shopName: "Tracy's Collision",
  reviewItemId: "00000000-0000-0000-0000-0000000000aa",
  reviewItemTitle: "July homepage draft",
  eventKey: "event-1",
  eventType: "comment_created" as const,
  actorName: "Pat Customer",
  messagePreview: "Can we make the offer clearer?",
  appBaseUrl: "https://hub.psg.test/",
};

describe("BSM approval notification copy", () => {
  it("builds plain-language copy and the admin review link", () => {
    const copy = buildBsmApprovalNotificationCopy(input);

    expect(copy.title).toBe("Customer commented on content");
    expect(copy.body).toContain("Pat Customer commented on");
    expect(copy.body).toContain("July homepage draft");
    expect(copy.body).toContain("Tracy's Collision");
    expect(copy.body).toContain("Can we make the offer clearer?");
    expect(copy.actionUrl).toBe(
      "https://hub.psg.test/ops/bsm-content-approvals?reviewItemId=00000000-0000-0000-0000-0000000000aa",
    );
  });

  it("normalizes configured admin email recipients", () => {
    expect(normalizeBsmApprovalAdminEmails(" Ada@PSG.test, ,ada@psg.test,nora@psg.test ")).toEqual([
      "ada@psg.test",
      "nora@psg.test",
    ]);
  });

  it("creates stable review URLs without double slashes", () => {
    expect(bsmApprovalReviewUrl("https://hub.psg.test///", "review 1")).toBe(
      "https://hub.psg.test/ops/bsm-content-approvals?reviewItemId=review%201",
    );
  });
});

describe("notifyBsmApprovalAdmins", () => {
  beforeEach(() => {
    vi.stubEnv("BSM_APPROVAL_ADMIN_EMAILS", "ops@psg.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates in-app rows for PSG admins and sends one email per event recipient", async () => {
    const { client, notifications } = makeClient({ roles: ["profile-1", "profile-2"] });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "msg-1" }));

    const result = await notifyBsmApprovalAdmins(client, input, { sendEmail });

    expect(result).toEqual({
      inAppCreated: 2,
      inAppSkipped: 0,
      emailSent: 1,
      emailSkipped: 0,
      emailFailed: 0,
    });
    expect(notifications).toHaveLength(3);
    expect(notifications.filter((row) => row.channel === "in_app")).toHaveLength(2);
    expect(notifications.find((row) => row.channel === "email")).toMatchObject({
      recipient_email: "ops@psg.test",
      status: "sent",
      send_message_id: "msg-1",
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    const calls = sendEmail.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const message = calls[0][0];
    expect(message).toMatchObject({
      to: "ops@psg.test",
      subject: "Customer commented on content",
      clickTracking: false,
    });
  });

  it("skips duplicate in-app and email alerts for the same event and recipient", async () => {
    const { client } = makeClient({ roles: ["profile-1"] });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "msg-1" }));

    await notifyBsmApprovalAdmins(client, input, { sendEmail });
    const second = await notifyBsmApprovalAdmins(client, input, { sendEmail });

    expect(second).toEqual({
      inAppCreated: 0,
      inAppSkipped: 1,
      emailSent: 0,
      emailSkipped: 1,
      emailFailed: 0,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
