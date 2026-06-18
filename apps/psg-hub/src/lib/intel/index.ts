// v1.6 Internal Agentic Intelligence — multi-LLM router barrel.
// Node-testable surface (router, catalog, types). The live gateway adapter and the
// server-only wiring (G5 gate + logger) are imported directly from their modules by
// server code so this barrel stays free of `ai` / server-only imports.

export * from "./types";
export {
  MODEL_CATALOG,
  DEFAULT_ENABLED_PROVIDERS,
  ALL_PROVIDERS,
} from "./catalog";
export {
  route,
  usableCandidates,
  resetBreakers,
  NoEnabledProviderError,
  AllCandidatesFailedError,
} from "./router";
