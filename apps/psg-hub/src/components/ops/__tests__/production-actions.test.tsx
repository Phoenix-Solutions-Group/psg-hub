import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filterProductionDocumentRows,
  ProductionDocumentsTable,
  type ActionDocRow,
} from "@/components/ops/production-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const row = (overrides: Partial<ActionDocRow> = {}): ActionDocRow => ({
  id: "doc-1",
  batch_id: "batch-1",
  batch_name: "July warranty batch",
  company_id: "company-1",
  shop_name: "Wallace Collision",
  repair_customer_id: "customer-1",
  customer_name: "Maya Rivera",
  status: "mailed",
  piece_type: "postcard",
  vendor: "lob",
  external_id: "psc_123",
  proof_url: "https://proofs.example/psc_123.pdf",
  rendered_url: "https://rendered.example/psc_123.pdf",
  expected_delivery_date: "2026-07-24",
  created_at: "2026-07-23T12:00:00.000Z",
  ...overrides,
});

describe("ProductionDocumentsTable", () => {
  it("shows the production history search by default", () => {
    const html = renderToStaticMarkup(<ProductionDocumentsTable rows={[row()]} />);

    expect(html).toContain("<details");
    expect(html).toContain("<details open");
    expect(html).toContain("Search production history");
  });

  it("shows customer, shop, and proof access on document rows", () => {
    const html = renderToStaticMarkup(<ProductionDocumentsTable rows={[row()]} />);

    expect(html).toContain("Maya Rivera");
    expect(html).toContain("Wallace Collision");
    expect(html).toContain("View proof");
    expect(html).toContain('href="https://proofs.example/psc_123.pdf"');
  });

  it("falls back to the rendered artwork when a vendor proof is not present", () => {
    const html = renderToStaticMarkup(
      <ProductionDocumentsTable rows={[row({ proof_url: null })]} />
    );

    expect(html).toContain('href="https://rendered.example/psc_123.pdf"');
  });
});

describe("filterProductionDocumentRows", () => {
  const rows = [
    row(),
    row({
      id: "doc-2",
      batch_id: "batch-2",
      batch_name: "Tedesco thank-you batch",
      company_id: "company-2",
      shop_name: "Tedesco Auto Body",
      repair_customer_id: "customer-2",
      customer_name: "Nina Patel",
      external_id: "psc_456",
    }),
  ];

  it("searches visible shop, customer, and batch fields", () => {
    expect(filterProductionDocumentRows(rows, "wallace")).toEqual([rows[0]]);
    expect(filterProductionDocumentRows(rows, "nina")).toEqual([rows[1]]);
    expect(filterProductionDocumentRows(rows, "thank-you")).toEqual([rows[1]]);
  });

  it("returns all rows for empty search text", () => {
    expect(filterProductionDocumentRows(rows, "   ")).toEqual(rows);
  });
});
