import { describe, expect, it, vi } from "vitest";

import {
  buildRiversideInvoiceRows,
  connectRiversideInvoiceSeed,
  parseRiversideInvoiceSeedArgs,
  RIVERSIDE_INVOICE_NUMBERS,
  seedRiversideInvoices,
} from "../../../../scripts/seed-riverside-invoices.mjs";

const SHOP_ID = "12345678-1234-4321-9876-123456789abc";

function successfulClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const single = vi.fn().mockResolvedValue({
    data: { id: SHOP_ID, name: "Riverside Collision", slug: "riverside-collision" },
    error: null,
  });
  const shopQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single,
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "shops") return shopQuery;
      if (table === "invoices") return { upsert };
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  return { client, single, upsert };
}

describe("Riverside invoice-only seed", () => {
  it("contains exactly the approved fictional invoice allowlist and financial details", () => {
    const rows = buildRiversideInvoiceRows(SHOP_ID);

    expect(rows.map((row) => row.number).sort()).toEqual(RIVERSIDE_INVOICE_NUMBERS);
    expect(rows).toHaveLength(3);
    expect(rows.map(({ number, status, amount_due, amount_paid, raw }) => ({
      number,
      status,
      subtotal: raw.subtotal,
      tax: raw.tax,
      total: raw.total,
      amount_due,
      amount_paid,
      balance: raw.amount_remaining,
    }))).toEqual([
      { number: "RIV-DEMO-1001", status: "void", subtotal: 75_000, tax: 0, total: 75_000, amount_due: 75_000, amount_paid: 0, balance: 0 },
      { number: "RIV-DEMO-1002", status: "paid", subtotal: 250_000, tax: 0, total: 250_000, amount_due: 250_000, amount_paid: 250_000, balance: 0 },
      { number: "RIV-DEMO-1003", status: "open", subtotal: 115_000, tax: 10_000, total: 125_000, amount_due: 125_000, amount_paid: 0, balance: 125_000 },
    ]);
    expect(rows.every((row) => row.hosted_invoice_url === null && row.invoice_pdf === null)).toBe(true);
    expect(rows.every((row) => row.raw.testOnly === true && row.raw.canonical_document_ref.startsWith("demo://"))).toBe(true);
    expect(rows.every((row) => row.raw.lines.reduce((sum, line) => sum + line.amount, 0) === row.raw.subtotal)).toBe(true);
    expect(rows.map((row) => ({
      number: row.number,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      created: row.created,
      dueDate: row.raw.due_date,
      lines: row.raw.lines,
    }))).toMatchInlineSnapshot(`
      [
        {
          "created": "2026-06-15T14:00:00.000Z",
          "dueDate": "2026-06-30T23:59:59.000Z",
          "lines": [
            {
              "amount": 75000,
              "description": "Fictional consulting engagement (voided)",
              "id": "cancelled-consulting",
              "quantity": 3,
              "unit_amount": 25000,
            },
          ],
          "number": "RIV-DEMO-1001",
          "periodEnd": "2026-06-30T23:59:59.000Z",
          "periodStart": "2026-06-01T00:00:00.000Z",
        },
        {
          "created": "2026-07-15T14:00:00.000Z",
          "dueDate": "2026-07-30T23:59:59.000Z",
          "lines": [
            {
              "amount": 250000,
              "description": "Fictional quarterly marketing program",
              "id": "quarterly-marketing",
              "quantity": 1,
              "unit_amount": 250000,
            },
          ],
          "number": "RIV-DEMO-1002",
          "periodEnd": "2026-07-31T23:59:59.000Z",
          "periodStart": "2026-07-01T00:00:00.000Z",
        },
        {
          "created": "2026-08-15T14:00:00.000Z",
          "dueDate": "2026-08-30T23:59:59.000Z",
          "lines": [
            {
              "amount": 100000,
              "description": "Body Shop Marketer monthly service",
              "id": "monthly-marketing",
              "quantity": 1,
              "unit_amount": 100000,
            },
            {
              "amount": 15000,
              "description": "Fictional campaign support package",
              "id": "campaign-support",
              "quantity": 1,
              "unit_amount": 15000,
            },
          ],
          "number": "RIV-DEMO-1003",
          "periodEnd": "2026-08-31T23:59:59.000Z",
          "periodStart": "2026-08-01T00:00:00.000Z",
        },
      ]
    `);
  });

  it("fails closed without production confirmation, shop id, or credentials", () => {
    expect(() => parseRiversideInvoiceSeedArgs(["--shop-id", SHOP_ID])).toThrow("--confirm-production");
    expect(() => parseRiversideInvoiceSeedArgs(["--confirm-production"])).toThrow("--shop-id");
    expect(() =>
      connectRiversideInvoiceSeed({} as NodeJS.ProcessEnv, vi.fn()),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("verifies the target is Riverside before writing", async () => {
    const { client, single, upsert } = successfulClient();
    single.mockResolvedValueOnce({
      data: { id: SHOP_ID, name: "Another Shop", slug: "another-shop" },
      error: null,
    });

    await expect(seedRiversideInvoices(client, { shopId: SHOP_ID })).rejects.toThrow(
      "Target shop is not Riverside Collision",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("supports a no-write dry run after validating the shop", async () => {
    const { client, upsert } = successfulClient();

    await expect(seedRiversideInvoices(client, { shopId: SHOP_ID, dryRun: true })).resolves.toMatchObject({
      rowCount: 3,
      dryRun: true,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("uses the invoice primary key for repeat-safe upserts", async () => {
    const { client, upsert } = successfulClient();

    await seedRiversideInvoices(client, { shopId: SHOP_ID });
    await seedRiversideInvoices(client, { shopId: SHOP_ID });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, buildRiversideInvoiceRows(SHOP_ID), {
      onConflict: "stripe_invoice_id",
    });
    expect(upsert).toHaveBeenNthCalledWith(2, buildRiversideInvoiceRows(SHOP_ID), {
      onConflict: "stripe_invoice_id",
    });
  });
});
