export type DocumentSearchRow = {
  id: string;
  batch_id: string;
  company_id: string;
  repair_customer_id: string | null;
  piece_type: string;
  status: string;
  vendor: string | null;
  external_id: string | null;
  proof_url: string | null;
  rendered_url: string | null;
  expected_delivery_date: string | null;
  created_at: string;
  production_batches?: { name: string | null } | { name: string | null }[] | null;
  companies?: { name: string | null } | { name: string | null }[] | null;
  repair_customers?:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
};

export type ProductionDocumentResult = {
  id: string;
  batch_id: string;
  batch_name: string | null;
  company_id: string;
  shop_name: string | null;
  repair_customer_id: string | null;
  customer_name: string | null;
  status: string;
  piece_type: string;
  vendor: string | null;
  external_id: string | null;
  proof_url: string | null;
  rendered_url: string | null;
  expected_delivery_date: string | null;
  created_at: string;
};

export function normalizeSearch(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function mapDocumentRows(rows: DocumentSearchRow[]): ProductionDocumentResult[] {
  return rows.map((row) => {
    const company = one(row.companies);
    const customer = one(row.repair_customers);
    const batch = one(row.production_batches);
    const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ");
    return {
      id: row.id,
      batch_id: row.batch_id,
      batch_name: batch?.name ?? null,
      company_id: row.company_id,
      shop_name: company?.name ?? null,
      repair_customer_id: row.repair_customer_id,
      customer_name: customerName || null,
      status: row.status,
      piece_type: row.piece_type,
      vendor: row.vendor,
      external_id: row.external_id,
      proof_url: row.proof_url,
      rendered_url: row.rendered_url,
      expected_delivery_date: row.expected_delivery_date,
      created_at: row.created_at,
    };
  });
}

export function filterProductionDocuments(
  documents: ProductionDocumentResult[],
  normalizedQuery: string
): ProductionDocumentResult[] {
  if (!normalizedQuery) return documents;
  return documents.filter((row) =>
    [
      row.external_id,
      row.shop_name,
      row.customer_name,
      row.batch_name,
      row.piece_type,
      row.status,
      row.vendor,
      row.expected_delivery_date,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
