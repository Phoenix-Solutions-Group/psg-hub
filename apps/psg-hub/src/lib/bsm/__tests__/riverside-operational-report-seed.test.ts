import { describe, expect, it, vi } from "vitest";

import {
  buildRiversideOperationalReportRows,
  RIVERSIDE_DEMO_SEED_MARKER,
  seedRiversideOperationalReports,
} from "../../../../scripts/seed-riverside-operational-reports.mjs";

function successfulClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const customerSingle = vi.fn().mockResolvedValue({
    data: {
      id: "demo-customer",
      company_id: "riverside-company",
      first_name: "Maria",
      last_name: "Alvarez",
      email: "maria.alvarez@example.invalid",
    },
    error: null,
  });
  const companySingle = vi.fn().mockResolvedValue({
    data: { id: "riverside-company", name: "Riverside Collision" },
    error: null,
  });
  const customerQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: customerSingle,
  };
  const companyQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: companySingle,
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "companies") return companyQuery;
      if (table === "repair_customers") return customerQuery;
      if (table === "repair_orders") return { upsert };
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  return { client, customerSingle, upsert };
}

describe("Riverside operational-report seed", () => {
  it("builds the expected July and August Processing Recap totals", () => {
    const rows = buildRiversideOperationalReportRows({
      companyId: "riverside-company",
      customerId: "demo-customer",
    });
    const summarize = (month: string) => {
      const monthRows = rows.filter((row) => row.created_at.startsWith(month));
      return {
        opened: monthRows.length,
        closed: monthRows.filter((row) => row.status === "closed").length,
        processed:
          monthRows.reduce((total, row) => total + row.repair_amount_cents, 0) /
          100,
      };
    };

    expect(summarize("2026-07")).toEqual({
      opened: 3,
      closed: 2,
      processed: 18_500,
    });
    expect(summarize("2026-08")).toEqual({
      opened: 2,
      closed: 1,
      processed: 14_750,
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.company_id === "riverside-company")).toBe(
      true,
    );
    expect(
      rows.every((row) => row.repair_customer_id === "demo-customer"),
    ).toBe(true);
    expect(
      rows.every(
        (row) => row.payload_jsonb.demoSeed === RIVERSIDE_DEMO_SEED_MARKER,
      ),
    ).toBe(true);
  });

  it("uses the company and repair-order key for repeatable writes", async () => {
    const { client, upsert } = successfulClient();

    await expect(seedRiversideOperationalReports(client)).resolves.toEqual({
      companyId: "riverside-company",
      customerId: "demo-customer",
      rowCount: 5,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Object)]),
      {
        onConflict: "company_id,ro_number",
      },
    );
  });

  it("does not write when the clearly fake Riverside customer is missing", async () => {
    const { client, customerSingle, upsert } = successfulClient();
    customerSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(seedRiversideOperationalReports(client)).rejects.toThrow(
      "Riverside demo repair customer was not found; no rows were written",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("surfaces a failed repeatable write", async () => {
    const { client, upsert } = successfulClient();
    upsert.mockResolvedValueOnce({
      error: { message: "database unavailable" },
    });

    await expect(seedRiversideOperationalReports(client)).rejects.toThrow(
      "Riverside operational report seed failed: database unavailable",
    );
  });
});
