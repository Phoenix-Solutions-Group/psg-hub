import "server-only";
import { google, type gmail_v1 } from "googleapis";

export interface GmailDraftRecipient {
  email: string;
  name?: string | null;
}

export interface GmailDraftInput {
  automationId: string;
  from: GmailDraftRecipient;
  replyTo?: GmailDraftRecipient | null;
  to: GmailDraftRecipient[];
  subject: string;
  text: string;
}

export interface GmailDraftSummary {
  id: string;
  messageId: string;
  reused: boolean;
}

export interface GmailDraftAdapter {
  ensureDraft(input: GmailDraftInput): Promise<GmailDraftSummary>;
}

export type GmailDraftConfig =
  | { ok: true; refreshToken: string; clientId: string; clientSecret: string; userId: string }
  | { ok: false; reason: "missing_google_oauth" | "missing_gmail_refresh_token" };

const MESSAGE_ID_DOMAIN = "psgweb.me";

function envValue(env: Record<string, string | undefined>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

export function loadGmailDraftConfig(
  env: Record<string, string | undefined> = process.env,
): GmailDraftConfig {
  const refreshToken = envValue(env, [
    "GMAIL_PROPOSAL_DRAFTS_REFRESH_TOKEN",
    "GMAIL_DRAFTS_REFRESH_TOKEN",
  ]);
  if (!refreshToken) return { ok: false, reason: "missing_gmail_refresh_token" };

  const clientId = envValue(env, ["GMAIL_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"]);
  const clientSecret = envValue(env, ["GMAIL_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"]);
  if (!clientId || !clientSecret) return { ok: false, reason: "missing_google_oauth" };

  return {
    ok: true,
    refreshToken,
    clientId,
    clientSecret,
    userId: envValue(env, ["GMAIL_PROPOSAL_DRAFTS_USER_ID", "GMAIL_DRAFTS_USER_ID"]) || "me",
  };
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatAddress(recipient: GmailDraftRecipient): string {
  const email = cleanHeader(recipient.email);
  const name = cleanHeader(recipient.name ?? "");
  if (!name) return email;
  const escapedName = name.replace(/"/g, '\\"');
  return `"${escapedName}" <${email}>`;
}

function automationMessageId(automationId: string): string {
  const local = automationId
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 160);
  return `<${local || "proposal-follow-up"}@${MESSAGE_ID_DOMAIN}>`;
}

function encodeRawMessage(input: GmailDraftInput): { raw: string; messageId: string } {
  const messageId = automationMessageId(input.automationId);
  const headers = [
    ["From", formatAddress(input.from)],
    ["To", input.to.map(formatAddress).join(", ")],
    input.replyTo ? ["Reply-To", formatAddress(input.replyTo)] : null,
    ["Subject", cleanHeader(input.subject)],
    ["Message-ID", messageId],
    ["X-PSG-Automation-Id", cleanHeader(input.automationId)],
    ["MIME-Version", "1.0"],
    ["Content-Type", 'text/plain; charset="UTF-8"'],
    ["Content-Transfer-Encoding", "8bit"],
  ].filter((header): header is [string, string] => header != null);
  const message = `${headers.map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n${
    input.text
  }`;
  return {
    raw: Buffer.from(message, "utf8").toString("base64url"),
    messageId,
  };
}

export function createGmailDraftAdapter(
  config: GmailDraftConfig = loadGmailDraftConfig(),
): GmailDraftAdapter {
  if (!config.ok) {
    return {
      async ensureDraft() {
        throw new Error(config.reason);
      },
    };
  }

  const auth = new google.auth.OAuth2(config.clientId, config.clientSecret);
  auth.setCredentials({ refresh_token: config.refreshToken });
  const gmail = google.gmail({ version: "v1", auth });

  return {
    async ensureDraft(input) {
      const { raw, messageId } = encodeRawMessage(input);
      const existing = await findDraftByMessageId(gmail, config.userId, messageId);
      if (existing) return { id: existing.id, messageId, reused: true };

      const created = await gmail.users.drafts.create({
        userId: config.userId,
        requestBody: { message: { raw } },
      });
      const id = created.data.id;
      if (!id) throw new Error("gmail_draft_missing_id");
      return { id, messageId, reused: false };
    },
  };
}

async function findDraftByMessageId(
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string,
): Promise<{ id: string } | null> {
  const listed = await gmail.users.drafts.list({
    userId,
    q: `rfc822msgid:${messageId}`,
    maxResults: 10,
  });
  const hit = listed.data.drafts?.find((draft) => typeof draft.id === "string" && draft.id);
  return hit?.id ? { id: hit.id } : null;
}
