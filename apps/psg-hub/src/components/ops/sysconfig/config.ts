// v1.1 / PSG-37 — SysConfig master-data UI config (client-safe, plain data).
//
// Drives the shared ResourceManager CRUD component and the server page loader
// (lib/ops/sysconfig/page-data.ts) from one place so the list columns, form
// fields, and per-entity table mapping never drift. The per-entity API routes
// under /api/sys-config/<slug> are hand-written (matching the Companies
// vertical) and own server-side zod validation; this config is presentation +
// payload shaping only. Field `key`s are the real column names; `money` fields
// point at the `*_cents` integer columns (the form shows dollars, converts).

export type FieldType = "text" | "textarea" | "money" | "json" | "multiselect";

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  max?: number;
  jsonShape?: "object" | "array";
  /** multiselect: entity slug whose rows populate the options. */
  optionsFrom?: SysConfigSlug;
};

export type ListColumn = { key: string; label: string; type?: "money" };

export type SysConfigSlug =
  | "products"
  | "items"
  | "vehicles"
  | "insurance-companies"
  | "insurance-agents";

export type EntityConfig = {
  slug: SysConfigSlug;
  /** Postgres table name. */
  table: string;
  title: string;
  singular: string;
  blurb: string;
  listColumns: ListColumn[];
  fields: FieldSpec[];
  /** ORDER BY columns (ascending). */
  orderBy: string[];
};

export const SYSCONFIG_ENTITIES: EntityConfig[] = [
  {
    slug: "products",
    table: "products",
    title: "Products",
    singular: "Product",
    blurb: "Program products and descriptions",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "selling_price_cents", label: "Price", type: "money" },
      { key: "total_cost_cents", label: "Cost", type: "money" },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, max: 200 },
      { key: "description", label: "Description", type: "textarea", max: 2000 },
      { key: "selling_price_cents", label: "Selling price", type: "money" },
      { key: "total_cost_cents", label: "Total cost", type: "money" },
      { key: "items_jsonb", label: "Items", type: "json", jsonShape: "array" },
    ],
    orderBy: ["name"],
  },
  {
    slug: "items",
    table: "items",
    title: "Items",
    singular: "Item",
    blurb: "Cost building-blocks composed into products",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "cost_cents", label: "Cost", type: "money" },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, max: 200 },
      { key: "description", label: "Description", type: "textarea", max: 2000 },
      { key: "cost_cents", label: "Cost", type: "money" },
      { key: "requirements_jsonb", label: "Requirements", type: "json", jsonShape: "object" },
    ],
    orderBy: ["name"],
  },
  {
    slug: "vehicles",
    table: "vehicles",
    title: "Vehicles",
    singular: "Vehicle",
    blurb: "Make + model catalog (linked to ROs)",
    listColumns: [
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
    ],
    fields: [
      { key: "make", label: "Make", type: "text", required: true, max: 100 },
      { key: "model", label: "Model", type: "text", required: true, max: 100 },
    ],
    orderBy: ["make", "model"],
  },
  {
    slug: "insurance-companies",
    table: "insurance_companies",
    title: "Insurance Companies",
    singular: "Insurance Company",
    blurb: "Carrier master list",
    listColumns: [{ key: "name", label: "Name" }],
    fields: [{ key: "name", label: "Name", type: "text", required: true, max: 200 }],
    orderBy: ["name"],
  },
  {
    slug: "insurance-agents",
    table: "insurance_agents",
    title: "Insurance Agents",
    singular: "Insurance Agent",
    blurb: "Agents with carrier associations",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true, max: 200 },
      { key: "email", label: "Email", type: "text", max: 200 },
      { key: "phone", label: "Phone", type: "text", max: 40 },
      { key: "mobile", label: "Mobile", type: "text", max: 40 },
      { key: "fax", label: "Fax", type: "text", max: 40 },
      {
        key: "insurance_company_ids",
        label: "Insurance companies",
        type: "multiselect",
        optionsFrom: "insurance-companies",
      },
      { key: "address", label: "Address", type: "json", jsonShape: "object" },
      { key: "contacts_jsonb", label: "Contacts", type: "json", jsonShape: "array" },
    ],
    orderBy: ["name"],
  },
];

export function getEntity(slug: string): EntityConfig | undefined {
  return SYSCONFIG_ENTITIES.find((e) => e.slug === slug);
}

/** Column keys to SELECT for the full edit record (id + every field). */
export function recordSelect(entity: EntityConfig): string {
  const keys = new Set<string>(["id"]);
  for (const f of entity.fields) keys.add(f.key);
  return [...keys].join(", ");
}
