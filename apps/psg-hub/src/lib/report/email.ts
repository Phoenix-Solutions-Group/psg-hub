// Phase 12 / 12-03 — Report delivery email payload builder.
// PURE: builds the MailMessage the 12-04 cron sends AFTER a verified generate. It
// does NOT call sendEmail. The report is delivered as a LINK to the membership-gated
// download route, never an attachment (MailMessage has no attachment field, and a
// multi-MB base64 PDF wrecks deliverability; the link also re-auths on every open).
//
// SPEC NOTE (12-03-SUMMARY): the locked AC-3 signature was buildReportEmail(shop,
// downloadUrl, deps); `period` is added because AC-3's dynamicTemplateData requires
// a monthLabel, which has no other source. The data contract is honored exactly.

import type { MailMessage } from "../mail/types";

export type ReportEmailShop = {
  id: string;
  name: string;
  ownerEmail: string;
};

export type ReportEmailDeps = {
  /** SendGrid dynamic template id; defaults to REPORT_EMAIL_TEMPLATE_ID. */
  templateId?: string;
};

/** "Month YYYY" label from a 'YYYY-MM' period (deterministic, UTC). */
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Build the report-ready MailMessage. Fails loud if no SendGrid template id is
 * configured (the 12-04 gate sets REPORT_EMAIL_TEMPLATE_ID). Returns a templateId
 * message whose dynamicTemplateData carries the download-route URL.
 */
export function buildReportEmail(
  shop: ReportEmailShop,
  period: string,
  downloadUrl: string,
  deps: ReportEmailDeps = {}
): MailMessage {
  const templateId = deps.templateId ?? process.env.REPORT_EMAIL_TEMPLATE_ID;
  if (!templateId) {
    throw new Error("buildReportEmail: missing REPORT_EMAIL_TEMPLATE_ID");
  }
  return {
    to: shop.ownerEmail,
    templateId,
    dynamicTemplateData: {
      shopName: shop.name,
      monthLabel: monthLabel(period),
      reportUrl: downloadUrl,
    },
  };
}
