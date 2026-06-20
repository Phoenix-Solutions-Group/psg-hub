// PSG-139 — PSG shop / PSGID registry + resolver (public surface).
//
// Ported from the standalone `import` repo's `src/lib/shops/**`. Structure and
// resolver logic only — the committed `invoiced-customers.json` (PII) is NOT
// brought over; the dataset is loaded at runtime from the live DB or an
// env/secret-backed loader (see `loader.ts`).

export * from "./types";
export { ShopDirectory, buildShopDirectory, buildMSOGroups, EMPTY_SHOP_DIRECTORY } from "./directory";
export {
  resolveShops,
  resolveShopsConstrained,
  autoDetectAndResolve,
} from "./resolver";
export {
  mapInvoicedRow,
  loadShopDirectoryFromDb,
  shopDirectoryFromEnv,
} from "./loader";
export type { InvoicedCustomerRow, ShopDirectoryClient } from "./loader";
