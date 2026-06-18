import { test, expect } from "@playwright/test";
import { OPS_STAFF } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

/**
 * PSG-40 — v1.1 Ops happy path (one E2E per the v1.1 testable bar):
 *
 *   create company -> add employees -> import RO
 *
 * Driven as internal ops staff (psg_superadmin storageState):
 *   1. create company  — through the real /ops Companies UI (PSG-33).
 *   2. add employees   — manage_companies-gated employees API (PSG-33).
 *   3. import RO        — PSG-38's real import pipeline: upload a CSV to
 *                         /api/ops/import/validate (preview) then
 *                         /api/ops/import/commit, which parses + auto-maps +
 *                         validates server-side and writes the repair_customer
 *                         + repair_order. Read back via the Repair Orders API
 *                         (PSG-34).
 *
 * This covers the full stack — auth -> ops RBAC gate -> company/employee data
 * ladder -> the CSV import pipeline (parse -> map -> validate -> commit, FK'd,
 * RO unique per company, idempotent) -> readback. The API legs share the
 * browser's authenticated context; as the Employees/Import wizard UIs settle
 * they can be swapped for UI interactions without changing the happy path.
 */

test.use({ storageState: OPS_STAFF.statePath });

test("ops happy path: create company -> add employees -> import RO", async ({ page }) => {
  // --- /ops landing: staff sees the Companies & ROs module enabled ----------
  await page.goto("/ops");
  await expect(
    page.getByRole("heading", { name: "Internal Operations" })
  ).toBeVisible();
  // psg_superadmin passes every capability -> the module is a live link, not the
  // disabled "No access" card.
  const companiesModule = page.getByRole("link", { name: /Companies & ROs/ });
  await expect(companiesModule).toBeVisible();

  // --- Step 1: create the company through the Companies UI -------------------
  await page.goto("/ops/companies");
  await expect(
    page.getByRole("heading", { name: "Companies", exact: true })
  ).toBeVisible();

  await page.getByRole("button", { name: "+ New company" }).click();
  await page.getByPlaceholder("Company name").fill(OPS_STAFF.companyName);
  await page.getByPlaceholder("Contact").fill("Pat Owner");
  await page.getByPlaceholder("Phone").fill("555-0142");
  await page.getByRole("button", { name: /^(Create|Save|Add)/ }).click();

  // The server list refreshes (router.refresh) — the new row links to the
  // company detail page, which is our proof the create round-tripped.
  const companyLink = page.getByRole("link", { name: OPS_STAFF.companyName });
  await expect(companyLink).toBeVisible({ timeout: 15_000 });

  // Resolve the company id from the canonical API (q-filtered), not DOM parsing.
  const companyId = await getCompanyId(page, OPS_STAFF.companyName);
  expect(companyId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  );

  // --- Step 2: add employees (manage_companies-gated API) --------------------
  for (const emp of [
    { name: "Jordan Estimator", role: "Estimator", email: "jordan@e2e-co.test" },
    { name: "Sam Manager", role: "Shop Manager", email: "sam@e2e-co.test" },
  ]) {
    const res = await page.request.post(
      `/api/companies/${companyId}/employees`,
      { data: emp }
    );
    expect(res.status(), `create employee ${emp.name}`).toBe(201);
  }

  const employeesRes = await page.request.get(
    `/api/companies/${companyId}/employees`
  );
  expect(employeesRes.ok()).toBeTruthy();
  const { employees } = (await employeesRes.json()) as {
    employees: { name: string }[];
  };
  expect(employees.map((e) => e.name).sort()).toEqual([
    "Jordan Estimator",
    "Sam Manager",
  ]);

  // --- Step 3: import RO via the PSG-38 import pipeline -----------------------
  // Upload a CSV whose headers hit the canonical aliases, so the server
  // auto-suggests the mapping (no template needed) and creates the repair
  // customer + RO from the row. Two rows -> two ROs imported.
  const roNumber = "RO-2001";
  const csv =
    "First Name,Last Name,RO #,Phone,Make,Model\n" +
    `Alex,Driver,${roNumber},555-0188,Honda,Civic\n` +
    "Robin,Payne,RO-2002,555-0190,Toyota,Camry\n";
  const csvFile = {
    name: "ros.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  };

  // 3a. Validate/preview — no DB writes; both rows map cleanly, none unmapped.
  const validateRes = await page.request.post("/api/ops/import/validate", {
    multipart: { file: csvFile, kind: "ro", company_id: companyId },
  });
  expect(validateRes.ok(), "import validate").toBeTruthy();
  const preview = (await validateRes.json()) as {
    mapping: Record<string, string>;
    validation: { total: number; invalid: number; unmappedRequired: string[] };
  };
  expect(preview.mapping.ro_number).toBe("RO #");
  expect(preview.validation.unmappedRequired).toEqual([]);
  expect(preview.validation.invalid).toBe(0);
  expect(preview.validation.total).toBe(2);

  // 3b. Commit — server re-parses + re-validates, then writes customers + ROs.
  const commitRes = await page.request.post("/api/ops/import/commit", {
    multipart: { file: csvFile, kind: "ro", company_id: companyId },
  });
  expect(commitRes.ok(), "import commit").toBeTruthy();
  const committed = (await commitRes.json()) as {
    inserted: number;
    skipped: number;
    failedRows: { index: number; error: string }[];
  };
  expect(committed.failedRows).toEqual([]);
  expect(committed.inserted).toBe(2);

  // Readback: the imported ROs are on file for this company.
  const roListRes = await page.request.get(
    `/api/repair-orders?company_id=${companyId}`
  );
  expect(roListRes.ok()).toBeTruthy();
  const { repair_orders } = (await roListRes.json()) as {
    repair_orders: { ro_number: string }[];
  };
  const importedRoNumbers = repair_orders.map((r) => r.ro_number);
  expect(importedRoNumbers).toContain(roNumber);
  expect(importedRoNumbers).toContain("RO-2002");

  // --- House style: a11y + brand screenshots of the Companies surface --------
  await page.goto("/ops/companies");
  await expect(page.getByRole("link", { name: OPS_STAFF.companyName })).toBeVisible();
  await checkA11y(page, "ops-companies");
  await shoot(page, "ops-companies");
});

/** q-filtered lookup of the company id via the manage_companies-gated list API. */
async function getCompanyId(
  page: import("@playwright/test").Page,
  name: string
): Promise<string> {
  const res = await page.request.get(
    `/api/companies?q=${encodeURIComponent(name)}`
  );
  expect(res.ok(), "list companies").toBeTruthy();
  const { companies } = (await res.json()) as {
    companies: { id: string; name: string }[];
  };
  const match = companies.find((c) => c.name === name);
  if (!match) throw new Error(`[e2e] company "${name}" not found after create`);
  return match.id;
}
