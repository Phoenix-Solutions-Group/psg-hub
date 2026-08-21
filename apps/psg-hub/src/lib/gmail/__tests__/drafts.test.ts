import { describe, expect, it, vi } from "vitest";

const googleMocks = vi.hoisted(() => ({
  draftList: vi.fn(),
  draftCreate: vi.fn(),
  messageSend: vi.fn(),
  oauthSetCredentials: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn(function OAuth2() {
        return { setCredentials: googleMocks.oauthSetCredentials };
      }),
    },
    gmail: vi.fn(() => ({
      users: {
        drafts: {
          list: googleMocks.draftList,
          create: googleMocks.draftCreate,
        },
        messages: {
          send: googleMocks.messageSend,
        },
      },
    })),
  },
}));

import { createGmailDraftAdapter, loadGmailDraftConfig } from "../drafts";

describe("Gmail proposal draft adapter", () => {
  it("loads only server-side Gmail draft configuration names", () => {
    expect(
      loadGmailDraftConfig({
        GMAIL_PROPOSAL_DRAFTS_REFRESH_TOKEN: "rt",
        GOOGLE_OAUTH_CLIENT_ID: "cid",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      }),
    ).toEqual({
      ok: true,
      refreshToken: "rt",
      clientId: "cid",
      clientSecret: "secret",
      userId: "me",
    });
  });

  it("creates a Gmail draft and never calls the send endpoint", async () => {
    googleMocks.draftList.mockResolvedValue({ data: { drafts: [] } });
    googleMocks.draftCreate.mockResolvedValue({ data: { id: "draft-123" } });

    const adapter = createGmailDraftAdapter({
      ok: true,
      refreshToken: "rt",
      clientId: "cid",
      clientSecret: "secret",
      userId: "me",
    });

    await expect(
      adapter.ensureDraft({
        automationId: "pipedrive:deal:42:proposal-follow-up:touch-1",
        from: { email: "nick@psgweb.me", name: "Alex Seller" },
        replyTo: { email: "alex@psgweb.me", name: "Alex Seller" },
        to: [{ email: "pat@example.com", name: "Pat Owner" }],
        subject: "Checking this landed clearly",
        text: "Draft body",
      }),
    ).resolves.toEqual({
      id: "draft-123",
      messageId: "<pipedrive.deal.42.proposal-follow-up.touch-1@psgweb.me>",
      reused: false,
    });

    expect(googleMocks.draftList).toHaveBeenCalledWith({
      userId: "me",
      q: "rfc822msgid:<pipedrive.deal.42.proposal-follow-up.touch-1@psgweb.me>",
      maxResults: 10,
    });
    expect(googleMocks.draftCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "me",
        requestBody: {
          message: {
            raw: expect.any(String),
          },
        },
      }),
    );
    const raw = googleMocks.draftCreate.mock.calls[0][0].requestBody.message.raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain('From: "Alex Seller" <nick@psgweb.me>');
    expect(decoded).toContain('To: "Pat Owner" <pat@example.com>');
    expect(decoded).toContain("X-PSG-Automation-Id: pipedrive:deal:42:proposal-follow-up:touch-1");
    expect(googleMocks.messageSend).not.toHaveBeenCalled();
  });
});
