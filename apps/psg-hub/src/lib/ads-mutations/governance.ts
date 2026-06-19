/**
 * v1.2 Ads Mutation Studio — safety / governance.
 *
 * Pure, dependency-free request validation so it is trivially unit-testable and runs
 * before any bridge call. The DB-backed rate-limit lives in `rate-limit.ts` (server-only).
 *
 * Controls (PSG-26 scope):
 *   - target (customer-id / container-id) is REQUIRED on every mutation
 *   - high-risk mutations require a superadmin/board approval ref before `execute`
 *   - declared required params must be present
 */
import { getMutation, requiresSuperadminApproval } from "./registry";
import type { MutationRequest } from "./types";

export interface GovernanceResult {
  ok: boolean;
  errors: string[];
}

export interface GovernanceOptions {
  /**
   * Operator/board-controlled allowlist of accepted board-confirmation UUIDs (PSG-126).
   * Sourced from an env var the in-UI superadmin cannot edit, so it is a real
   * cross-principal authorization check (not the circular "superadmin approves
   * superadmin"). When provided AND non-empty, a high-risk `execute` approvalId must
   * resolve to a member of this list; otherwise the request is rejected. When omitted
   * or empty, only the UUID-shape gate applies (the demonstrated free-text hole stays
   * closed, but full resolution is off until the board configures the allowlist).
   */
  approvalAllowlist?: string[];
}

/** RFC-4122 UUID shape (8-4-4-4-12 hex). Rejects free-text refs like "board-card-8b576490". */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a well-formed UUID. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Parse an operator-controlled allowlist env value into accepted approval UUIDs.
 * Accepts comma/whitespace/newline separated refs; drops blanks and non-UUIDs so a
 * malformed env entry can never silently authorize a malformed approvalId.
 */
export function parseApprovalAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && isUuid(s));
}

/**
 * Validate a mutation request against the registry + governance rules.
 * Returns all violations rather than throwing, so the UI can surface them together.
 */
export function validateMutationRequest(
  req: MutationRequest,
  opts: GovernanceOptions = {}
): GovernanceResult {
  const errors: string[] = [];

  const def = getMutation(req.mutationKey);
  if (!def) {
    return { ok: false, errors: [`Unknown mutation key: ${req.mutationKey}`] };
  }

  if (req.mode !== "dry_run" && req.mode !== "execute") {
    errors.push(`Invalid mode: ${String(req.mode)}`);
  }

  // Governance: target is always required.
  if (!req.targetRef || req.targetRef.trim() === "") {
    errors.push(
      `Target required (${def.target.kind}); refusing to run "${def.key}" without it.`
    );
  }

  // Governance: high-risk execute needs an approval ref.
  if (req.mode === "execute" && requiresSuperadminApproval(def)) {
    const approvalId = req.approvalId?.trim() ?? "";
    if (!approvalId) {
      errors.push(
        `"${def.key}" is high-risk; execute requires superadmin/board approval (approvalId missing).`
      );
    } else if (!isUuid(approvalId)) {
      // PSG-126: reject free-text refs (e.g. "board-card-8b576490"). A real board
      // confirmation is a UUID; arbitrary text must never pass the audit gate.
      errors.push(
        `"${def.key}" execute approvalId must be a board-confirmation UUID, not free text.`
      );
    } else {
      // PSG-126: when the board has configured the accepted-approval allowlist, the
      // approvalId must resolve to a real accepted board confirmation (fail-closed).
      const allowlist = opts.approvalAllowlist ?? [];
      if (allowlist.length > 0 && !allowlist.includes(approvalId.toLowerCase())) {
        errors.push(
          `"${def.key}" execute approvalId does not match an accepted board confirmation.`
        );
      }
    }
  }

  // Declared required params must be present (dry runs included, so the preview is real).
  for (const p of def.params) {
    if (p.required && req.params?.[p.name] === undefined) {
      errors.push(`Missing required param "${p.name}" for "${def.key}".`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Throwing wrapper for route handlers that prefer fail-fast. */
export class GovernanceError extends Error {
  constructor(public errors: string[]) {
    super(`Ads mutation governance failed: ${errors.join("; ")}`);
    this.name = "GovernanceError";
  }
}

export function assertMutationAllowed(
  req: MutationRequest,
  opts: GovernanceOptions = {}
): void {
  const result = validateMutationRequest(req, opts);
  if (!result.ok) {
    throw new GovernanceError(result.errors);
  }
}
