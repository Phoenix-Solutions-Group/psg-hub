import type { Row } from "@/lib/processing/types";
import type { ExtractionResult } from "./types";
import type { FormSchema } from "./schema";

export interface MergeConflict {
  key: string;
  values: string[];
}

export interface MergeResult {
  row: Row;
  conflicts: MergeConflict[];
}

/**
 * Collapse checkbox groups into a single canonical field.
 * Only declared group->field mappings apply; ungrouped checkboxes pass through.
 */
const GROUP_COLLAPSE: Record<string, { canonicalKey: string; valueMap: Record<string, string> }> = {
  payType: {
    canonicalKey: "ClaimType",
    valueMap: {
      PayType_CustomerPay: "Customer Pay",
      PayType_Claimant: "Claimant",
      PayType_CustomerInsurance: "Customer Insurance",
    },
  },
};

/**
 * Merge per-page extraction results into a single canonical row.
 * Precedence: first non-null value per key wins.
 * Checkbox groups collapse to their canonical field.
 */
export function mergePages(pages: ExtractionResult[], schema: FormSchema): MergeResult {
  const row: Row = {};
  const seen = new Map<string, string[]>();

  // Fields
  for (const page of pages) {
    for (const f of page.fields) {
      if (f.value == null) continue;
      const str = String(f.value).trim();
      if (str === "") continue;
      const existing = seen.get(f.key) ?? [];
      existing.push(str);
      seen.set(f.key, existing);
      if (!(f.key in row)) row[f.key] = str;
    }
  }

  // Checkboxes: track group winners; ungrouped pass through as "1"/"0"
  const groupWinners: Record<string, string> = {};
  for (const page of pages) {
    for (const spec of schema.checkboxes) {
      const v = page.checkboxes[spec.key];
      if (v == null) continue;
      if (spec.group) {
        // First "true" in the group wins; record its canonical collapsed value
        if (v === true && !(spec.group in groupWinners)) {
          const mapping = GROUP_COLLAPSE[spec.group];
          if (mapping) {
            const collapsed = mapping.valueMap[spec.key];
            if (collapsed) groupWinners[spec.group] = collapsed;
          }
        }
      } else {
        if (!(spec.key in row)) row[spec.key] = v ? "1" : "0";
      }
    }
  }

  for (const [group, value] of Object.entries(groupWinners)) {
    const mapping = GROUP_COLLAPSE[group];
    if (!mapping) continue;
    if (!(mapping.canonicalKey in row)) row[mapping.canonicalKey] = value;
  }

  const conflicts: MergeConflict[] = [];
  for (const [k, values] of seen) {
    const unique = [...new Set(values)];
    if (unique.length > 1) conflicts.push({ key: k, values: unique });
  }

  return { row, conflicts };
}
