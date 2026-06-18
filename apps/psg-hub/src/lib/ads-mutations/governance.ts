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

/**
 * Validate a mutation request against the registry + governance rules.
 * Returns all violations rather than throwing, so the UI can surface them together.
 */
export function validateMutationRequest(req: MutationRequest): GovernanceResult {
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
  if (req.mode === "execute" && requiresSuperadminApproval(def) && !req.approvalId) {
    errors.push(
      `"${def.key}" is high-risk; execute requires superadmin/board approval (approvalId missing).`
    );
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

export function assertMutationAllowed(req: MutationRequest): void {
  const result = validateMutationRequest(req);
  if (!result.ok) {
    throw new GovernanceError(result.errors);
  }
}
