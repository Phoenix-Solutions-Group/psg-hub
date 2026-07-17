import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  buildBatchDocuments,
  generateBatchSchema,
  type GenerateCustomer,
} from "@/lib/ops/production";
import {
  dateOnly,
  evaluateEligibilityBatch,
  extractRoCompletedAt,
  letterKindForProduct,
  type EligibilityCustomer,
  type EligibilityDecision,
  type SurveyAlert,
} from "@/lib/ops/mail/eligibility";
import { supabaseApprovalStore } from "@/lib/ops/template-approvals";
import {
  currentTemplateHash,
  ineligibleReason,
  TemplateNotApprovedError,
} from "@/lib/production/template-gate";

// v1.3 / PSG-27 (PSG-52) — production batch generation. The "pick product →
// pick company → generate" step from PLANNING.md (/api/production/generate):
// create a named batch for one company's program and render one mail piece per
// repair customer (blank customer set = every customer for the company). The
// rendered HTML feeds the Lob adapter directly at print time. Gated by
// manage_production; RLS backstops. No vendor spend here — generation only
// renders + persists; the (Lob test / in-house) submit happens at print time.
//
// PSG-217 / PSG-115b GATE: this route is the entry point for a LIVE batch, so it
// is also the chokepoint that refuses an un-approved template. Before any rows are
// written, the template (product) must have a `released` approval matching the
// current template bytes; otherwise the batch is rejected (422). No un-approved
// template can ever reach a live run.

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = generateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { name, company_id, product_id, product, repair_customer_ids, vendor } = parsed.data;

  const service = createServiceClient();

  // GATE: the template must be released for live batches (matching current bytes).
  const templateHash = currentTemplateHash(product);
  const approvalRow = await supabaseApprovalStore(service).get(product, templateHash);
  const approvalState = approvalRow
    ? { templateKey: product, contentHash: approvalRow.content_hash, status: approvalRow.status }
    : null;
  const blocked = ineligibleReason(approvalState, templateHash);
  if (blocked) {
    return NextResponse.json(
      {
        error: new TemplateNotApprovedError(product, blocked).message,
        templateKey: product,
        reason: blocked,
      },
      { status: 422 }
    );
  }

  // The company supplies the from-address + merge fields for every piece.
  const { data: company, error: companyError } = await service
    .from("companies")
    .select("id, name, phone, address")
    .eq("id", company_id)
    .single();
  if (companyError || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // The recipients: an explicit subset, or every repair customer for the company.
  let customerQuery = service
    .from("repair_customers")
    .select("id, first_name, last_name, address")
    .eq("company_id", company_id);
  if (repair_customer_ids && repair_customer_ids.length > 0) {
    customerQuery = customerQuery.in("id", repair_customer_ids);
  }
  const { data: customers, error: customersError } = await customerQuery;
  if (customersError) {
    return NextResponse.json({ error: "Failed to load repair customers" }, { status: 500 });
  }
  if (!customers || customers.length === 0) {
    return NextResponse.json(
      { error: "No repair customers to generate documents for" },
      { status: 422 }
    );
  }

  const customerIds = (customers as GenerateCustomer[]).map((c) => c.id);
  const { data: repairOrders, error: repairOrdersError } = await service
    .from("repair_orders")
    .select("repair_customer_id, dates_json, created_at")
    .eq("company_id", company_id)
    .in("repair_customer_id", customerIds)
    .order("created_at", { ascending: false });
  if (repairOrdersError) {
    return NextResponse.json({ error: "Failed to load repair-order eligibility dates" }, { status: 500 });
  }

  const asOf = dateOnly(new Date());
  const alertWindowStart = dateOnly(
    new Date(Date.now() - 120 * 86_400_000)
  );
  const { data: surveyAlerts, error: surveyAlertsError } = await service
    .from("survey_responses")
    .select("repair_customer_id, alert_class, alert_posted_at")
    .in("repair_customer_id", customerIds)
    .neq("alert_class", "none")
    .gte("alert_posted_at", alertWindowStart);
  if (surveyAlertsError) {
    return NextResponse.json({ error: "Failed to load survey-alert suppression state" }, { status: 500 });
  }

  const roCompletedByCustomer = new Map<string, string>();
  for (const ro of repairOrders ?? []) {
    const row = ro as { repair_customer_id?: string | null; dates_json?: unknown; created_at?: string | null };
    if (!row.repair_customer_id || roCompletedByCustomer.has(row.repair_customer_id)) continue;
    const completed = extractRoCompletedAt(row.dates_json) ?? (row.created_at ? dateOnly(row.created_at) : null);
    if (completed) roCompletedByCustomer.set(row.repair_customer_id, completed);
  }

  const alertsByCustomer = new Map<string, SurveyAlert[]>();
  for (const alert of surveyAlerts ?? []) {
    const row = alert as {
      repair_customer_id?: string | null;
      alert_class?: string | null;
      alert_posted_at?: string | null;
    };
    if (!row.repair_customer_id) continue;
    const bucket = alertsByCustomer.get(row.repair_customer_id) ?? [];
    bucket.push({ alertClass: row.alert_class ?? null, alertPostedAt: row.alert_posted_at ?? null });
    alertsByCustomer.set(row.repair_customer_id, bucket);
  }

  const letterKind = letterKindForProduct(product);
  const eligibilityInputs: EligibilityCustomer[] = (customers as GenerateCustomer[]).map((customer) => ({
    id: customer.id,
    firstName: customer.first_name,
    lastName: customer.last_name,
    address: customer.address,
    roCompletedAt: roCompletedByCustomer.get(customer.id) ?? null,
    surveyAlerts: alertsByCustomer.get(customer.id) ?? [],
  }));
  const eligibility = evaluateEligibilityBatch(eligibilityInputs, { letterKind, asOf });

  const upsertRows = eligibility.decisions.map((decision) => ({
    repair_customer_id: decision.repairCustomerId,
    letter_kind: decision.letterKind,
    period_key: decision.periodKey,
    eligible: decision.eligible,
    printable: decision.printable,
    suppressed_by_alert: decision.suppressedByAlert,
    reasons: decision.reasons,
    computed_at: new Date().toISOString(),
  }));
  const { data: eligibilityRows, error: eligibilityError } = await service
    .from("letter_eligibility")
    .upsert(upsertRows, { onConflict: "repair_customer_id,letter_kind,period_key" })
    .select("id, repair_customer_id");
  if (eligibilityError) {
    console.error("[production/generate] eligibility upsert:", eligibilityError.message);
    return NextResponse.json({ error: "Failed to save direct-mail eligibility decisions" }, { status: 500 });
  }

  const eligibilityIdByCustomer = new Map<string, string>();
  for (const row of eligibilityRows ?? []) {
    const r = row as { id?: string; repair_customer_id?: string };
    if (r.id && r.repair_customer_id) eligibilityIdByCustomer.set(r.repair_customer_id, r.id);
  }

  const eligibleCustomerIds = new Set(eligibility.eligibleIds);
  const eligibleCustomers = (customers as GenerateCustomer[])
    .filter((customer) => eligibleCustomerIds.has(customer.id))
    .map((customer) => ({
      ...customer,
      service_date: roCompletedByCustomer.get(customer.id) ?? customer.service_date ?? null,
      letter_eligibility_id: eligibilityIdByCustomer.get(customer.id) ?? null,
    }));

  if (eligibleCustomers.length === 0) {
    return NextResponse.json(
      {
        error: "No eligible, printable repair customers for this direct-mail batch",
        eligibility: summarizeEligibility(eligibility.decisions),
      },
      { status: 422 }
    );
  }

  // Optional per-shop customizations (greeting/footer/logo) for this program.
  let program: Record<string, string> | null = null;
  if (product_id) {
    const { data: prog } = await service
      .from("company_programs")
      .select("customizations_jsonb")
      .eq("company_id", company_id)
      .eq("product_id", product_id)
      .maybeSingle();
    program = (prog?.customizations_jsonb as Record<string, string> | undefined) ?? null;
  }

  // Stamp every piece in the batch with the same display month/year so the
  // master letters' `{{customer.letterDate}}` resolves on the really-mailed
  // piece (the builder stays pure — the route owns the clock).
  const letterDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const built = buildBatchDocuments(
    {
      id: company.id,
      name: company.name,
      phone: company.phone,
      address: company.address as GenerateCustomer["address"],
      program,
    },
    eligibleCustomers,
    { product, productId: product_id ?? null, vendor: vendor ?? null, letterDate }
  );

  // Create the batch first (queued, with the resolved vendor + document count),
  // then its documents. The print queue (draft/queued/printing) picks it up.
  const { data: batch, error: batchError } = await service
    .from("production_batches")
    .insert({
      name,
      company_id,
      product_id: product_id ?? null,
      status: "queued",
      vendor: built.vendor,
      document_count: built.documentCount,
      created_by_profile_id: gate.userId,
    })
    .select("id, name, company_id, product_id, status, vendor, document_count, created_at")
    .single();
  if (batchError || !batch) {
    console.error("[production/generate] batch insert:", batchError?.message);
    return NextResponse.json({ error: "Failed to create batch" }, { status: 500 });
  }

  const rows = built.documents.map((d) => ({ ...d, batch_id: batch.id }));
  const { error: docsError } = await service.from("production_documents").insert(rows);
  if (docsError) {
    // Don't leave an empty orphan batch behind if the documents fail to insert.
    await service.from("production_batches").delete().eq("id", batch.id);
    console.error("[production/generate] documents insert:", docsError.message);
    return NextResponse.json({ error: "Failed to generate documents" }, { status: 500 });
  }

  return NextResponse.json(
    {
      batch,
      documents: built.documentCount,
      vendor: built.vendor,
      missing: built.missingByCustomer,
      eligibility: summarizeEligibility(eligibility.decisions),
    },
    { status: 201 }
  );
}

function summarizeEligibility(decisions: EligibilityDecision[]) {
  return {
    total: decisions.length,
    eligible: decisions.filter((d) => d.eligible).length,
    nonPrintable: decisions.filter((d) => !d.printable).map(toEligibilitySummary),
    suppressed: decisions.filter((d) => d.suppressedByAlert).map(toEligibilitySummary),
    ineligible: decisions.filter((d) => !d.eligible).map(toEligibilitySummary),
  };
}

function toEligibilitySummary(decision: EligibilityDecision) {
  return {
    repairCustomerId: decision.repairCustomerId,
    letterKind: decision.letterKind,
    periodKey: decision.periodKey,
    reasons: decision.reasons,
  };
}
