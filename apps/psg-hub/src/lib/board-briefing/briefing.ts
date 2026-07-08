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
