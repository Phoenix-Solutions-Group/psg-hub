/**
 * W1 master-template render check (PSG-115a / PSG-308).
 *
 * Renders the two proof-gate-approved (A / A) W1 masters through the REAL print
 * engine on the spec's sample shop ("ABC Auto Body" / owner Steve Smith) and
 * writes browser-openable proofs next to this script:
 *
 *   thankyou-survey-letter-faithful-rendered.html
 *   owner-service-recovery-rendered.html
 *
 * The .ts source-of-truth is `src/lib/production/templates.ts` (DEFAULT_TEMPLATES);
 * these rendered files are derived, for human / QA visual review only. Run with:
 *
 *   pnpm --filter psg-hub exec tsx templates/render-check.ts
 *
 * The same render is asserted (zero unresolved tokens) in
 * src/lib/production/__tests__/w1-master-templates.test.ts — that test, not this
 * script, is the CI gate.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  defaultTemplate,
  renderMailContent,
  type MailMergeData,
} from "../src/lib/production/templates";

const here = dirname(fileURLToPath(import.meta.url));

/** Sample shop / owner from the spec, with every W1 skin + per-recipient field. */
const ABC: MailMergeData = {
  customer: {
    firstName: "Dana",
    lastName: "Whitfield",
    vehicle: "2022 Toyota Camry",
    vehicleShort: "Camry",
    serviceDate: "2026-06-10",
    letterDate: "June 2026",
    addressLine1: "118 Maple Avenue",
    city: "Springfield",
    state: "IL",
    zip: "62704",
    surveySecurityCode: "ABC-7731",
    surveyId: "SID-44120",
    roNumber: "RO-55120",
  },
  company: {
    name: "ABC Auto Body",
    phone: "(217) 555-0140",
    email: "service@abcautobody.example",
    websiteUrl: "abcautobody.example",
    city: "Springfield",
    state: "IL",
  },
  program: {
    logo: "https://cdn.example/abc-auto-body.png",
    addressLine1: "2300 N. Barrington Rd",
    addressLine2: "Springfield, IL 62704",
    ownerName: "Steve Smith",
    ownerFirstName: "Steve",
    ownerTitle: "Owner",
    ownerSignatureUrl: "https://cdn.example/steve-smith-sig.png",
    ownerDirectLine: "(217) 555-0199",
    surveyUrl: "www.theacrb.com",
    tagline: "We keep our customers by keeping our customers satisfied",
    pieceCode: "PS682",
    jobNumber: "5512.07",
    hasWarranty: "true",
  },
};

const proofs: { product: "thank_you" | "service_recovery"; file: string }[] = [
  { product: "thank_you", file: "thankyou-survey-letter-faithful-rendered.html" },
  { product: "service_recovery", file: "owner-service-recovery-rendered.html" },
];

let failed = false;
for (const { product, file } of proofs) {
  const out = renderMailContent(defaultTemplate(product), ABC);
  const path = join(here, file);
  writeFileSync(path, out.file ?? "", "utf8");
  const status = out.missing.length === 0 ? "OK (0 unresolved)" : `MISSING: ${out.missing.join(", ")}`;
  if (out.missing.length) failed = true;
  console.log(`${product.padEnd(16)} → ${file}  [${status}]`);
}

if (failed) {
  console.error("\nOne or more templates left unresolved tokens on the sample data.");
  process.exit(1);
}
console.log("\nAll W1 master templates rendered clean on the ABC Auto Body sample.");
