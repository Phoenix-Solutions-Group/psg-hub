import { describe, expect, it, vi } from "vitest";
import { contactHash } from "@/lib/ops/solicitation/contact";
import {
  runNurturePublisher,
  type NurtureEnrollmentRow,
  type NurturePublisherStore,
  type NurtureStepEventRow,
} from "../publisher";

const SALT = "nurture-publisher-test-salt";
const AS_OF = new Date("2026-07-12T12:00:00.000Z");

function template() {
  return {
    senderPostalAddress: "123 Main St, Phoenix, AZ 85001",
    publicBaseUrl: "https://hub.psgweb.me",
    steps: {
      "a-005m-email-sms": {
        email: {
          subject: "Approved nurture email",
          text: "Hi {{first_name}}\n{{physical_address}}\n{{unsubscribe_url}}",
          html: "<p>Hi {{first_name}}</p><p>{{physical_address}}</p><a href=\"{{unsubscribe_url}}\">Unsubscribe</a>",
        },
        sms: {
          body: "Hi {{first_name}}, can we help with your request? Reply STOP to opt out.",
        },
      },
    },
  };
}

function enrollment(overrides: Partial<NurtureEnrollmentRow> = {}): NurtureEnrollmentRow {
  const email = "owner@example.com";
  const phone = "+15558675309";
  return {
    id: "enroll-1",
    path: "hot_inbound",
    status: "active",
    email_contact_hash: contactHash("email", email, { salt: SALT }),
    sms_contact_hash: contactHash("sms", phone, { salt: SALT }),
    company_id: "00000000-0000-4000-8000-000000000001",
    enrolled_at: "2026-07-12T11:55:00.000Z",
    contact_jsonb: {
      firstName: "Jordan",
      shopName: "Westside Collision",
      email,
      phone,
    },
    template_jsonb: template(),
    ...overrides,
  };
}

function fakeStore(opts: {
  enrollments?: NurtureEnrollmentRow[];
  existing?: Set<string>;
  smsConsent?: "opted_in" | "opted_out" | null;
  optedOut?: boolean;
} = {}) {
  const events: NurtureStepEventRow[] = [];
  const store: NurturePublisherStore = {
    async claimDueEnrollments() {
      return opts.enrollments ?? [enrollment()];
    },
    async eventExists(enrollmentId, stepId, channel) {
      return opts.existing?.has(`${enrollmentId}:${stepId}:${channel}`) ?? false;
    },
    async recordStepEvent(row) {
      events.push(row);
    },
    async latestConsent(channel) {
      if (channel !== "sms" || opts.smsConsent == null) return null;
      return { state: opts.smsConsent, created_at: AS_OF.toISOString() };
    },
    async isOptedOut() {
      return opts.optedOut ?? false;
    },
  };
  return { store, events };
}

describe("runNurturePublisher", () => {
  it("blocks every outbound email and text until board approval is explicitly enabled", async () => {
    const { store, events } = fakeStore({ smsConsent: "opted_in" });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "email-1" }));
    const sendSms = vi.fn(async () => ({ sid: "SM1", status: "queued" }));

    const result = await runNurturePublisher({
      store,
      sendEmail,
      sendSms,
      asOf: AS_OF,
      hashSalt: SALT,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.status === "skipped" && e.skip_reason === "board_approval_required")).toBe(true);
    expect(result).toMatchObject({ sent: 0, skipped: 2, failed: 0 });
  });

  it("skips SMS when no recorded text-message consent exists", async () => {
    const { store, events } = fakeStore({ smsConsent: null });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "email-1" }));
    const sendSms = vi.fn(async () => ({ sid: "SM1", status: "queued" }));

    const result = await runNurturePublisher({
      store,
      sendEmail,
      sendSms,
      asOf: AS_OF,
      hashSalt: SALT,
      outboundApproved: true,
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendSms).not.toHaveBeenCalled();
    expect(events.find((e) => e.channel === "sms")).toMatchObject({
      status: "skipped",
      skip_reason: "no_consent",
    });
    expect(result).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
  });

  it("honors STOP/unsubscribe state at send time", async () => {
    const { store, events } = fakeStore({ smsConsent: "opted_in", optedOut: true });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "email-1" }));
    const sendSms = vi.fn(async () => ({ sid: "SM1", status: "queued" }));

    const result = await runNurturePublisher({
      store,
      sendEmail,
      sendSms,
      asOf: AS_OF,
      hashSalt: SALT,
      outboundApproved: true,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.status === "skipped" && e.skip_reason === "opted_out")).toBe(true);
    expect(result).toMatchObject({ sent: 0, skipped: 2, failed: 0 });
  });

  it("does not resend a step/channel that already has an audit row", async () => {
    const existing = new Set(["enroll-1:a-005m-email-sms:email", "enroll-1:a-005m-email-sms:sms"]);
    const { store, events } = fakeStore({ smsConsent: "opted_in", existing });
    const sendEmail = vi.fn(async () => ({ statusCode: 202, messageId: "email-1" }));
    const sendSms = vi.fn(async () => ({ sid: "SM1", status: "queued" }));

    const result = await runNurturePublisher({
      store,
      sendEmail,
      sendSms,
      asOf: AS_OF,
      hashSalt: SALT,
      outboundApproved: true,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(result).toMatchObject({ sent: 0, skipped: 0, failed: 0 });
  });
});
