import { describe, it, expect, vi, beforeEach } from "vitest";
import { runMonthlyReports, type MonthlyDeps, type MonthlyShop } from "@/lib/report/monthly";
import type { ReportData } from "@/lib/report/types";
import type { ReportNarrative } from "@/lib/report/schema";
import type { GenerateOutcome } from "@/lib/report/generate";

const PERIOD = "2026-05";
const shopA: MonthlyShop = { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Shop A", ownerEmail: "a@example.com" };
const shopB: MonthlyShop = { id: "bbbbbbbb-0000-0000-0000-000000000002", name: "Shop B", ownerEmail: "b@example.com" };

const narrative: ReportNarrative = {
  headline: "h",
  executiveSummary: "s",
  sourceSummaries: { ga4: "x" },
  recommendations: ["r"],
};
const passOutcome: GenerateOutcome = { verdict: "pass", narrative, source: "model", violations: [] };

/** Build deps with an injected call-order log + per-test overrides. */
function makeDeps(over: Partial<MonthlyDeps> = {}, order: string[] = []): MonthlyDeps {
  return {
    listShops: vi.fn(async () => [shopA]),
    assembleReportData: vi.fn(async () => ({} as ReportData)),
    generateNarrative: vi.fn(async () => passOutcome),
    storeReportNarrative: vi.fn(async () => { order.push("storeNarrative"); }),
    renderReportPdf: vi.fn(async () => { order.push("render"); return new Uint8Array([1]); }),
    storeReportPdf: vi.fn(async () => { order.push("storePdf"); }),
    recordReport: vi.fn(async () => { order.push("record"); }),
    alreadySent: vi.fn(async () => false),
    claimForSend: vi.fn(async () => { order.push("claim"); return true; }),
    markEmailed: vi.fn(async () => { order.push("markEmailed"); }),
    buildReportEmail: vi.fn((shop, period, url) => ({ to: shop.ownerEmail, templateId: "t", dynamicTemplateData: { reportUrl: url } })),
    sendEmail: vi.fn(async () => { order.push("sendEmail"); }),
    downloadUrl: vi.fn((shopId, period) => `https://hub/api/reports/${shopId}/${period}/download`),
    pdfKey: vi.fn((shopId, period) => `${shopId}/${period}.pdf`),
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("runMonthlyReports", () => {
  it("runs the full pipeline for a passing shop, in order, and marks it sent", async () => {
    const order: string[] = [];
    const deps = makeDeps({}, order);
    const res = await runMonthlyReports(PERIOD, deps);

    expect(res.counts).toEqual({ sent: 1, skipped: 0, held: 0, failed: 0 });
    expect(res.results[0]!.status).toBe("sent");
    // narrative persisted BEFORE render; claim taken AFTER record + BEFORE send; emailed_at stamped AFTER send.
    expect(order).toEqual(["storeNarrative", "render", "storePdf", "record", "claim", "sendEmail", "markEmailed"]);
    expect(deps.renderReportPdf).toHaveBeenCalledWith(`${shopA.id}__${PERIOD}`);
    expect(deps.recordReport).toHaveBeenCalledWith(shopA.id, PERIOD, `${shopA.id}/${PERIOD}.pdf`);
    expect(deps.buildReportEmail).toHaveBeenCalledWith(
      shopA,
      PERIOD,
      `https://hub/api/reports/${shopA.id}/${PERIOD}/download`
    );
  });

  it("holds (no store/render/email) when the narrative did not pass the gate", async () => {
    const holdOutcome: GenerateOutcome = { verdict: "hold", narrative: null, source: "hold", violations: [] };
    const deps = makeDeps({ generateNarrative: vi.fn(async () => holdOutcome) });
    const res = await runMonthlyReports(PERIOD, deps);

    expect(res.counts.held).toBe(1);
    expect(deps.storeReportNarrative).not.toHaveBeenCalled();
    expect(deps.renderReportPdf).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("skips a shop already emailed for the period (idempotent)", async () => {
    const deps = makeDeps({ alreadySent: vi.fn(async () => true) });
    const res = await runMonthlyReports(PERIOD, deps);

    expect(res.counts.skipped).toBe(1);
    expect(deps.generateNarrative).not.toHaveBeenCalled();
    expect(deps.renderReportPdf).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("loses the atomic claim (concurrent run) -> skips without emailing or marking", async () => {
    const order: string[] = [];
    // Preflight passed (alreadySent=false) but another overlapping run already claimed:
    // the report is rendered/stored, yet THIS run must NOT send or mark.
    const deps = makeDeps({ claimForSend: vi.fn(async () => { order.push("claim"); return false; }) }, order);
    const res = await runMonthlyReports(PERIOD, deps);

    expect(res.counts).toEqual({ sent: 0, skipped: 1, held: 0, failed: 0 });
    expect(res.results[0]!.status).toBe("skipped");
    expect(deps.recordReport).toHaveBeenCalledTimes(1); // render path ran up to the claim
    expect(deps.sendEmail).not.toHaveBeenCalled();      // but the send is gated
    expect(deps.markEmailed).not.toHaveBeenCalled();
    expect(order).toEqual(["storeNarrative", "render", "storePdf", "record", "claim"]);
  });

  it("force=true overrides alreadySent and re-runs the pipeline", async () => {
    const deps = makeDeps({ alreadySent: vi.fn(async () => true), force: true });
    const res = await runMonthlyReports(PERIOD, deps);

    expect(res.counts.sent).toBe(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("contains a per-shop failure and still processes the remaining shops", async () => {
    const deps = makeDeps({
      listShops: vi.fn(async () => [shopA, shopB]),
      // shopA render fails; shopB must still go through.
      renderReportPdf: vi
        .fn<MonthlyDeps["renderReportPdf"]>()
        .mockRejectedValueOnce(new Error("worker 500"))
        .mockResolvedValueOnce(new Uint8Array([2])),
    });
    const res = await runMonthlyReports(PERIOD, deps);

    expect(res.counts).toEqual({ sent: 1, skipped: 0, held: 0, failed: 1 });
    expect(res.results[0]).toMatchObject({ shop: shopA, status: "failed", error: "worker 500" });
    expect(res.results[1]).toMatchObject({ shop: shopB, status: "sent" });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1); // only shopB
  });
});
