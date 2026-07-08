# PSG-889 Graphify and Ponytail Token-Reduction Decision

**Bottom line:** Adopt Graphify as an on-demand repo navigation tool, and adopt Ponytail as a senior-developer review habit. Do not wire either tool into production code or mandatory commit hooks yet.

## Why this matters

BSM (Body Shop Marketer) work is now happening inside the larger `psg-hub` monorepo. Agents can waste tokens by rereading broad areas of code to answer narrow questions. The useful reduction is not inside customer-facing runtime code; it is in developer workflow: find the right files faster, reuse existing patterns, and avoid overbuilding.

## Graphify decision

Adopt for developer workflow.

Graphify builds a local knowledge graph from the repo so an agent can query symbols, files, and relationships before reading full files. The existing PSG runbook already validated it on this repo in PSG-285, and the current local graph contains 10,708 nodes, 16,180 edges, and 694 communities. The graph artifact is intentionally ignored by Git because it is about 25 MB and changes whenever code changes.

Smallest safe integration:

- Keep `docs/runbooks/graphify-codebase-graph.md` as the operating guide.
- Keep `graphify-out/` untracked and rebuilt on demand with `graphify update .`.
- Do not install the Graphify post-commit hook yet. It adds local setup friction and rebuild latency for every commit.
- Do not use Graphify document/image ingestion for PSG customer data unless separately approved. The safe path is code-only local graphing.

Current fit:

- Good fit for BSM/`psg-hub` repo navigation, dependency tracing, and impact checks.
- Not a product feature and not something customers use.
- Current environment risk: the graph exists, but the `graphify` binary is not installed on this agent PATH. The runbook covers reinstalling it in a temporary virtual environment.

## Ponytail decision

Adopt as a senior-developer workflow rule, not as a required repo dependency.

Ponytail is an agent skill/plugin that pushes agents to reuse existing code, standard-library features, native browser controls, and installed dependencies before writing new code. Its own benchmark claims roughly 22% fewer tokens and 54% fewer added lines on feature tasks, with explicit guardrails against cutting validation, security, accessibility, or error handling.

Smallest safe integration:

- Use Ponytail as a review prompt/check for senior developers on non-trivial implementation work.
- Do not install Ponytail hooks globally from this ticket. Global plugin and hook changes are governance actions, and PSG agent instructions already require careful engineering judgment.
- Use the Ponytail review lens before code review: "Did we reuse what exists, avoid new dependencies, and keep the smallest correct implementation?"

Current fit:

- Good fit for BSM because the repo already has many local helpers and established patterns.
- Good fit for UI work where native controls can avoid unnecessary custom components.
- Risk if misused: "write less" can become careless. PSG must keep existing safety rules: tenant isolation, input validation, error handling, accessibility, and tests are not optional.

## Measurement

Added a lightweight local measurement script:

```bash
node scripts/measure-graphify-token-savings.mjs isSuppressed
```

The script reads `graphify-out/graph.json`, builds a compact graph-neighborhood answer for a symbol or term, then compares its estimated token count against reading the full source files behind those same graph hits. It uses a simple `characters / 4` estimate, so it is a repeatable trend check rather than a billing meter.

Current sample result on the existing graph:

| Query | Graph context | Raw files | Estimated reduction |
| --- | ---: | ---: | ---: |
| `isSuppressed` | 322 tokens | 4,441 tokens | 92.7% |
| `template-gate` | 3,829 tokens | 24,658 tokens | 84.5% |

This is enough to show Graphify can reduce repo-reading context for targeted code questions. It does not claim every task will save 70%+; small tasks and already-known code paths may save little.

## Verification

- Read the repo README, app README, package manifests, existing Graphify runbook, and current graph output.
- Checked upstream repository metadata on 2026-07-08:
  - Graphify-Labs/graphify: MIT license, Python, recently pushed 2026-07-08, active repository.
  - DietrichGebert/ponytail: MIT license, JavaScript, recently pushed 2026-07-07, active repository.
- Confirmed no `Reference.md` file exists in this workspace tree during this heartbeat, so this note records the sources used instead.
- Ran the measurement script against `isSuppressed` and `template-gate`.

## Remaining risk

- Graphify is useful only if agents actually query it before broad file reads.
- The current graph was built from an older commit and should be refreshed after meaningful repo changes.
- Ponytail should stay a review discipline until PSG deliberately approves team-wide plugin or hook installation.
