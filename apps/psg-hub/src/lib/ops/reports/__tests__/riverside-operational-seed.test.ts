import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const seedPath = path.resolve(
  process.cwd(),
  "supabase/seeds/riverside_operational_reports.sql"
);
const seedSql = fs.readFileSync(seedPath, "utf8");

describe("Riverside operational-report seed", () => {
  it("contains only the five approved deterministic repair orders", () => {
    const repairOrderNumbers = [
      ...seedSql.matchAll(/'(DEMO-RIV-2026-\d{2}-\d{2})'/g),
    ].map((match) => match[1]);

    expect(repairOrderNumbers).toEqual([
      "DEMO-RIV-2026-07-01",
      "DEMO-RIV-2026-07-02",
      "DEMO-RIV-2026-07-03",
      "DEMO-RIV-2026-08-01",
      "DEMO-RIV-2026-08-02",
    ]);
    expect(seedSql).not.toMatch(/insert into public\.(companies|repair_customers)/i);
  });

  it("preserves demo links and idempotency", () => {
    expect(seedSql).toContain("riverside_customer_id, riverside_company_id");
    expect(seedSql).toContain("on conflict (company_id, ro_number) do update");
    expect(seedSql).toContain('maria.alvarez@example.invalid');
    expect(seedSql.match(/psg-2975-operational-reports/g)).toHaveLength(5);
  });

  it("keeps the approved July and August Processing Recap totals", () => {
    const rows = [...seedSql.matchAll(
      /'DEMO-RIV-2026-(\d{2})-\d{2}', '(open|closed)',\s+(\d+)/g
    )].map((match) => ({
      month: match[1],
      status: match[2],
      amount: Number(match[3]),
    }));
    const summarize = (month: string) => {
      const monthRows = rows.filter((row) => row.month === month);
      return {
        opened: monthRows.length,
        closed: monthRows.filter((row) => row.status === "closed").length,
        processed: monthRows.reduce((total, row) => total + row.amount, 0) / 100,
      };
    };

    expect(summarize("07")).toEqual({ opened: 3, closed: 2, processed: 18_500 });
    expect(summarize("08")).toEqual({ opened: 2, closed: 1, processed: 14_750 });
  });
});
