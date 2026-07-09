import "server-only";
import { sendEmail as defaultSendEmail } from "@/lib/mail/sendgrid";
import type { MailMessage, MailResult } from "@/lib/mail/types";
import { renderBoardBriefingEmail } from "./render";

export interface BoardBriefingPayload {
  body: string;
  briefingUrl: string;
  subject?: string;
  generatedAt?: string;
}

export interface SendBoardBriefingOptions {
  sendEmail?: (message: MailMessage) => Promise<MailResult>;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

export interface SendBoardBriefingResult {
  recipientCount: number;
  messageId?: string;
}

export class BoardBriefingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardBriefingInputError";
  }
}

export class BoardBriefingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardBriefingConfigError";
  }
}

function parseRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new BoardBriefingInputError("briefingUrl must be a valid http(s) URL");
  }
}

export function parseBoardBriefingPayload(value: unknown): BoardBriefingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoardBriefingInputError("payload must be a JSON object");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.body !== "string" || input.body.trim().length === 0) {
    throw new BoardBriefingInputError("body is required");
  }
  if (typeof input.briefingUrl !== "string" || input.briefingUrl.trim().length === 0) {
    throw new BoardBriefingInputError("briefingUrl is required");
  }
  assertUrl(input.briefingUrl.trim());

  if (input.subject !== undefined && typeof input.subject !== "string") {
    throw new BoardBriefingInputError("subject must be a string");
  }
  if (input.generatedAt !== undefined && typeof input.generatedAt !== "string") {
    throw new BoardBriefingInputError("generatedAt must be a string");
  }

  return {
    body: input.body.trim(),
    briefingUrl: input.briefingUrl.trim(),
    subject: input.subject?.trim() || undefined,
    generatedAt: input.generatedAt?.trim() || undefined,
  };
}

export async function sendBoardBriefing(
  payload: BoardBriefingPayload,
  options: SendBoardBriefingOptions = {},
): Promise<SendBoardBriefingResult> {
  const env = options.env ?? process.env;
  const recipients = parseRecipients(env.BOARD_BRIEFING_RECIPIENTS);
  if (recipients.length === 0) {
    throw new BoardBriefingConfigError("BOARD_BRIEFING_RECIPIENTS is not configured");
  }

  const subject =
    payload.subject ??
    `PSG board briefing — ${(options.now ?? new Date()).toISOString().slice(0, 10)}`;
  const rendered = renderBoardBriefingEmail({
    body: payload.body,
    briefingUrl: payload.briefingUrl,
    subject,
    generatedAt: payload.generatedAt,
  });

  const result = await (options.sendEmail ?? defaultSendEmail)({
    to: recipients,
    from: env.BOARD_BRIEFING_FROM || env.SENDGRID_FROM_EMAIL,
    subject,
    html: rendered.html,
    text: rendered.text,
    clickTracking: false,
  });

  return {
    recipientCount: recipients.length,
    messageId: result.messageId,
  };
}
