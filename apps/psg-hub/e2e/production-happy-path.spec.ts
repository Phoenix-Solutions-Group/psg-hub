import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PROD_OPS } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";
import { currentTemplateHash } from "@/lib/production/template-gate";

/**
 * PSG-52 — v1.3 Production happy path (the one E2E the v1.3 Quality Gate and the
 * PSG-44 cutover runbook require):
 *
 *   company -> product(program) -> repair customer -> generate batch -> print
 *   -> status advances (queued -> printing -> historical) -> historical search
 *   finds it -> reprint (audited, writes production_reprint_log).
 *
 * Driven as internal ops staff (psg_superadmin storageState, which passes
 * manage_production). Pattern matches ops-happy-path.spec.ts: real UI on the
 * /ops/production surface where it exists, authenticated request context for the
 * gated API legs.
 *
 *   1. company           — manage_companies POST /api/companies (full address;
 *                          the address is the from-address on every mail piece).
 *   2. product + program — sys-config POST /api/sys-config/products, then the
 *                          company_programs enrolment POST /api/companies/:id/programs.
 *   3. repair customer   — manage_companies POST /api/repair-customers (the
 *                          recipient / to-address).
 *   4. generate batch    — POST /api/production/generate (PSG-52): creates a
 *                          queued batch + renders one letter document per customer.
 *   5. print             — POST /api/production/batches/:id/print: submits each
 *                          document through the Lob TEST API (LOB_API_KEY=test_*,
 *                          NO live spend) and moves the batch printing->historical.
 *   6. historical search — GET /api/production/documents?external_id=... &
 *                          ?company_id=... finds the printed piece.
 *   7. reprint           — POST /api/production/documents/:id/reprint: re-submits
 *                          AND writes the production_reprint_log audit row.
 *
 * The print leg calls api.lob.com with a test_* key, so it needs network + a
 * LOB_API_KEY in the Next server env — it runs green in CI/staging, NOT in the
 * agent sandbox. The production_reprint_log audit row has no read API, so the
 * audit assertion reads it back with the same service-role client the seed uses.
 */

test.use({ storageState: PROD_OPS.statePath });

/** Service-role client for the read-only audit assertion (no API surface for it). */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedReleasedWarrantyTemplate(): Promise<void> {
  const admin = adminClient();
  const { data: user, error: userError } = await admin
    .from("profiles")
    .select("id")
    .eq("display_name", "E2E Ops Staff")
    .single();
  expect(userError, userError?.message).toBeNull();
  expect(user?.id, "E2E ops profile id").toBeTruthy();

  const now = new Date().toISOString();
  const { error } = await admin.from("mail_template_approvals").upsert(
    {
      template_key: "warranty",
      content_hash: currentTemplateHash("warranty"),
      status: "released",
      approved_by_profile_id: user!.id,
      approved_by_name: "E2E Ops Staff",
      approved_at: now,
      released_by_profile_id: user!.id,
      released_at: now,
      created_by_profile_id: user!.id,
      notes: "E2E test-mode release for production happy path.",
    },
    { onConflict: "template_key,content_hash" }
  );
  expect(error, error?.message).toBeNull();
}

