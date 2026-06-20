/**
 * Pure normalization helpers for onboarding discovery (PSG-144).
 *
 * No I/O — deterministic and unit-testable. Shared by every DiscoveryProvider so
 * heuristic and external providers normalize identically.
 */

/** Collapse a name to a url-safe slug (matches the onboarding route's slugify). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalize a US phone number to `(402) 555-1212` display form.
 * Returns null when the input is not a plausible 10-digit (or 1+10) number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return null;
  const area = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const line = digits.slice(6);
  return `(${area}) ${prefix}-${line}`;
}

/** Uppercase 2-letter state code, or null if it isn't one. */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** Trim to a non-empty string or null. */
export function cleanText(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  return s.length > 0 ? s : null;
}

/**
 * Derive a *candidate* website URL from a shop name. This is an inferred guess
 * (the user edits/confirms it) — never treated as verified.
 * Returns null when the name has no usable alphanumerics.
 */
export function inferWebsiteCandidate(name: string): string | null {
  const slug = slugify(name).replace(/-/g, "");
  if (!slug) return null;
  return `https://www.${slug}.com`;
}
