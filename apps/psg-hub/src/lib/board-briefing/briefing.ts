import "server-only";
import { sendEmail as defaultSendEmail } from "@/lib/mail/sendgrid";
import type { MailMessage, MailResult } from "@/lib/mail/types";
import { renderBoardBriefingEmail } from "./render";

// PSG-846: fetch the live `daily-briefing` document from the Paperclip control
// plane and derive the pieces the email cron needs (recipients, subject, doc
// link). Kept free of Next/SendGrid imports so it is unit-testable without the
// network — the route injects a `fetch` and passes env in.

/** Issue that hosts the recurring board-briefing document (PSG-209). */
export const BRIEFING_ISSUE_ID = "8684fab8-0aeb-4f02-8897-7d097ddf6288";
/** Document key regenerated each morning by the briefing routine. */
export const BRIEFING_DOC_KEY = "daily-briefing";

/** Default recipient until Nick confirms the full board list (deploy-time env). */
export const DEFAULT_RECIPIENT = "nick@phoenixsolutionsgroup.net";

export interface Briefing {
  /** Raw Markdown body of the briefing. */
  body: string;
  /** ISO timestamp the briefing was last regenerated. */
  updatedAt: string;
  /** Issue id the doc lives on (for the live-doc link). */
  issueId: string;
}

/** Thrown when the briefing cannot be fetched or is empty — the caller alarms + 5xx. */
export class BriefingUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BriefingUnavailableError";
    this.status = status;
  }
}

/**
 * Parse the comma-separated `BOARD_BRIEFING_RECIPIENTS` env into a clean,
 * de-duplicated address list. Falls back to the default recipient when unset or
 * empty. Whitespace and empty entries are dropped; order is preserved.
 */
export function parseRecipients(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const addr of list) {
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out.length > 0 ? out : [DEFAULT_RECIPIENT];
}

/** A dated, human subject line: "PSG Board Briefing — Wed, Jul 8, 2026". */
export function subjectFor(updatedAt: string): string {
  const date = new Date(updatedAt);
  const label = Number.isNaN(date.getTime())
    ? updatedAt
    : date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
  return `PSG Board Briefing — ${label}`;
}

/** A friendly date label for the email footer (same formatting as the subject). */
export function dateLabelFor(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime())
    ? updatedAt
    : date.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      });
}

/** Build the live-doc link the board can click to see the freshest version. */
export function briefingDocUrl(apiUrl: string, issueId: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/issues/${issueId}`;
}

function parseConfiguredRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export interface FetchBriefingOptions {
  apiUrl: string;
  token: string;
  issueId?: string;
  docKey?: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the latest briefing document from the Paperclip API. Throws
 * BriefingUnavailableError on any non-200 response or an empty body, so the cron
 * fails honestly (5xx + alarm) and never emails a blank briefing.
 */
export async function fetchBriefing(
  options: FetchBriefingOptions
): Promise<Briefing> {
  const {
    apiUrl,
    token,
    issueId = BRIEFING_ISSUE_ID,
    docKey = BRIEFING_DOC_KEY,
    fetchImpl = fetch,
  } = options;

  const url = `${apiUrl.replace(/\/+$/, "")}/api/issues/${issueId}/documents/${docKey}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new BriefingUnavailableError(
      `Failed to reach the briefing API: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502
    );
  }

  if (!response.ok) {
    throw new BriefingUnavailableError(
      `Briefing API returned ${response.status}`,
      response.status === 404 ? 502 : 502
    );
  }

  let doc: unknown;
  try {
    doc = await response.json();
  } catch {
    throw new BriefingUnavailableError("Briefing API returned invalid JSON", 502);
  }

  const record = (doc ?? {}) as Record<string, unknown>;
  const body = typeof record.body === "string" ? record.body : "";
  if (body.trim().length === 0) {
    throw new BriefingUnavailableError("Briefing document is empty", 502);
  }

  return {
    body,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
    issueId:
      typeof record.issueId === "string" ? record.issueId : issueId,
  };
}

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
  const recipients = parseConfiguredRecipients(env.BOARD_BRIEFING_RECIPIENTS);
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
