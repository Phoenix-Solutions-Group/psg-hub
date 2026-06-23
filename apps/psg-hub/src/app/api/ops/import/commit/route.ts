// v1.1 / PSG-38 — Import commit API.
// POST /api/ops/import/commit  (multipart/form-data)
//   fields: file, kind, company_id, [template_id|mapping]
// Re-parses + re-validates the upload SERVER-SIDE (never trusts client-supplied
// normalized rows), then writes valid rows: repair_customers + repair_orders or
// estimates. Idempotent — rows whose RO/estimate number already exists for the
// company are skipped, not duplicated. Gated by manage_companies.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  previewImport,
  toCommitRecord,
  UnsupportedSpreadsheetError,
  type FieldMapping,
  type ImportKind,
} from "@/lib/ops/import";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const kindRaw = String(form.get("kind") ?? "");
  const companyId = String(form.get("company_id") ?? "");
  if (kindRaw !== "ro" && kindRaw !== "estimate") {
    return NextResponse.json({ error: "kind must be 'ro' or 'estimate'" }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 15 MB limit" }, { status: 413 });
  }
  const kind = kindRaw as ImportKind;

  let mapping: FieldMapping | undefined;
  const mappingRaw = form.get("mapping");
  const service = createServiceClient();
  if (typeof mappingRaw === "string" && mappingRaw.trim()) {
    try {
      mapping = JSON.parse(mappingRaw) as FieldMapping;
    } catch {
      return NextResponse.json({ error: "mapping must be valid JSON" }, { status: 400 });
    }
  } else {
    const templateId = form.get("template_id");
    if (typeof templateId === "string" && templateId) {
      const { data } = await service
        .from("import_templates")
        .select("field_mapping_jsonb")
        .eq("id", templateId)
        .maybeSingle();
      if (data?.field_mapping_jsonb) mapping = data.field_mapping_jsonb as FieldMapping;
    }
  }

  // Confirm the company exists (FK would fail anyway, but give a clean error).
  const { data: company } = await service
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "Unknown company_id" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let validation;
  try {
    ({ validation } = await previewImport({ kind, filename: file.name, buffer, mapping }));
  } catch (err) {
    if (err instanceof UnsupportedSpreadsheetError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Failed to parse file";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (validation.unmappedRequired.length > 0) {
    return NextResponse.json(
      { error: "Required fields are unmapped", unmappedRequired: validation.unmappedRequired },
      { status: 422 },
    );
  }

  const numberCol = kind === "ro" ? "ro_number" : "estimate_number";
  const targetTable = kind === "ro" ? "repair_orders" : "estimates";

  const result = { inserted: 0, skipped: 0, failedRows: [] as Array<{ index: number; error: string }> };

  for (const row of validation.rows) {
    if (row.errors.length > 0) {
      result.failedRows.push({ index: row.index, error: row.errors[0] });
      continue;
    }
    const rec = toCommitRecord(kind, row);
    const number = kind === "ro" ? rec.ro!.ro_number : rec.estimate!.estimate_number;

    // Idempotency: skip if this number already exists for the company.
    const { data: existing } = await service
      .from(targetTable)
      .select("id")
      .eq("company_id", companyId)
      .eq(numberCol, number)
      .maybeSingle();
    if (existing) {
      result.skipped++;
      continue;
    }

    const { data: customer, error: custErr } = await service
      .from("repair_customers")
      .insert({
        company_id: companyId,
        first_name: rec.customer.first_name,
        last_name: rec.customer.last_name,
        phone: rec.customer.phone,
        email: rec.customer.email,
        address: rec.customer.address,
      })
      .select("id")
      .single();
    if (custErr || !customer) {
      result.failedRows.push({ index: row.index, error: custErr?.message ?? "customer insert failed" });
      continue;
    }

    let insertErr: string | null = null;
    if (kind === "ro") {
      const { error } = await service.from("repair_orders").insert({
        company_id: companyId,
        repair_customer_id: customer.id,
        ro_number: rec.ro!.ro_number,
        total_loss_flag: rec.ro!.total_loss_flag,
        dates_json: rec.ro!.dates_json,
        // PSG-352: canonical invoiced-$ + pay-type. null when the source didn't
        // record them (honest sourcing — never written as 0 / a bogus bucket).
        repair_amount_cents: rec.ro!.repair_amount_cents,
        pay_type: rec.ro!.pay_type,
        payload_jsonb: { ...rec.ro!.payload_jsonb, vehicle: { make: rec.ro!.vehicle_make, model: rec.ro!.vehicle_model } },
      });
      insertErr = error?.message ?? null;
    } else {
      const { error } = await service.from("estimates").insert({
        company_id: companyId,
        repair_customer_id: customer.id,
        estimate_number: rec.estimate!.estimate_number,
        payload_jsonb: rec.estimate!.payload_jsonb,
      });
      insertErr = error?.message ?? null;
    }

    if (insertErr) {
      // Roll back the just-created customer so we don't orphan it.
      await service.from("repair_customers").delete().eq("id", customer.id);
      result.failedRows.push({ index: row.index, error: insertErr });
      continue;
    }
    result.inserted++;
  }

  return NextResponse.json({
    kind,
    company_id: companyId,
    total: validation.total,
    ...result,
  });
}
