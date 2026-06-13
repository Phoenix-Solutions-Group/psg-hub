import { describe, it, expect } from "vitest";
import { buildReportEmail } from "@/lib/report/email";

const shop = { id: "shop-1", name: "Tracy's Collision", ownerEmail: "owner@example.com" };
const URL = "https://hub.psgweb.me/api/reports/shop-1/2026-05/download";

describe("buildReportEmail", () => {
  it("builds a templateId link-email with the download URL in dynamicTemplateData", () => {
    const msg = buildReportEmail(shop, "2026-05", URL, { templateId: "d-template-123" });
    expect(msg.templateId).toBe("d-template-123");
    expect(msg.to).toBe("owner@example.com");
    expect(msg.dynamicTemplateData).toEqual({
      shopName: "Tracy's Collision",
      monthLabel: "May 2026",
      reportUrl: URL,
    });
    // It is a LINK email: no html/text body carrying an attachment.
    expect(msg.html).toBeUndefined();
    expect(msg.text).toBeUndefined();
    // Click tracking MUST be disabled: a tracked link routes through SendGrid's
    // link-branding host, which serves a mismatched cert (COMMON_NAME_INVALID).
    expect(msg.clickTracking).toBe(false);
  });

  it("reads the template id from REPORT_EMAIL_TEMPLATE_ID when no dep is given", () => {
    process.env.REPORT_EMAIL_TEMPLATE_ID = "d-env-template";
    const msg = buildReportEmail(shop, "2026-05", URL);
    expect(msg.templateId).toBe("d-env-template");
  });

  it("fails loud when no template id is configured", () => {
    const saved = process.env.REPORT_EMAIL_TEMPLATE_ID;
    delete process.env.REPORT_EMAIL_TEMPLATE_ID;
    expect(() => buildReportEmail(shop, "2026-05", URL)).toThrow(
      /missing REPORT_EMAIL_TEMPLATE_ID/
    );
    if (saved !== undefined) process.env.REPORT_EMAIL_TEMPLATE_ID = saved;
  });
});
