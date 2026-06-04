import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export type LLMCallResult =
  | "success"
  | "error"
  | "timeout"
  | "rate_limited"
  | "safety_blocked";

export type LLMCallLogEntry = {
  userId: string | null;
  shopId: string | null;
  reviewId: string | null;
  purpose: string;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  result: LLMCallResult;
  errorCode?: string | null;
};

export async function logLLMCall(entry: LLMCallLogEntry): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service.from("llm_call_log").insert({
      user_id: entry.userId,
      shop_id: entry.shopId,
      review_id: entry.reviewId,
      purpose: entry.purpose,
      model_id: entry.modelId ?? null,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      latency_ms: entry.latencyMs ?? null,
      result: entry.result,
      error_code: entry.errorCode ?? null,
    });
    if (error) {
      // Never throw — logging must not break the caller.
      console.error("[llm-call-log] insert failed:", error.message);
    }
  } catch (err) {
    console.error("[llm-call-log] unexpected:", err);
  }
}
