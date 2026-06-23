import { describe, it, expect, vi } from "vitest";
import { createSolicitationPublisher, parseSolicitationPayload } from "../publisher";
import type { SolicitationStore, SendAuditRow } from "../store";
import type { OptOutEvent, SolicitationChannel, SolicitationPayload } from "../types";
import type { ApprovalQueueRow } from "../../approval-queue/gate";

const SALT = "pub-test-salt";

/** In-memory fake store. opt-out events keyed by channel; sends collected. */
function fakeStore(opts?: {
  optedOut?: Partial<Record<SolicitationChannel, boolean>>;
  existing?: Set<string>;
}) {
  const sends: SendAuditRow[] = [];
  const optEvents: OptOutEvent[] = [];
  const store: SolicitationStore = {
    async getOptOutEvents(channel) {
      return opts?.optedOut?.[channel]
        ? [
            {
              channel,
              contact_hash: "x",
              state: "opted_out",
              reason: channel === "sms" ? "sms_stop" : "email_unsubscribe",
              source: "test",
              event_ref: "e1",
            },
          ]
        : [];
    },
    async sendExists(approvalId, channel, hash) {
      return opts?.existing?.has(`${approvalId}:${channel}:${hash}`) ?? false;
    },
    async recordSend(row) {
      sends.push(row);
    },
    async recordOptOutEvent(e) {
      optEvents.push(e);
    },
  };
  return { store, sends };
}

function payload(over?: Partial<SolicitationPayload>): SolicitationPayload {
  return {
    shopId: "shop-1",
    shopName: "Westside Collision",
    channels: ["email", "sms"],
    recipient: {
      firstName: "Jordan",
      email: "jordan@shop.com",
      phone: "+15558675309",
    },
    consent: { sms: true, email: true },
    draft: {
      email: { subject: "How was your visit?", text: "...", html: "<p>...</p>" },
      sms: { body: "Mind leaving a review? Reply STOP to opt out." },
    },
    ...over,
  };
}

function row(p: SolicitationPayload): ApprovalQueueRow {
  return {
    id: "appr-1",
    shop_id: "shop-1",
    action_type: "review_solicitation",
    title: "Review request",
    summary: null,
    payload_jsonb: p as unknown as Record<string, unknown>,
    status: "approved",
    proposed_by: null,
    decided_by_profile_id: null,
    decided_by_name: null,
    decided_at: null,
    decision_notes: null,
    published_at: null,
    publish_error: null,
  };
}

const notSuppressed = vi.fn(async () => ({ suppressed: false }));

