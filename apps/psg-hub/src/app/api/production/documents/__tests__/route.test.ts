import { describe, expect, it } from "vitest";
import {
  filterProductionDocuments,
  normalizeSearch,
  type ProductionDocumentResult,
} from "@/lib/ops/production-document-search";

const rows: ProductionDocumentResult[] = [
  {
    id: "doc-1",
    batch_id: "batch-1",
    batch_name: "July thank-you cards",
    company_id: "company-1",
    shop_name: "Wallace Collision Center",
    repair_customer_id: "customer-1",
    customer_name: "Maria Flores",
    status: "delivered",
    piece_type: "postcard",
    vendor: "lob",
    external_id: "psc_123",
    proof_url: null,
    rendered_url: null,
    expected_delivery_date: "2026-07-24",
    created_at: "2026-07-20T00:00:00.000Z",
  },
  {
    id: "doc-2",
    batch_id: "batch-2",
    batch_name: "Warranty letters",
    company_id: "company-2",
    shop_name: "Tedesco Auto Body",
    repair_customer_id: "customer-2",
    customer_name: "Nick Barnes",
    status: "rendered",
    piece_type: "letter",
    vendor: "inhouse",
    external_id: null,
    proof_url: null,
    rendered_url: null,
    expected_delivery_date: null,
    created_at: "2026-07-21T00:00:00.000Z",
  },
];

describe("production document search", () => {
  it("normalizes human-entered search text", () => {
    expect(normalizeSearch("  Wallace   Collision  ")).toBe("wallace collision");
  });

  it("matches backend results by shop, customer, batch, status, type, vendor, and print ID words", () => {
    expect(filterProductionDocuments(rows, "wallace")).toEqual([rows[0]]);
    expect(filterProductionDocuments(rows, "maria flores")).toEqual([rows[0]]);
    expect(filterProductionDocuments(rows, "thank-you")).toEqual([rows[0]]);
    expect(filterProductionDocuments(rows, "delivered")).toEqual([rows[0]]);
    expect(filterProductionDocuments(rows, "letter")).toEqual([rows[1]]);
    expect(filterProductionDocuments(rows, "inhouse")).toEqual([rows[1]]);
    expect(filterProductionDocuments(rows, "psc_123")).toEqual([rows[0]]);
  });
});
