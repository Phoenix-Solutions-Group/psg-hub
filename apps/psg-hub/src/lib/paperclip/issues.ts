import "server-only";

const DEFAULT_PAPERCLIP_COMPANY_ID = "a38dde7c-f8ee-4901-804d-bf1d6887dbf0";

export type PaperclipIssue = {
  id?: string | null;
  identifier?: string | null;
};

type PaperclipErrorCode = "not_configured" | "not_found" | "request_failed";

export class PaperclipApiError extends Error {
  constructor(
    message: string,
    public readonly code: PaperclipErrorCode,
  ) {
    super(message);
    this.name = "PaperclipApiError";
  }
}

export type PaperclipConfig = {
  apiUrl: string | null;
  apiKey: string | null;
  companyId: string;
};

export function getPaperclipConfig(): PaperclipConfig {
  return {
    apiUrl: process.env.PAPERCLIP_API_URL ?? null,
    apiKey: process.env.PAPERCLIP_API_KEY ?? null,
    companyId: process.env.PAPERCLIP_COMPANY_ID ?? DEFAULT_PAPERCLIP_COMPANY_ID,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseIssueList(body: unknown): PaperclipIssue[] {
  if (Array.isArray(body)) return body.filter(isIssueRecord);
  if (!isIssueRecord(body)) return [];

  const candidateKeys = ["issues", "items", "results", "data"];
  for (const key of candidateKeys) {
    const value = (body as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter(isIssueRecord);
  }
  return [];
}

function isIssueRecord(value: unknown): value is PaperclipIssue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueIdentifierValue(issue: PaperclipIssue): string | null {
  if (typeof issue.id === "string" && issue.id.trim()) return issue.id.trim();
  return null;
}

function issueMatch(issue: PaperclipIssue, identifier: string): boolean {
  return (
    typeof issue.identifier === "string" && issue.identifier === identifier
  );
}

async function findPaperclipIssue(identifier: string): Promise<PaperclipIssue | null> {
  const config = getPaperclipConfig();
  if (!config.apiUrl || !config.apiKey) {
    throw new PaperclipApiError(
      "Paperclip API credentials are not configured",
      "not_configured",
    );
  }

  const url = new URL(`/api/companies/${config.companyId}/issues`, normalizeBaseUrl(config.apiUrl));
  url.searchParams.set("q", identifier);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new PaperclipApiError(
      `Paperclip search failed with status ${response.status}`,
      "request_failed",
    );
  }

  const body = await response.json();
  const issues = parseIssueList(body);
  return issues.find((issue) => issueMatch(issue, identifier)) ?? null;
}

export async function postIssueComment(identifier: string, comment: string): Promise<void> {
  const config = getPaperclipConfig();
  if (!config.apiUrl || !config.apiKey) {
    throw new PaperclipApiError(
      "Paperclip API credentials are not configured",
      "not_configured",
    );
  }

  const issue = await findPaperclipIssue(identifier);
  const issueId = issue ? issueIdentifierValue(issue) : null;
  if (!issueId) {
    throw new PaperclipApiError(`Paperclip issue "${identifier}" was not found`, "not_found");
  }

  const url = new URL(`/api/issues/${issueId}`, normalizeBaseUrl(config.apiUrl));
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ comment }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new PaperclipApiError(
      `Paperclip patch failed for ${identifier} with status ${response.status}: ${body}`,
      "request_failed",
    );
  }
}
