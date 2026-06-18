import { test, expect } from "@playwright/test";
import { OPS_STAFF } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

/**
 * PSG-40 — v1.1 Ops happy path (one E2E per the v1.1 testable bar):
 *
 *   create company -> add employees -> import RO
 *
 * Driven as internal ops staff (psg_superadmin storageState). The Companies
 * vertical (PSG-33) ships a real /ops UI today, so the create-company step is
 * exercised through the browser. The add-employees + import-RO steps run against
 * the real manage_companies-gated API via the authenticated request context: the
 * Employees (PSG-33), Repair Orders (PSG-34) and RO/Estimate Import (PSG-38)
 * UI surfaces are still landing, but their API contracts + RLS are stable. The
 * test therefore covers the full stack TODAY — auth -> ops RBAC gate -> the
 * company/employee/repair-customer/RO data ladder (all FK'd, RO unique per
 * company) -> readback. As PSG-33/34/38 land their UIs, each API leg below can
 * be swapped for the corresponding UI interaction without changing the shape of
 * the happy path.
 */

test.use({ storageState: OPS_STAFF.statePath });

type CreatedRow = { id: string };

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

  // --- Step 3: import RO -----------------------------------------------------
  // An RO requires a repair customer (FK). The import vertical (PSG-38) batches
  // exactly this ladder; here we drive one customer + one RO through the API.
  const customerRes = await page.request.post("/api/repair-customers", {
    data: {
      company_id: companyId,
      first_name: "Alex",
      last_name: "Driver",
      phone: "555-0188",
    },
  });
  expect(customerRes.status(), "create repair customer").toBe(201);
  const { customer } = (await customerRes.json()) as { customer: CreatedRow };

  const roNumber = "RO-1001";
  const roRes = await page.request.post("/api/repair-orders", {
    data: {
      company_id: companyId,
      repair_customer_id: customer.id,
      ro_number: roNumber,
    },
  });
  expect(roRes.status(), "import (create) RO").toBe(201);

  // Readback: the RO is on file for this company.
  const roListRes = await page.request.get(
    `/api/repair-orders?company_id=${companyId}`
  );
  expect(roListRes.ok()).toBeTruthy();
  const { repair_orders } = (await roListRes.json()) as {
    repair_orders: { ro_number: string }[];
  };
  expect(repair_orders.map((r) => r.ro_number)).toContain(roNumber);

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
