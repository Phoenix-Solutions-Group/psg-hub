// Wave 1A / PSG-236 — Shared LLM seam for the live sitemap providers.
//
// The content-gap and cluster-refiner providers both need ONE structured LLM call.
// Rather than each provider reaching into the intel router (and so coupling this pure
// module to `server-only` + the gateway), they take this injected `StructuredCompletion`
// seam. The live route builds it from the intel multi-LLM router:
//
//   const complete = makeRouterCompletion({ profile: "reasoning", deps });
//   // internally: const r = await route(profile, { system, prompt, schema }, deps);
//   //             return r.output;  // null when no provider / spend-cap / G5-gated
//
// So budget-/G5-gating lives in the route exactly like the intel report does — these
// providers stay pure + node-testable and degrade to empty output when `complete`
// returns null.

import type { z } from "zod";

/**
 * One structured LLM completion. Returns the validated object, or `null` when the
 * call could not be served (no enabled provider pre-G5, spend cap hit, all candidates
 * failed). Providers MUST treat `null` as "skip this enrichment", never as an error.
 */
export type StructuredCompletion = <T>(args: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}) => Promise<T | null>;