describe("createSolicitationPublisher", () => {
  it("sends BOTH channels for a consenting, contactable recipient", async () => {
    const { store, sends } = fakeStore();
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "mid-1" }));
    const sendSms = vi.fn(async () => ({ sid: "SM1", status: "queued" }));
    const publish = createSolicitationPublisher({
      store,
      sendEmail,
      sendSms,
      isSuppressed: notSuppressed,
      hashSalt: SALT,
    });

    const result = (await publish(row(payload()))) as { ref?: string };

    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendSms).toHaveBeenCalledOnce();
    expect(sends.map((s) => [s.channel, s.status])).toEqual([
      ["email", "sent"],
      ["sms", "sent"],
    ]);
    expect(result.ref).toContain("mid-1");
    expect(result.ref).toContain("SM1");
  });

  it("skips SMS without prior express consent (TCPA), still sends email", async () => {
    const { store, sends } = fakeStore();
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "mid" }));
    const sendSms = vi.fn(async () => ({ sid: "SM", status: "queued" }));
    const publish = createSolicitationPublisher({
      store,
      sendEmail,
      sendSms,
      isSuppressed: notSuppressed,
      hashSalt: SALT,
    });

    await publish(row(payload({ consent: { email: true, sms: false } })));

    expect(sendSms).not.toHaveBeenCalled();
    expect(sends.find((s) => s.channel === "sms")).toMatchObject({
      status: "skipped",
      skip_reason: "no_consent",
    });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("honors an opt-out that arrived AFTER the draft was queued", async () => {
    const { store, sends } = fakeStore({ optedOut: { email: true } });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "m" }));
    const sendSms = vi.fn(async () => ({ sid: "SM", status: "queued" }));
    const publish = createSolicitationPublisher({
      store,
      sendEmail,
      sendSms,
      isSuppressed: notSuppressed,
      hashSalt: SALT,
    });

    await publish(row(payload()));

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sends.find((s) => s.channel === "email")).toMatchObject({
      status: "skipped",
      skip_reason: "opted_out",
    });
    expect(sendSms).toHaveBeenCalledOnce(); // sms still goes
  });

  it("respects household suppression — sends nothing", async () => {
    const { store, sends } = fakeStore();
    const sendEmail = vi.fn();
    const sendSms = vi.fn();
    const suppressed = vi.fn(async () => ({ suppressed: true, reason: "opt_out" as const }));
    const publish = createSolicitationPublisher({
      store,
      sendEmail,
      sendSms,
      isSuppressed: suppressed,
      hashSalt: SALT,
    });

    await publish(
      row(payload({ recipient: { email: "j@shop.com", phone: "+15558675309", householdKey: "hh_abc" } }))
    );

    expect(suppressed).toHaveBeenCalledWith({ householdKey: "hh_abc" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(sends.every((s) => s.status === "skipped" && s.skip_reason === "suppressed")).toBe(true);
  });

  it("does NOT query suppression when no household key is carried", async () => {
    const { store } = fakeStore();
    const suppressed = vi.fn();
    const publish = createSolicitationPublisher({
      store,
      sendEmail: vi.fn(async () => ({ statusCode: 202, messageId: "m" })),
      sendSms: vi.fn(async () => ({ sid: "SM", status: "queued" })),
      isSuppressed: suppressed,
      hashSalt: SALT,
    });
    await publish(row(payload()));
    expect(suppressed).not.toHaveBeenCalled();
  });

  it("is idempotent — never re-sends an already-recorded (approval, channel, contact)", async () => {
    // Pre-seed the email send as already done.
    const { contactHash } = await import("../contact");
    const emailHash = contactHash("email", "jordan@shop.com", { salt: SALT });
    const existing = new Set([`appr-1:email:${emailHash}`]);
    const { store, sends } = fakeStore({ existing });
    const sendEmail = vi.fn();
    const sendSms = vi.fn(async () => ({ sid: "SM", status: "queued" }));
    const publish = createSolicitationPublisher({
      store,
      sendEmail,
      sendSms,
      isSuppressed: notSuppressed,
      hashSalt: SALT,
    });

    await publish(row(payload()));

    expect(sendEmail).not.toHaveBeenCalled(); // skipped: already sent
    expect(sends.find((s) => s.channel === "email")).toBeUndefined();
    expect(sendSms).toHaveBeenCalledOnce();
  });

  it("marks publish_failed (throws) only on a TOTAL send failure", async () => {
    const { store, sends } = fakeStore();
    const publish = createSolicitationPublisher({
      store,
      sendEmail: vi.fn(async () => {
        throw new Error("sendgrid down");
      }),
      sendSms: vi.fn(async () => {
        throw new Error("twilio down");
      }),
      isSuppressed: notSuppressed,
      hashSalt: SALT,
    });

    await expect(publish(row(payload()))).rejects.toThrow(/all 2 send/i);
    expect(sends.every((s) => s.status === "failed")).toBe(true);
  });

  it("resolves on a PARTIAL failure (email fails, sms sends)", async () => {
    const { store, sends } = fakeStore();
    const publish = createSolicitationPublisher({
      store,
      sendEmail: vi.fn(async () => {
        throw new Error("sendgrid down");
      }),
      sendSms: vi.fn(async () => ({ sid: "SM", status: "queued" })),
      isSuppressed: notSuppressed,
      hashSalt: SALT,
    });

    const result = (await publish(row(payload()))) as { ref?: string };
    expect(result.ref).toContain("SM");
    expect(sends.find((s) => s.channel === "email")?.status).toBe("failed");
    expect(sends.find((s) => s.channel === "sms")?.status).toBe("sent");
  });
});

describe("parseSolicitationPayload", () => {
  it("accepts a valid payload and filters unknown channels", () => {
    const p = parseSolicitationPayload({
      ...payload(),
      channels: ["email", "carrier-pigeon", "sms"],
    } as unknown as Record<string, unknown>);
    expect(p.channels).toEqual(["email", "sms"]);
  });
  it("throws on missing channels / recipient / draft", () => {
    expect(() => parseSolicitationPayload({})).toThrow(/channels/);
    expect(() => parseSolicitationPayload({ channels: ["email"] })).toThrow(/recipient/);
    expect(() =>
      parseSolicitationPayload({ channels: ["email"], recipient: {} })
    ).toThrow(/draft/);
  });
  it("throws when no channel is valid", () => {
    expect(() =>
      parseSolicitationPayload({ channels: ["fax"] } as unknown as Record<string, unknown>)
    ).toThrow(/no valid channels/);
  });
});
