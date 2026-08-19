import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const CUSTOMER_GOOGLE_ADS_COPY_FILES = [
  "src/app/dashboard/ads/page.tsx",
  "src/app/dashboard/ads/accounts-table.tsx",
  "src/app/dashboard/ads/link-account-button.tsx",
  "src/app/dashboard/ads/campaigns-section.tsx",
  "src/app/dashboard/ads/metrics-summary.tsx",
  "src/app/dashboard/analytics/page.tsx",
  "src/app/api/shops/[shopId]/google-ads/requests/route.ts",
  "src/app/api/google-ads/audit-reports/[reportId]/download/route.ts",
  "src/lib/google-ads/customer-requests.ts",
  "src/lib/google-ads/audit-reports.ts",
] as const;

function readCopyCorpus() {
  return CUSTOMER_GOOGLE_ADS_COPY_FILES.map((file) =>
    readFileSync(join(ROOT, file), "utf8")
  ).join("\n");
}

describe("Google Ads customer promise copy", () => {
  it("does not imply PSG owns the customer's account or fronts ad spend", () => {
    const corpus = readCopyCorpus();

    expect(corpus).toMatch(/Your Google Ads/i);
    expect(corpus).toMatch(/ask PSG for help/i);
    expect(corpus).toMatch(/executesGoogleAdsChange:\s*false/);
    expect(corpus).not.toMatch(/PSG\s+owns\s+(?:the|your)?\s*Google Ads account/i);
    expect(corpus).not.toMatch(/Google Ads account\s+(?:owned|held)\s+by\s+PSG/i);
    expect(corpus).not.toMatch(/PSG\s+(?:pays|fronts|covers|advances)\s+(?:Google|ad spend|ads? spend)/i);
    expect(corpus).not.toMatch(/(?:ad spend|ads? spend)\s+(?:is|are)\s+(?:paid|fronted|covered|advanced)\s+by\s+PSG/i);
    expect(corpus).not.toMatch(/PSG\s+will\s+bill\s+you\s+for\s+Google\s+spend/i);
    expect(corpus).not.toMatch(/guarantee(?:d|s)?\s+(?:results|leads|conversions|calls)/i);
    expect(corpus).not.toMatch(/live\s+(?:Google Ads\s+)?numbers/i);
    expect(corpus).not.toMatch(/(?:instant|immediate)\s+(?:Google Ads\s+)?changes/i);
    expect(corpus).not.toMatch(/(?:automatically|auto)\s+changes?\s+(?:Google Ads\s+)?budgets/i);
  });
});
