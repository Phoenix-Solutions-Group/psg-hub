import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  EXPECTED_QBO_COMPANY_NAME,
  QboMcpError,
  getQboCompanyInfo,
  getUnappliedPaymentSummary,
} from "@/lib/qbo/mcp-client";
import { PaperclipApiError, postIssueComment } from "@/lib/paperclip/issues";

export const runtime = "nodejs";

const TARGET_ISSUE_IDENTIFIER = "PSG-478";

function secretMatches(presented: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  return secretMatches(header, process.env.CRON_SECRET);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
}

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const info = await getQboCompanyInfo();
    if (info.CompanyInfo?.CompanyName !== EXPECTED_QBO_COMPANY_NAME) {
      return NextResponse.json(
        {
          error: "qbo_company_mismatch",
          expectedCompany: EXPECTED_QBO_COMPANY_NAME,
          actualCompany: info.CompanyInfo?.CompanyName ?? null,
        },
        { status: 503 },
      );
    }

    const summary = await getUnappliedPaymentSummary();
    const comment = `${todayLabel()} AR unapplied payment watch: ${summary.loosePaymentCount} loose payment(s) totaling ${formatCurrency(
      summary.loosePaymentTotal,
    )}.`;
    await postIssueComment(TARGET_ISSUE_IDENTIFIER, comment);

    return NextResponse.json({
      ok: true,
      issue: TARGET_ISSUE_IDENTIFIER,
      loosePaymentCount: summary.loosePaymentCount,
      loosePaymentTotal: summary.loosePaymentTotal,
      comment,
    });
  } catch (error) {
    if (error instanceof QboMcpError) {
      return NextResponse.json(
        { error: "qbo_mcp_failed", message: error.message },
        { status: 502 },
      );
    }
    if (error instanceof PaperclipApiError) {
      return NextResponse.json(
        { error: "paperclip_comment_failed", code: error.code, message: error.message },
        { status: error.code === "not_configured" ? 503 : 502 },
      );
    }
    const msg = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: "unapplied_payment_watch_failed", message: msg }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