test("production happy path: generate -> print (Lob test) -> historical -> reprint (audited)", async ({
  page,
}) => {
  await seedReleasedWarrantyTemplate();

  // --- /ops/production landing: staff has the manage_production surface --------
  await page.goto("/ops/production");
  await expect(page.getByRole("heading", { name: "Production", exact: true })).toBeVisible();

  // --- Step 1: company (full address — the from-address for every piece) -------
  const companyRes = await page.request.post("/api/companies", {
    data: {
      name: PROD_OPS.companyName,
      contact: "Pat Owner",
      phone: "555-0142",
      address: {
        line1: "100 Shop Way",
        city: "Austin",
        state: "TX",
        postal_code: "73301",
      },
    },
  });
  expect(companyRes.status(), "create company").toBe(201);
  const companyId = (await companyRes.json()).company.id as string;
  expect(companyId).toMatch(UUID_RE);

  // --- Step 2: product + program enrolment -------------------------------------
  const productRes = await page.request.post("/api/sys-config/products", {
    data: { name: PROD_OPS.productName, selling_price_cents: 199 },
  });
  expect(productRes.status(), "create product").toBe(201);
  const productId = (await productRes.json()).product.id as string;
  expect(productId).toMatch(UUID_RE);

  const programRes = await page.request.post(`/api/companies/${companyId}/programs`, {
    data: {
      product_id: productId,
      customizations_jsonb: {
        greeting: "We appreciate your business.",
        footer: "Apex Collision — quality you can trust.",
      },
    },
  });
  expect(programRes.status(), "enrol program").toBe(201);

  // --- Step 3: repair customer (the recipient / to-address) --------------------
  const customerRes = await page.request.post("/api/repair-customers", {
    data: {
      company_id: companyId,
      first_name: "Alex",
      last_name: "Driver",
      phone: "555-0188",
      email: "alex@e2e-prod.test",
      address: {
        // 185 Berry St is Lob's own SF office — guaranteed USPS-deliverable.
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
    },
  });
  expect(customerRes.status(), "create repair customer").toBe(201);
  const customerId = (await customerRes.json()).customer.id as string;
  expect(customerId).toMatch(UUID_RE);

  // The warranty template maps to the one-year letter. Current production
  // generation evaluates direct-mail eligibility before it creates documents,
  // so the fixture needs a completed repair order inside that one-year window.
  const completedAt = new Date(Date.now() - 370 * 86_400_000).toISOString().slice(0, 10);
  const roRes = await page.request.post("/api/repair-orders", {
    data: {
      company_id: companyId,
      repair_customer_id: customerId,
      ro_number: `E2E-WARRANTY-${Date.now()}`,
      status: "closed",
      dates_json: { completed_at: completedAt },
    },
  });
  const roBody = await roRes.json().catch(() => null);
  expect(roRes.status(), `create repair order body=${JSON.stringify(roBody)}`).toBe(201);

  // --- Step 4: generate the batch (1 letter document for the customer) ---------
  const genRes = await page.request.post("/api/production/generate", {
    data: {
      name: PROD_OPS.batchName,
      company_id: companyId,
      product_id: productId,
      product: "warranty",
      repair_customer_ids: [customerId],
    },
  });
  const genBody = await genRes.json().catch(() => null);
  expect(genRes.status(), `generate batch body=${JSON.stringify(genBody)}`).toBe(201);
  const gen = genBody as {
    batch: { id: string; status: string; vendor: string; document_count: number };
    documents: number;
    vendor: string;
  };
  const batchId = gen.batch.id;
  expect(batchId).toMatch(UUID_RE);
  expect(gen.documents).toBe(1);
  expect(gen.batch.status).toBe("queued");
  expect(gen.vendor).toBe("lob"); // default vendor — the Lob path is exercised next.

  // The queued batch shows up in the /ops/production print queue.
  await page.goto("/ops/production");
  const batchRow = page.locator("tr").filter({ hasText: PROD_OPS.batchName });
  await expect(page.getByText(PROD_OPS.batchName)).toBeVisible();
  await expect(batchRow.getByRole("button", { name: "Print batch" })).toBeVisible();

  // --- Step 5: print the batch through the Lob TEST API ------------------------
  const printRes = await page.request.post(`/api/production/batches/${batchId}/print`);
  const printBody = await printRes.json().catch(() => null);
  expect(printRes.status(), `print batch body=${JSON.stringify(printBody)}`).toBe(200);
  const { outcome } = (await printRes.json()) as {
    outcome: {
      batchId: string;
      status: string;
      printed: { documentId: string; externalId: string; status: string; vendor: string }[];
    };
  };
  // Batch finalized printing -> historical; one piece handed to the vendor.
  expect(outcome.status).toBe("historical");
  expect(outcome.printed).toHaveLength(1);
  const printed = outcome.printed[0];
  expect(printed.vendor).toBe("lob");
  expect(printed.externalId, "Lob assigned a print id").toBeTruthy();
  expect(printed.status, "vendor returned a status").toBeTruthy();
  const documentId = printed.documentId;
  const externalId = printed.externalId;

  // The production surface now shows the batch under Historical, with the Lob
  // print id surfaced on the document row.
  await page.goto("/ops/production");
  const historical = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Historical" }),
  });
  await expect(historical.getByText(PROD_OPS.batchName)).toBeVisible();
  await expect(page.getByText(externalId)).toBeVisible();

  // --- Step 6: historical search finds the printed piece -----------------------
  // 6a. by Lob print id (external_id) — the exact-lookup access path.
  const byExternal = await page.request.get(
    `/api/production/documents?external_id=${encodeURIComponent(externalId)}`
  );
  expect(byExternal.ok(), "search by external_id").toBeTruthy();
  const externalHits = (await byExternal.json()).documents as {
    id: string;
    batch_id: string;
    company_id: string;
    external_id: string;
  }[];
  expect(externalHits).toHaveLength(1);
  expect(externalHits[0].id).toBe(documentId);
  expect(externalHits[0].batch_id).toBe(batchId);
  expect(externalHits[0].company_id).toBe(companyId);

  // 6b. by company — the broader historical browse path.
  const byCompany = await page.request.get(
    `/api/production/documents?company_id=${companyId}`
  );
  expect(byCompany.ok(), "search by company").toBeTruthy();
  const companyHits = (await byCompany.json()).documents as { id: string }[];
  expect(companyHits.map((d) => d.id)).toContain(documentId);

  // --- Step 7: reprint (re-submit + audited) -----------------------------------
  const reprintRes = await page.request.post(
    `/api/production/documents/${documentId}/reprint`,
    { data: { reason: "Smudged on the first run" } }
  );
  expect(reprintRes.status(), "reprint document").toBe(200);
  const reprinted = (await reprintRes.json()).outcome as { externalId: string; vendor: string };
  expect(reprinted.vendor).toBe("lob");
  expect(reprinted.externalId, "reprint got a fresh Lob print id").toBeTruthy();

  // The reprint wrote the dedicated audit row (who/why) — the v1.3 audit gate.
  const { data: auditRows, error: auditError } = await adminClient()
    .from("production_reprint_log")
    .select("id, document_id, reason, reprinted_by_profile_id")
    .eq("document_id", documentId);
  expect(auditError, auditError?.message).toBeNull();
  expect(auditRows ?? []).toHaveLength(1);
  expect(auditRows?.[0].reason).toBe("Smudged on the first run");
  expect(auditRows?.[0].reprinted_by_profile_id, "audit captured the actor").toBeTruthy();

  // --- House style: a11y + brand screenshots of the Production surface ---------
  await checkA11y(page, "ops-production");
  await shoot(page, "ops-production");
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
