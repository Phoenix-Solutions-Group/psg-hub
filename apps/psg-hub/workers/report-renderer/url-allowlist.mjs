// Phase 12 — print-URL allowlist for the render worker (SSRF / token-forwarding guard).
//
// The worker attaches the privileged RENDER_TOKEN bearer to whatever URL it navigates.
// A caller-supplied URL with no allowlist let any token holder (or a future internal
// caller) aim the worker — and its bearer — at an attacker-controlled or internal target.
// This module gates navigation to EXACTLY the report print route on the configured app
// origin. The bearer is attached only to a URL that clears this gate.
//
// Dependency-free on purpose: no http/puppeteer imports, so it is importable in isolation
// and smoke-tested without binding a port. The app gains no dependency on this directory.

const PRINT_PATH = /^\/reports\/[^/]+\/print$/;

/**
 * Reject loopback / private / link-local / CGNAT literals. Redundant with the exact-origin
 * check below when REPORT_APP_ORIGIN is a public host, but it backstops a misconfigured
 * origin and makes the SSRF intent explicit.
 */
export function isPrivateHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  if (h.startsWith("fd") || h.startsWith("fc") || h.startsWith("fe80")) return true; // IPv6 ULA / link-local
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true; // this-host / loopback / private
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

/**
 * Validate a caller-supplied print URL against the allowlisted app origin. Returns the
 * parsed URL on success; throws on any mismatch (fail closed). Callers attach the bearer
 * ONLY to the returned URL.
 */
export function assertAllowedPrintUrl(raw, allowedOrigin) {
  if (!allowedOrigin) {
    throw new Error("REPORT_APP_ORIGIN not configured (fail closed)");
  }
  let allowed;
  try {
    allowed = new URL(allowedOrigin);
  } catch {
    throw new Error("REPORT_APP_ORIGIN is not a valid origin");
  }
  if (typeof raw !== "string") {
    throw new Error("url must be a string");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("url is not a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`disallowed protocol: ${url.protocol}`);
  }
  if (url.origin !== allowed.origin) {
    throw new Error(`origin not allowlisted: ${url.origin}`);
  }
  if (!PRINT_PATH.test(url.pathname)) {
    throw new Error(`not a report print route: ${url.pathname}`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error(`disallowed host: ${url.hostname}`);
  }
  return url;
}
