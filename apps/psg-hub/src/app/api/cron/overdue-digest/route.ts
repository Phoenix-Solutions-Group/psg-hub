import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mail/sendgrid";
import {
  buildDigestDeliverer,
  createOverdueDigestClient,
  parseRecipients,
  runOverdueDigest,
} from "@/lib/pipedrive/overdue-digest";
import { boundarySnapshot, verifyFromDigest } from "@/lib/pipedrive/overdue-digest-verify";

// PSG-643 — Cross-client weekly "who's behind?" overdue digest trigger.
//
// Vercel Cron fires GET weekly (Monday, see vercel.json) with
// `Authorization: Bearer ${CRON_SECRET}`; POST is the manual/QA trigger on the same
// gate. The auth gate runs BEFORE any Pipedrive read, so an unauthorized call spends
// zero API calls and never touches the token.
//
// Read-only: the digest only issues GET requests to Pipedrive (no writes). Staff
// notification matches the existing pattern — operator-visible `[overdue-digest]`
// log lines (like analytics-health), plus a SendGrid staff email when
// OVERDUE_DIGEST_RECIPIENTS is set. A degraded run (Pipedrive read failure) returns
// 502 so the cron retries/alerts; a healthy run (including "all caught up") is 200.
//
// PSG-666 — QA-readout mode: when the header `x-overdue-qa-secret` matches
// OVERDUE_DIGEST_QA_SECRET (an OPTIONAL, normally-unset secret; the mode is locked
// unless it is deliberately configured), the endpoint runs the SAME read-only
// Pipedrive sweep but, instead of delivering, returns the full report plus a per-task
// boundary classification in the RESPONSE body. This lets QA confirm the filter picked
// exactly the right rows on real data WITHOUT a separate Pipedrive token — the
// summary-only cron response can't carry that detail. Still read-only, still no
// email/log side effects, and gated behind a distinct strong secret that is removed
// after the QA run so the mode is inert in normal operation.
//
// runtime=nodejs is REQUIRED: node:crypto timingSafeEqual + the SendGrid server-only
// mail adapter.
export const runtime = "nodejs";

/** Timing-safe compare of a presented value against an expected secret. */
function secretMatches(presented: string, expected: string | undefined): boolean {
  if (!expected) return false; // unconfigured = locked
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  return secretMatches(
    header,
    process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined,
  );
}

/** PSG-666 QA-readout auth: a distinct header + a distinct, normally-unset secret. */
function qaAuthorized(request: Request): boolean {
  const header = request.headers.get("x-overdue-qa-secret") ?? "";
  return secretMatches(header, process.env.OVERDUE_DIGEST_QA_SECRET);
}

/** Optional `?asOf=YYYY-MM-DD` override for the QA readout (defaults to now). */
function parseAsOf(request: Request): Date {
  const raw = new URL(request.url).searchParams.get("asOf");
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T09:00:00Z`);
  return new Date();
}

function pipedriveConfigured(): boolean {
  return Boolean(process.env.PIPEDRIVE_API_TOKEN || process.env.PIPEDRIVE_API_KEY);
}

/**
 * PSG-666 — read-only QA readout. Runs the same Pipedrive sweep the digest uses, then
 * returns the full report + boundary classification + a bounded per-category sample so
 * QA can verify accuracy on real data. Delivers NOTHING (no email, no operator-log
 * spam). A Pipedrive read failure maps to 502, mirroring the digest's own degraded path.
 */
async function qaReadout(request: Request): Promise<NextResponse> {
  const client = createOverdueDigestClient({
    companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
  });
  const asOf = parseAsOf(request);
  try {
    const [tasks, projects] = await Promise.all([
      client.listAllTasks(),
      client.listAllProjects(),
    ]);
    const v = await verifyFromDigest(tasks, projects, asOf);
    const titleById = new Map(projects.map((p) => [p.id, p.title]));
    const snapshot = boundarySnapshot(v, titleById, 10);
    return NextResponse.json(
      {
        ok: true,
        mode: "qa-readout",
        asOf: v.asOf,
        totalOverdue: v.report.totalOverdue,
        clientsBehind: v.report.clientsBehind,
        allCaughtUp: v.report.allCaughtUp,
        tasksScanned: tasks.length,
        projectsScanned: projects.length,
        taxonomyConsistent: v.taxonomyConsistent,
        categoryCounts: v.categoryCounts,
        operatorLines: v.operatorLines,
        report: v.report,
        boundarySnapshot: snapshot,
      },
      { status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, mode: "qa-readout", error: msg }, { status: 502 });
  }
}

async function handle(request: Request): Promise<NextResponse> {
  const isCron = authorized(request);
  const isQa = !isCron && qaAuthorized(request);
  if (!isCron && !isQa) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!pipedriveConfigured()) {
    return NextResponse.json({ error: "pipedrive_not_configured" }, { status: 503 });
  }

  // PSG-666 QA path: detailed read-only readout, no delivery.
  if (isQa) {
    return qaReadout(request);
  }

  const client = createOverdueDigestClient({
    companyDomain: process.env.PIPEDRIVE_COMPANY_DOMAIN ?? null,
  });

  // Email is optional: with no recipients wired the deliverer degrades to log-only,
  // so the digest is never lost even before staff addresses are configured.
  const recipients = parseRecipients(process.env.OVERDUE_DIGEST_RECIPIENTS);
  const deliver = buildDigestDeliverer({
    sendEmail,
    recipients,
    from: process.env.OVERDUE_DIGEST_FROM ?? process.env.SENDGRID_FROM_EMAIL,
  });

  const result = await runOverdueDigest({ client, deliver });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
