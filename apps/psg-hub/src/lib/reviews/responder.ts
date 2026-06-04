import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  PROMPT_VERSION,
  type ReviewResponseTone,
  buildSystemPrompt,
  buildUserMessage,
} from "./prompts";
import { checkResponseSafety, type SafetyResult } from "./safety";
import type { Review } from "./types";

const MODEL_ID = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 400;
const TIMEOUT_MS = 20_000;

export class TimeoutError extends Error {
  constructor() {
    super("Anthropic request timed out");
    this.name = "TimeoutError";
  }
}

export type DraftResult = {
  body: string;
  modelId: string;
  promptVersion: string;
  usage: { input_tokens: number; output_tokens: number };
  safety: SafetyResult;
};

export async function draftResponse(input: {
  review: Pick<Review, "platform" | "rating" | "body" | "author">;
  shopName: string;
  tone: ReviewResponseTone;
}): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });

  const system = buildSystemPrompt(input.review.platform, input.tone);
  const user = buildUserMessage({
    reviewRating: input.review.rating,
    reviewBody: input.review.body,
    reviewAuthor: input.review.author,
    shopName: input.shopName,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create(
      {
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: user }],
      },
      { signal: controller.signal }
    );
  } catch (err) {
    if (controller.signal.aborted) {
      throw new TimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const body = textBlock && "text" in textBlock ? textBlock.text.trim() : "";

  if (!body) {
    throw new Error("Empty draft from model");
  }

  const safety = checkResponseSafety(body);

  return {
    body,
    modelId: MODEL_ID,
    promptVersion: PROMPT_VERSION,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    safety,
  };
}
