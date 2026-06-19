/**
 * v1.2 Ads Mutation Studio — browser client for the live mutation routes (PSG-26d).
 *
 * Thin, framework-free wrapper over `POST /api/ads-mutations/{dry-run,execute}` that
 * normalizes the route's responses into a single discriminated outcome the Studio UI can
 * render without re-implementing status parsing:
 *
 *   - 200            → { status: "ok", result }              (live before/after diff)
 *   - 503 {gated}    → { status: "gated", message }          (Sandbox off — fail-closed)
 *   - 422            → { status: "invalid", message, detail } (governance/validation)
 *   - 429            → { status: "rate_limited", message }    (execute throttle)
 *   - else / network → { status: "error", message }
 *
 * The route owns `mode` (the path decides dry_run vs execute), so callers never send it.
 * Kept dependency-free + pure-ish (fetch is injectable) so it is unit-testable.
 */
import type { DryRunResult, ExecuteResult } from "./types";

export type LiveMode = "dry-run" | "execute";

export interface LiveRunBody {
  mutationKey: string;
  targetRef: string;
  params: Record<string, unknown>;
  approvalId?: string;
  shopId?: string;
}

export type LiveRunOutcome =
  | { status: "ok"; result: DryRunResult | ExecuteResult }
  | { status: "gated"; message: string }
  | { status: "invalid"; message: string; detail?: unknown }
  | { status: "rate_limited"; message: string }
  | { status: "error"; message: string };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const ENDPOINT: Record<LiveMode, string> = {
  "dry-run": "/api/ads-mutations/dry-run",
  execute: "/api/ads-mutations/execute",
};

/**
 * Run one mutation through its live route and normalize the response. Never throws on an
 * HTTP/JSON error — every failure maps to a `LiveRunOutcome` so the UI stays declarative.
 * `fetchImpl` is injectable for tests; defaults to the global `fetch`.
 */
export async function runMutation(
  mode: LiveMode,
  body: LiveRunBody,
  fetchImpl: FetchLike = fetch
): Promise<LiveRunOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT[mode], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Network error" };
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body (e.g. an upstream 502 HTML page) — fall through to status handling.
  }

  if (res.ok) {
    return { status: "ok", result: json.result as DryRunResult | ExecuteResult };
  }
  if (res.status === 503 && json.gated === true) {
    return { status: "gated", message: asMessage(json.error, "Vercel Sandbox is disabled.") };
  }
  if (res.status === 422) {
    return {
      status: "invalid",
      message: asMessage(json.error, "Request rejected by governance."),
      detail: json.errors ?? json.issues,
    };
  }
  if (res.status === 429) {
    return { status: "rate_limited", message: asMessage(json.error, "Rate limit exceeded.") };
  }
  return { status: "error", message: asMessage(json.error, `Request failed (${res.status}).`) };
}

function asMessage(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
