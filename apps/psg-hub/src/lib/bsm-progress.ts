import "server-only";

const DEFAULT_COMPANY_ID = "a38dde7c-f8ee-4901-804d-bf1d6887dbf0";
const DEFAULT_PROJECT_ID = "a9ae4312-c9b0-4481-a2aa-bbea9c3dbd6c";
const DEFAULT_GOAL_ID = "d89fd784-a2a3-407d-888e-8cf9c401768f";
const DEFAULT_PARENT_ISSUE_ID = "c0b7ec0c-8644-4dfa-92ca-59ec56ce6b74";
const ADA_AGENT_ID = "535baaa9-466b-4b9c-b0ba-3b50211c3c6a";

export type BsmProgressConfig = {
  apiUrl: string | null;
  apiKey: string | null;
  companyId: string;
  projectId: string;
  goalId: string;
  parentIssueId: string;
  adaAgentId: string;
};

export type BsmProgressIssue = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string | null;
  updatedAt: string | null;
  assignee: string;
};

export type BsmProgressSnapshot = {
  configured: boolean;
  fetchedAt: string;
  issues: BsmProgressIssue[];
  error: string | null;
};

export type CreateBsmIdeaInput = {
  title: string;
  description: string;
  requesterEmail?: string | null;
};

type PaperclipIssueRecord = Record<string, unknown>;

export function getBsmProgressConfig(): BsmProgressConfig {
  return {
    apiUrl: envValue(process.env.BSM_PROGRESS_PAPERCLIP_API_URL) ?? envValue(process.env.PAPERCLIP_API_URL),
    apiKey:
      envValue(process.env.BSM_PROGRESS_PAPERCLIP_API_KEY) ??
      envValue(process.env.PAPERCLIP_READ_TOKEN) ??
      envValue(process.env.PAPERCLIP_API_KEY) ??
      null,
    companyId: envValue(process.env.BSM_PROGRESS_COMPANY_ID) ?? DEFAULT_COMPANY_ID,
    projectId: envValue(process.env.BSM_PROGRESS_PROJECT_ID) ?? DEFAULT_PROJECT_ID,
    goalId: envValue(process.env.BSM_PROGRESS_GOAL_ID) ?? DEFAULT_GOAL_ID,
    parentIssueId: envValue(process.env.BSM_PROGRESS_PARENT_ISSUE_ID) ?? DEFAULT_PARENT_ISSUE_ID,
    adaAgentId: envValue(process.env.BSM_PROGRESS_ADA_AGENT_ID) ?? ADA_AGENT_ID,
  };
}

export async function getBsmProgressSnapshot(): Promise<BsmProgressSnapshot> {
  const config = getBsmProgressConfig();
  const fetchedAt = new Date().toISOString();

  if (!config.apiUrl || !config.apiKey) {
    return {
      configured: false,
      fetchedAt,
      issues: [],
      error: "Paperclip sync is not configured in this web runtime.",
    };
  }

  try {
    const url = new URL(`/api/companies/${config.companyId}/issues`, normalizeBaseUrl(config.apiUrl));
    url.searchParams.set("projectId", config.projectId);
    url.searchParams.set("status", "todo,in_progress,in_review,blocked,done");
    url.searchParams.set("q", "BSM");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        configured: true,
        fetchedAt,
        issues: [],
        error: `Paperclip returned ${response.status} while loading live progress.`,
      };
    }

    const body = (await response.json()) as unknown;
    const records = extractIssueRecords(body);
    const issues = records
      .filter((record) => record.projectId === config.projectId || record.goalId === config.goalId)
      .map(toProgressIssue)
      .filter((issue): issue is BsmProgressIssue => issue !== null)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

    return { configured: true, fetchedAt, issues, error: null };
  } catch (error) {
    return {
      configured: true,
      fetchedAt,
      issues: [],
      error: error instanceof Error ? error.message : "Paperclip progress could not be loaded.",
    };
  }
}

export async function createBsmIdeaIssue(input: CreateBsmIdeaInput) {
  const config = getBsmProgressConfig();
  if (!config.apiUrl || !config.apiKey) {
    return { ok: false as const, status: 503, error: "Paperclip idea intake is not configured." };
  }

  const response = await fetch(
    new URL(`/api/companies/${config.companyId}/issues`, normalizeBaseUrl(config.apiUrl)),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.PAPERCLIP_RUN_ID
          ? { "X-Paperclip-Run-Id": process.env.PAPERCLIP_RUN_ID }
          : {}),
      },
      body: JSON.stringify({
        title: `BSM idea: ${input.title}`,
        description: [
          "Feature idea submitted from the BSM progress dashboard.",
          "",
          input.requesterEmail ? `Requester: ${input.requesterEmail}` : "Requester: signed-in PSG ops user",
          "",
          input.description,
        ].join("\n"),
        status: "todo",
        priority: "medium",
        projectId: config.projectId,
        goalId: config.goalId,
        parentId: config.parentIssueId,
        assigneeAgentId: config.adaAgentId,
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      error: `Paperclip returned ${response.status} while creating the idea task.`,
    };
  }

  const body = (await response.json()) as { identifier?: string; id?: string };
  return { ok: true as const, issueIdentifier: body.identifier ?? body.id ?? "new Paperclip task" };
}

function normalizeBaseUrl(raw: string) {
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function extractIssueRecords(body: unknown): PaperclipIssueRecord[] {
  if (Array.isArray(body)) return body.filter(isObjectRecord);
  if (!isObjectRecord(body)) return [];

  for (const key of ["issues", "items", "data", "results"]) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter(isObjectRecord);
  }

  return [];
}

function toProgressIssue(record: PaperclipIssueRecord): BsmProgressIssue | null {
  const id = stringValue(record.id);
  const title = stringValue(record.title);
  if (!id || !title) return null;

  return {
    id,
    identifier: stringValue(record.identifier) ?? id,
    title,
    status: stringValue(record.status) ?? "unknown",
    priority: stringValue(record.priority),
    updatedAt: stringValue(record.updatedAt) ?? stringValue(record.updated_at),
    assignee: assigneeLabel(record),
  };
}

function assigneeLabel(record: PaperclipIssueRecord) {
  const assigneeName = stringValue(record.assigneeName) ?? stringValue(record.assignee_name);
  if (assigneeName) return assigneeName;
  if (stringValue(record.assigneeUserId)) return "Human reviewer";
  if (stringValue(record.assigneeAgentId)) return "Agent";
  return "Unassigned";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function envValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

function isObjectRecord(value: unknown): value is PaperclipIssueRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
