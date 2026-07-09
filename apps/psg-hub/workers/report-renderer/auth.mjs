import { timingSafeEqual } from "node:crypto";

export function normalizeRenderToken(raw) {
  const trimmed = String(raw).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function extractBearerToken(raw) {
  const trimmed = String(raw).trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  return normalizeRenderToken(trimmed.slice(7));
}

export function authorizedBearer(header, token) {
  const normalizedToken = normalizeRenderToken(token ?? "");
  if (!normalizedToken) return false;
  const provided = extractBearerToken(header ?? "");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(normalizedToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
