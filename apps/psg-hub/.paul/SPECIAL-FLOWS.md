# SPECIAL-FLOWS — psg-hub

Project-specific required flows. PAUL reads this during `/paul:plan` (to populate a plan's
skills/flows section) and `/paul:unify` (to audit). Required flows BLOCK or must be confirmed
before the work proceeds.

## Research-first (REQUIRED, every phase and every plan)

**Rule (operator, 2026-06-08 — hard gate):** No `/paul:plan` for a phase without phase-level
research, and no plan authored without confirming research covers it.

| Flow | Priority | When | Output |
|------|----------|------|--------|
| `/paul:research-phase` (or an ultracode research Workflow) | **required** | Before `/paul:plan` for any new phase | `RESEARCH.md` in the phase dir |
| Per-plan research check | **required** | Before authoring each plan | Confirm `RESEARCH.md` covers the plan; if the plan opens a NEW external API/library surface, do a focused research pass first |

**Mandate:**
- For any phase that touches an external API or library contract, use the **ultracode multi-agent
  research Workflow** (parallel finders over Context7 + official docs + the inherited codebase →
  adversarial validate → synthesize), not a single pass.
- Treat "blind-built / never run against the real thing" as a red flag requiring real-contract
  verification (the Phase-10 / 10-01 AC-2 pattern: a real-client round-trip, not mocked tests).

**Why:** Phase 10 / 10-01 shipped a token-corruption bug because the inherited Google Ads code was
built blind, never validated against the live API/DB. Phases 6 and 9 ran research and went cleaner.
This gate exists to stop blind-building.

**Coverage status (v0.3 Customer Analytics):**
- Phase 6 — RESEARCH dossier ✅
- Phase 9 — RESEARCH.md ✅
- Phase 10 — RESEARCH.md ✅ (ultracode Workflow `wf_a78f4fd7-d6b`, 2026-06-08; 19 agents, adversarially validated; feeds 10-02 + 10-03). **10-01 was planned from code-grounding before this gate; retro-covered by this research.**
