import "server-only";

const DEFAULT_QBO_MCP_URL = "http://127.0.0.1:3200/mcp";
const MAX_RESULTS = 1000;

export const EXPECTED_QBO_COMPANY_NAME = "Phoenix Solutions Group";

type McpEnvelope = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: unknown;
};

type QboContent = {
  text?: string;
};

export type QboCompanyInfo = {
  CompanyInfo?: {
    CompanyName?: string;
    Id?: string;
  };
};

export type QboPayment = {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number | string | null;
  UnappliedAmt?: number | string | null;
  CustomerRef?: { value?: string; name?: string } | null;
};

export type QboQueryPaymentsResponse = {
  QueryResponse?: {
    Payment?: QboPayment[];
    maxResults?: number;
    startPosition?: number;
  };
};

export type QboUnappliedSummary = {
  loosePaymentCount: number;
  loosePaymentTotal: number;
};

export class QboMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QboMcpError";
  }
}

function qboEndpoint(): string {
  return process.env.QBO_MCP_ENDPOINT ?? process.env.QBO_MCP_URL ?? DEFAULT_QBO_MCP_URL;
}

function parseMcpEnvelope(text: string): McpEnvelope {
  const dataLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""));

  if (dataLines.length > 0) {
    const candidates = dataLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== "[DONE]");
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as McpEnvelope;
      } catch {
        // Some MCP proxies stream intermediary messages; continue to the next payload.
      }
    }
    throw new QboMcpError("Invalid MCP JSON payload");
  }

  const raw = text.trim();
  if (!raw) {
    throw new QboMcpError("Empty MCP response");
  }

  try {
    return JSON.parse(raw) as McpEnvelope;
  } catch {
    throw new QboMcpError("Invalid MCP JSON payload");
  }
}

function toIntOrDefault(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

async function callQboTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(qboEndpoint(), {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}`,
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new QboMcpError(`MCP call failed (${name}) with HTTP ${response.status}: ${body}`);
  }

  const envelope = parseMcpEnvelope(await response.text());
  if (envelope.error) {
    throw new QboMcpError(`MCP call failed (${name}): ${JSON.stringify(envelope.error)}`);
  }

  const result = envelope.result;
  if (!result || !Array.isArray(result.content) || result.content.length === 0) {
    throw new QboMcpError(`MCP result missing content for ${name}`);
  }
  if (result.isError) {
    const message =
      result.content[0]?.text ?? `MCP call ${name} returned tool error`;
    throw new QboMcpError(message);
  }

  const contentText = result.content[0]?.text;
  if (typeof contentText !== "string" || contentText.length === 0) {
    throw new QboMcpError(`MCP content missing for ${name}`);
  }

  try {
    return JSON.parse(contentText) as T;
  } catch {
    throw new QboMcpError(`MCP content was not JSON for ${name}`);
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function getQboCompanyInfo(): Promise<QboCompanyInfo> {
  return callQboTool<QboCompanyInfo>("qbo_company_info", {});
}

async function fetchUnappliedPaymentBatch(
  startPosition: number,
): Promise<{ payments: QboPayment[]; maxResults: number; nextStartPosition: number }> {
  const sql = `SELECT Id, TxnDate, TotalAmt, UnappliedAmt, CustomerRef FROM Payment ORDERBY TxnDate DESC MAXRESULTS ${MAX_RESULTS} STARTPOSITION ${startPosition}`;
  const raw = await callQboTool<QboQueryPaymentsResponse>("qbo_query", { sql });
  const query = raw.QueryResponse ?? {};
  const payments = Array.isArray(query.Payment) ? query.Payment : [];
  const maxResults = toIntOrDefault(query.maxResults, MAX_RESULTS);
  const serverStartPosition = toIntOrDefault(query.startPosition, startPosition);
  const nextStartPosition = serverStartPosition + payments.length;
  return { payments, maxResults, nextStartPosition };
}

export async function getUnappliedPaymentSummary(): Promise<QboUnappliedSummary> {
  let nextStartPosition = 1;
  let loosePaymentCount = 0;
  let loosePaymentTotal = 0;
  let pageIndex = 0;

  while (pageIndex < 30) {
    pageIndex += 1;
    const page = await fetchUnappliedPaymentBatch(nextStartPosition);
    const loosePayments = page.payments.filter((payment) => {
      const amount = toNumber(payment.UnappliedAmt);
      return amount !== null && amount > 0;
    });

    for (const payment of loosePayments) {
      const amount = toNumber(payment.UnappliedAmt);
      if (amount === null) continue;
      loosePaymentCount += 1;
      loosePaymentTotal += amount;
    }

    if (page.payments.length < MAX_RESULTS || page.maxResults < MAX_RESULTS) {
      break;
    }
    if (page.nextStartPosition <= nextStartPosition) {
      throw new QboMcpError("MCP pagination did not advance");
    }
    nextStartPosition = page.nextStartPosition;
  }

  return { loosePaymentCount, loosePaymentTotal: Number(loosePaymentTotal.toFixed(2)) };
}
