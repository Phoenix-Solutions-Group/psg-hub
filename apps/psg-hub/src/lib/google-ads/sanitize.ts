import "server-only";

const MAX_LEN = 500;
const LONG_DIGITS_RE = /\d{7,}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function sanitizeLastError(raw: string | null | undefined): string {
  if (!raw) return "";
  let out = raw.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  out = out.replace(LONG_DIGITS_RE, "[REDACTED_ID]");
  if (out.length > MAX_LEN) {
    out = out.slice(0, MAX_LEN);
  }
  return out;
}
