/**
 * v1.2 Ads Mutation Studio — request body shape validation.
 *
 * Zod owns the wire shape (types + presence of structural fields). Semantic rules
 * (target required, high-risk needs approval, required params) live in governance.ts so
 * the UI can surface all violations together. `targetRef` is intentionally NOT min(1)
 * here — governance produces the friendlier "target required" message for that case.
 * `mode` is set by the route (the path decides dry-run vs execute), never the client.
 */
import { z } from "zod";

export const mutationBodySchema = z.object({
  mutationKey: z.string().min(1, "mutationKey is required"),
  targetRef: z.string().default(""),
  params: z.record(z.string(), z.unknown()).default({}),
  shopId: z.string().uuid().optional(),
  approvalId: z.string().min(1).optional(),
});

export type MutationBody = z.infer<typeof mutationBodySchema>;
