const TRUE_TOKENS = new Set<string>(["☑", "☒", "true", "TRUE", "True", "1", "yes", "YES", "Yes", "x", "X"]);
const FALSE_TOKENS = new Set<string>(["☐", "false", "FALSE", "False", "0", "no", "NO", "No", ""]);

/**
 * Normalize a raw model-extracted checkbox value into a strict boolean or null.
 * Returns null for unknown tokens rather than guessing.
 */
export function normalizeCheckbox(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v == null) return null;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }
  const s = String(v).trim();
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return null;
}
