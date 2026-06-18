// v1.6 / 16-01 — Model catalog + provider gating for the multi-LLM router.
// Each task profile maps to an ORDERED candidate chain. Order is the preference/fallback
// order the router walks: try the first usable candidate, fall to the next on failure.
// The router filters this chain by the enabled-provider allowlist, so non-Anthropic
// (G5-gated) candidates are simply skipped until the gate clears.

import type { ModelSpec, Provider, TaskProfile } from "./types";

// Anthropic gateway slugs are the same ones already live in the customer report
// (report/narrative.ts) and review sentiment (reviews/sentiment.ts): dot notation.
const OPUS = "anthropic/claude-opus-4.8";
const SONNET = "anthropic/claude-sonnet-4.6";
const HAIKU = "anthropic/claude-haiku-4.5";

// NON-ANTHROPIC SLUGS ARE PROVISIONAL (activation-pending).
// These providers are off by default (G5 gate). The exact gateway model ids MUST be
// verified against the live AI Gateway model list at G5 activation before enabling them.
// Until then they are never dispatched, so a stale slug here cannot cause a live failure.
const GPT = "openai/gpt-5.1"; // provisional — verify at G5 activation
const GEMINI_PRO = "google/gemini-3-pro"; // provisional — verify at G5 activation
const GEMINI_FLASH = "google/gemini-3-flash"; // provisional — verify at G5 activation
const SONAR = "perplexity/sonar-pro"; // provisional — verify at G5 activation

/**
 * Capability-first ordering. A same-family Anthropic candidate is appended to every
 * profile so the router always has an in-budget fallback that works build-local with no
 * G5 spend. The grounded profile's Anthropic tail is an UNGROUNDED degrade — acceptable
 * for build-local; live grounding lights up with Perplexity at G5.
 */
export const MODEL_CATALOG: Record<TaskProfile, ModelSpec[]> = {
  reasoning: [
    { provider: "anthropic", model: OPUS, costTier: 4 },
    { provider: "openai", model: GPT, costTier: 4 },
    { provider: "google", model: GEMINI_PRO, costTier: 3 },
    { provider: "anthropic", model: SONNET, costTier: 2 },
  ],
  writer: [
    { provider: "anthropic", model: SONNET, costTier: 2 },
    { provider: "anthropic", model: OPUS, costTier: 4 },
  ],
  fast_classify: [
    { provider: "anthropic", model: HAIKU, costTier: 1 },
    { provider: "google", model: GEMINI_FLASH, costTier: 1 },
  ],
  web_grounded: [
    { provider: "perplexity", model: SONAR, costTier: 3, grounded: true },
    { provider: "google", model: GEMINI_PRO, costTier: 3, grounded: true },
    { provider: "anthropic", model: SONNET, costTier: 2 },
  ],
};

/**
 * Providers allowed to run by default. Anthropic only: it uses the existing in-budget
 * gateway binding (the customer report already spends here). Everything else waits on
 * board approval G5. The server adapter widens this from an env allowlist once G5 clears.
 */
export const DEFAULT_ENABLED_PROVIDERS: readonly Provider[] = ["anthropic"];

/** All providers referenced by the catalog (handy for activation checks/docs). */
export const ALL_PROVIDERS: readonly Provider[] = Array.from(
  new Set(Object.values(MODEL_CATALOG).flatMap((chain) => chain.map((m) => m.provider))),
);
