import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { OPS_STAFF, SHOTS_DIR } from "./fixtures";

test.use({ storageState: OPS_STAFF.statePath });

const DEMO_COMPANY = "Collision Leaders of Derby";
const DEMO_BATCH = "Phase 5 Collision Leaders postcard test";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test("Phase 5 demo postcard: Collision Leaders of Derby -> Lob test proof", async ({
  page,
}) => {
  const admin = adminClient();

  const { data: existingCompanies } = await admin
    .from("companies")
    .select("id")
    .eq("name", DEMO_COMPANY);
  for (const company of existingCompanies ?? []) {
    await admin.from("production_batches").delete().eq("company_id", company.id);
    await admin.from("companies").delete().eq("id", company.id);
  }

  const { data: actor, error: actorError } = await admin
    .from("profiles")
    .select("id")
    .eq("display_name", "E2E Ops Staff")
    .single();
  expect(actorError, actorError?.message).toBeNull();
  expect(actor?.id, "E2E ops profile id").toBeTruthy();

  const { data: company, error: companyError } = await admin
    .from("companies")
    .insert({
      name: DEMO_COMPANY,
      contact: "Demo Operator",
      phone: "555-0100",
      address: {
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
    })
    .select("id")
    .single();
  expect(companyError, companyError?.message).toBeNull();
  expect(company?.id).toBeTruthy();

  const { data: customer, error: customerError } = await admin
    .from("repair_customers")
    .insert({
      company_id: company!.id,
      first_name: "Collision Leaders",
      last_name: "of Derby",
      phone: "555-0199",
      email: "collision-leaders-demo@e2e.test",
      address: {
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
    })
    .select("id")
    .single();
  expect(customerError, customerError?.message).toBeNull();
  expect(customer?.id).toBeTruthy();

  const { data: batch, error: batchError } = await admin
    .from("production_batches")
    .insert({
      name: DEMO_BATCH,
      company_id: company!.id,
      status: "queued",
      vendor: "lob",
      document_count: 1,
      created_by_profile_id: actor!.id,
    })
    .select("id")
    .single();
  expect(batchError, batchError?.message).toBeNull();
  expect(batch?.id).toBeTruthy();

  const postcardHtml = `
    <html>
      <body style="margin:0; width:6in; height:4in; font-family:Arial, sans-serif;">
        <section style="padding:0.5in; color:#1E3A52;">
          <h1 style="font-size:28px; margin:0 0 18px;">Collision Leaders of Derby</h1>
          <p style="font-size:16px; line-height:1.45; max-width:4.5in;">
            Phase 5 Mail-Artwork Studio test postcard. Lob test mode only; no live mail.
          </p>
          <p style="font-size:12px; margin-top:0.6in;">Phoenix Solutions Group proof run</p>
        </section>
      </body>
    </html>`;

  const { data: document, error: documentError } = await admin
    .from("production_documents")
    .insert({
      batch_id: batch!.id,
      company_id: company!.id,
      repair_customer_id: customer!.id,
      piece_type: "postcard",
      status: "rendered",
      vendor: "lob",
      size: "4x6",
      rendered_url: postcardHtml,
      to_address: {
        name: "Collision Leaders of Derby",
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
      from_address: {
        name: "Phoenix Solutions Group",
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
    })
    .select("id")
    .single();
  expect(documentError, documentError?.message).toBeNull();
  expect(document?.id).toBeTruthy();

  const printRes = await page.request.post(`/api/production/documents/${document!.id}/print`);
  const printBody = await printRes.json().catch(() => null);
  expect(printRes.status(), `print postcard body=${JSON.stringify(printBody)}`).toBe(200);
  expect(printBody.outcome.externalId).toMatch(/^psc_/);
  expect(printBody.outcome.vendor).toBe("lob");

  const { data: printed, error: printedError } = await admin
    .from("production_documents")
    .select("external_id, proof_url, status")
    .eq("id", document!.id)
    .single();
  expect(printedError, printedError?.message).toBeNull();
  expect(printed?.external_id).toBe(printBody.outcome.externalId);
  expect(printed?.proof_url, "Lob proof URL").toMatch(/^https?:\/\//);

  const artifactDir = path.join(SHOTS_DIR, "psg-1149");
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, "phase5-postcard-proof.json");
  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        company: DEMO_COMPANY,
        mode: "lob_test",
        externalId: printed!.external_id,
        proofUrl: printed!.proof_url,
        status: printed!.status,
      },
      null,
      2
    )
  );
  await test.info().attach("phase5-postcard-proof", {
    path: artifactPath,
    contentType: "application/json",
  });
});
