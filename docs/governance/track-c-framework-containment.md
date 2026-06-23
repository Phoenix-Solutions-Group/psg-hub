# Track C — Framework Containment & Decline Decisions

> **Status:** Authoritative governance record · **Owner:** CTO Ada
> **Parent issue:** PSG-328 (Track C) · **This doc:** PSG-346 (C4)
> **Last updated:** 2026-06-23

## Purpose

Track B evaluated four candidate Claude Code runtime frameworks for company-wide
adoption. Two were cleared for a gated rollout (Skillsmith, Seed); two were **not**
cleared. This document records the **contain** decision for PAUL and the **decline**
decision for Aegis so neither silently spreads beyond its current footprint while the
Track C rollout proceeds.

Single system of record (SoR) for all PSG work tracking, planning, and orchestration
is **Paperclip**. Nothing in this document changes that.

## Verdict summary (Track B → Track C)

| Framework  | Verdict          | Scope after this doc                                   |
| ---------- | ---------------- | ------------------------------------------------------ |
| Skillsmith | ✅ Recommend      | Cleared for gated rollout (Track C, pinned install)    |
| Seed       | ✅ Recommend      | Cleared; its planning output is an **input**, never SoR |
| PAUL       | 🟡 **Contain**   | Project-local in `psg-hub` only; **non-authoritative**  |
| Aegis      | ❌ **Decline**    | Declined as-is; revisit only if hardened (see below)   |

---

## 1. PAUL — Contained (project-local, non-authoritative)

**Decision:** PAUL is **kept project-local to the `psg-hub` repository only.** It is
**declared non-authoritative.** There is **no global / company-wide install**, and no
rollout of PAUL to other repos, agents, or the company skill set.

### Why contain rather than adopt

- PAUL maintains its own roadmap/planning artifacts (`.paul/`, `PLANNING.md`) that
  function as a parallel "source of truth." Company-wide, that **competes directly with
  Paperclip as the system of record** and creates system-of-record drift — the top risk
  flagged in Track C.
- PAUL already exists in `psg-hub` as part of the inherited BSM setup. Ripping it out is
  unnecessary churn; letting it spread is the actual hazard. Containment keeps the
  benefit (its existing in-repo scaffolding) without the risk (a second SoR).
- Single-maintainer dependency (bus factor 1) — acceptable for a contained, single-repo
  convenience; not acceptable as company-wide critical infrastructure.

### What "contained" means in practice

- ✅ PAUL may remain installed and used **inside `psg-hub`** as a local development aid.
- ❌ Do **not** install PAUL globally, as a company skill, or in any other repo/agent.
- ❌ Do **not** treat any PAUL artifact as authoritative for planning, status, or scope.
- ✅ When PAUL planning content is useful, **convert it into Paperclip issues** (use the
  `paperclip-converting-plans-to-tasks` flow). The Paperclip issue is authoritative; the
  PAUL artifact is a draft/input only.

### `.paul/` and `PLANNING.md` — flagged **non-SoR**

The following `psg-hub` artifacts are **non-authoritative inputs**, NOT a system of record:

- `psg-hub/.paul/` (including `.paul/codebase/*`)
- `psg-hub/PLANNING.md`

These files may be read for context and may seed Paperclip issues, but they do **not**
define current scope, status, priority, or ownership. Where any of these disagrees with
Paperclip, **Paperclip wins.** Treat them as snapshots that drift; verify against the
board before acting on them.

> Each of the above files should carry an in-repo banner pointing back to this decision
> (tracked as a follow-up; see "Follow-ups" below).

---

## 2. Aegis — Declined as-is

**Decision:** Aegis is **explicitly declined as-is.** It is not adopted, not installed,
and not rolled out in any scope.

### Why declined

The Aegis installer is **unsafe by construction**:

- **`curl … | bash`** remote-pipe-to-shell installation — executes unreviewed remote code
  with no integrity check.
- **`eval`** of fetched content — arbitrary code execution surface.
- **Unpinned branch** as the install source — the code you get is whatever HEAD happens
  to be at install time; not reproducible, not auditable, trivially mutable upstream.

For a security-relevant tool this is a non-starter. The risk is in the **delivery
mechanism**, independent of whatever the tool does once installed.

### Conditions to revisit

Aegis may be **reconsidered only** if a future version ships with a **hardened installer**
that meets all of the following:

- **Pinned** to an immutable ref (tagged release or commit SHA), not a moving branch.
- **Vendored** (committed into the consuming repo) or installed from a pinned, integrity-
  checked package — no `curl | bash`.
- **No `eval`** of fetched/remote content in the install path.

Absent a release meeting those conditions, Aegis stays declined. Any future revisit is a
**new, separately-gated security review** — this decline does not pre-approve a later
version.

---

## Cross-references

- Parent / rollout gate: **PSG-328** (Track C)
- This decision: **PSG-346** (C4)
- Cleared frameworks (Skillsmith, Seed) roll out under Track C only **after CEO/security
  sign-off**, pinned (npm/local), with no global or `curl | bash` install.

## Follow-ups (non-blocking)

- Add a short "non-SoR — see `docs/governance/track-c-framework-containment.md`" banner to
  `psg-hub/PLANNING.md` and `psg-hub/.paul/` README/codebase docs.
- If/when PAUL is ever removed from `psg-hub`, update this record.
