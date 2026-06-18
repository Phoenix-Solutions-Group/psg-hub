// v1.1 / PSG-38 — Import validate/preview API.
// POST /api/ops/import/validate  (multipart/form-data)
//   fields: file, kind ("ro"|"estimate"), [template_id], [mapping (JSON)]
// Parses the upload, applies the chosen/auto mapping, validates+normalizes
// every row, and returns a preview (headers, resolved mapping, row-level
// errors/warnings). No DB writes. Gated by manage_companies.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  previewImport,
  suggestMapping,
  UnsupportedSpreadsheetError,
  type FieldMapping,
  type ImportKind,
} from "@/lib/ops/import";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB upload ceiling.

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
  if (kindRaw !== "ro" && kindRaw !== "estimate") {
    return NextResponse.json({ error: "kind must be 'ro' or 'estimate'" }, { status: 400 });
  }
  const kind = kindRaw as ImportKind;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 15 MB limit" }, { status: 413 });
  }

  // Resolve the mapping: explicit JSON > saved template > auto-suggest (below).
  let mapping: FieldMapping | undefined;
  const mappingRaw = form.get("mapping");
  if (typeof mappingRaw === "string" && mappingRaw.trim()) {
    try {
      const parsed = JSON.parse(mappingRaw);
      if (parsed && typeof parsed === "object") mapping = parsed as FieldMapping;
    } catch {
      return NextResponse.json({ error: "mapping must be valid JSON" }, { status: 400 });
    }
  } else {
    const templateId = form.get("template_id");
    if (typeof templateId === "string" && templateId) {
      const service = createServiceClient();
      const { data } = await service
        .from("import_templates")
        .select("field_mapping_jsonb")
        .eq("id", templateId)
        .maybeSingle();
      if (data?.field_mapping_jsonb) mapping = data.field_mapping_jsonb as FieldMapping;
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const result = await previewImport({ kind, filename: file.name, buffer, mapping });
    // Surface a suggested mapping too, so the wizard can offer "auto-fill".
    const suggested = suggestMapping(kind, result.table.headers);
    return NextResponse.json({ ...result, suggested });
  } catch (err) {
    if (err instanceof UnsupportedSpreadsheetError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Failed to parse file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
