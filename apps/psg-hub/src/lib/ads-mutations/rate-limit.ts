import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * v1.2 Ads Mutation Studio — execute rate-limit.
 *
 * Bounds how many real `execute` runs may hit a single Google Ads customer / GTM
 * container in a window, plus a global ceiling. Mirrors the reviews rate-limit pattern
 * (src/lib/reviews/rate-limit.ts): counts rows in python_worker_jobs via the service
 * client. Dry runs are not limited.
 */
export class MutationRateLimitError extends Error {
  constructor(
    public scope: "per_target_hour" | "global_hour",
    public limit: number,
    public windowMinutes: number
  ) {
    super(
      `Ads mutation rate limit exceeded: ${scope} (${limit} executes per ${windowMinutes} min)`
    );
    this.name = "MutationRateLimitError";
  }
}

const PER_TARGET_LIMIT = 10;
const PER_TARGET_WINDOW_MIN = 60;
const GLOBAL_LIMIT = 50;
const GLOBAL_WINDOW_MIN = 60;

export async function assertWithinMutationLimits(input: {
  targetRef: string;
}): Promise<void> {
  const service = createServiceClient();

  const targetWindowStart = new Date(
    Date.now() - PER_TARGET_WINDOW_MIN * 60 * 1000
  ).toISOString();

  const { count: targetCount, error: targetErr } = await service
    .from("python_worker_jobs")
    .select("id", { count: "exact", head: true })
    .eq("mode", "execute")
    .eq("target_ref", input.targetRef)
    .gte("created_at", targetWindowStart);

  if (targetErr) {
    throw new Error(`ads mutation rate-limit check failed: ${targetErr.message}`);
  }
  if ((targetCount ?? 0) >= PER_TARGET_LIMIT) {
    throw new MutationRateLimitError(
      "per_target_hour",
      PER_TARGET_LIMIT,
      PER_TARGET_WINDOW_MIN
    );
  }

  const globalWindowStart = new Date(
    Date.now() - GLOBAL_WINDOW_MIN * 60 * 1000
  ).toISOString();

  const { count: globalCount, error: globalErr } = await service
    .from("python_worker_jobs")
    .select("id", { count: "exact", head: true })
    .eq("mode", "execute")
    .gte("created_at", globalWindowStart);

  if (globalErr) {
    throw new Error(`ads mutation rate-limit check failed: ${globalErr.message}`);
  }
  if ((globalCount ?? 0) >= GLOBAL_LIMIT) {
    throw new MutationRateLimitError("global_hour", GLOBAL_LIMIT, GLOBAL_WINDOW_MIN);
  }
}
