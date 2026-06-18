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
// 16-03 competitor report: pure assembler + types only. The G5-gated narrate factory
// (report/server.ts) is server-only and stays out of this barrel by design.
export * from "./report/types";
export { assembleCompetitorReport, threatTier } from "./report/report-data";
export type {
  NarrativeInput,
  NarrativeGenerator,
  AssembleCompetitorReportDeps,
} from "./report/report-data";
