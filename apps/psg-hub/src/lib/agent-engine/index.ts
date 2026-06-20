// BSM Phase 0 / PSG-153 — Agent-engine cross-module contract.
//
// Public surface for the peer-invocation layer of the four BSM agents. The
// Claude Code agent skills (SEO auditor, market researcher, content writer) and
// the app both import from here. Data contracts are live; the synthesis/handoff
// functions are seams implemented by the PSG-153 child issues.

export * from "./types";
export { synthesizeContentBrief, type SynthesizeBriefOptions } from "./market-researcher";
export { selectKeywordTargets, type SelectKeywordTargetsOptions } from "./seo-auditor";
export { buildContentDraftRequest } from "./content-writer-handoff";
