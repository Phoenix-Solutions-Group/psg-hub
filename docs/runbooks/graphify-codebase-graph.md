# Graphify — codebase knowledge graph

**Status:** Installed + validated on `psg-hub` (PSG-285, 2026-06-23; re-verified for Ada's BSM rollout in PSG-896 on 2026-07-08). Tool: `graphifyy` CLI (binary name `graphify`), v0.9.10.

Graphify turns the repo into a queryable knowledge graph via tree-sitter AST extraction
(**fully offline — no API keys**). Use it to orient on the codebase and answer
"where / what calls what / how does X flow" questions **before** grepping or re-reading
files, which saves tokens and avoids missing call sites.

It produces three artifacts in `graphify-out/` (gitignored — see below):

| File | What it is |
|---|---|
| `graph.json` | The queryable graph (nodes = files/symbols, edges = contains/imports/calls). GraphRAG-ready. |
| `GRAPH_REPORT.md` | Plain-language architecture report (communities, god nodes). |
| `graph.html` / `GRAPH_TREE.html` | Interactive force-directed viz / D3 collapsible tree. |

On our current tree the code-only graph is **~12.7k nodes / ~21.9k edges / ~762 communities**.

---

## Install

The graph build needs no API key. Code extraction is deterministic AST work.

**Normal environments — preferred:**
```bash
uv tool install graphifyy        # or: pipx install graphifyy  /  pip install graphifyy
graphify --version
```

**PSG agent environments — persistent path:** use the shared company Codex-home virtual
environment so fresh Ada/Ravi/Nora/Tess sessions can reuse one install instead of rebuilding
from `/tmp` every time.
```bash
GRAPHIFY_VENV=/paperclip/instances/default/companies/a38dde7c-f8ee-4901-804d-bf1d6887dbf0/codex-home/tools/graphify-venv
python3 -m venv --without-pip "$GRAPHIFY_VENV"
curl -sSL https://bootstrap.pypa.io/get-pip.py | "$GRAPHIFY_VENV/bin/python" -
"$GRAPHIFY_VENV/bin/pip" install --upgrade graphifyy
"$GRAPHIFY_VENV/bin/graphify" --version
```
If `graphify` is not on `PATH`, call the binary by full path:
`/paperclip/instances/default/companies/a38dde7c-f8ee-4901-804d-bf1d6887dbf0/codex-home/tools/graphify-venv/bin/graphify`.

**Fallback Paperclip sandbox path (not persistent):** bootstrap pip into a venv first.
```bash
python3 -m venv --without-pip /tmp/graphify-venv
curl -sSL https://bootstrap.pypa.io/get-pip.py | /tmp/graphify-venv/bin/python -
/tmp/graphify-venv/bin/pip install graphifyy
# then call the binary by full path:
/tmp/graphify-venv/bin/graphify --version
```
> ⚠️ The `/tmp` sandbox venv is **not persistent** across environments/CI. Prefer the PSG
> agent environment path above when working as Ada, Ravi, Nora, or Tess.

**Register the Claude Code skill** (so `/graphify` is available; writes to the gitignored
`.claude/`, so it is local per-environment, not shared via git):
```bash
graphify install --project --platform claude
```
We intentionally do **not** use the bare `graphify claude install` variant — it adds
`PreToolUse` hooks that nag on every grep/read and point at the local binary path.

---

## Build / refresh the graph (offline)

```bash
graphify update .          # AST re-extract + cluster + report + html. No LLM, no API key.
```
Run this before broad repo-reading and after meaningful code changes to keep the graph current
(~18s). `graphify update .`
is the offline code-only path; it is what we validated. (The `/graphify .` skill flow can
additionally pull docs/PDFs/images into the graph, but that uses the host agent as the LLM
and is optional — code extraction alone covers our needs.)

For BSM agents, document/image ingestion stays off unless Steve separately approves it. Do not
send customer files, customer documents, images, screenshots, or production data through
Graphify ingestion; use local source-code graphing only.

The HTML viz has a 5000-node default cap; our graph exceeds it, so generate the viz with:
```bash
GRAPHIFY_VIZ_NODE_LIMIT=20000 graphify cluster-only . --no-label   # writes graph.html
GRAPHIFY_VIZ_NODE_LIMIT=20000 graphify tree --label psg-hub        # lighter GRAPH_TREE.html
```

## Query the graph (this is the point)

```bash
graphify explain "isSuppressed"                 # a symbol + its neighbors, with file:line
graphify query "how does mail suppression skip a recipient"   # BFS subgraph for a question
graphify query "..." --budget 1500              # cap output tokens
graphify path "isSuppressed" "createServiceClient"   # shortest path between two symbols
graphify affected "householdKey"                # reverse traversal: what breaks if I change X
```
All read `graphify-out/graph.json` by default. Example verified on our tree:
`graphify explain "isSuppressed"` → `apps/psg-hub/src/lib/ops/mail/suppression.ts:154`
with correct `calls`/`imports` edges.

---

## BSM agent rollout rule

Ada, Ravi, Nora, and Tess must use Graphify before broad BSM repo reading when the task involves code navigation, dependency tracing, impact analysis, or finding existing patterns. No BSM senior engineering or QA agent is excluded.

Use Graphify first, then open the targeted files it identifies. This keeps BSM agents from spending large context windows rereading unrelated repo areas.

Current Paperclip sandbox note: `graphify` may not be on the normal PATH. In that case, run the CLI by full path:

```bash
/tmp/graphify-venv/bin/graphify explain "isSuppressed"
/tmp/graphify-venv/bin/graphify query "how does mail suppression skip a recipient" --budget 1500
```

PSG-897 verification on 2026-07-08:

- `/tmp/graphify-venv/bin/graphify --version` returned `graphify 0.8.45`.
- `/tmp/graphify-venv/bin/graphify explain "isSuppressed"` returned `apps/psg-hub/src/lib/ops/mail/suppression.ts L154` with call/import relationships.
- `node scripts/measure-graphify-token-savings.mjs isSuppressed` estimated 322 graph-context tokens versus 4,441 raw-file tokens, a 92.7% reduction for that lookup.

---

## Decisions for this repo (PSG-285)

- **`graphify-out/` is gitignored** (`.gitignore` — "graphify knowledge-graph output").
  We do **not** commit it: `graph.json` is ~9.2MB, regenerates in ~18s, and churns on every
  code change — committing it would bloat history for zero durable value. Rebuild locally
  with `graphify update .`.
- **No commit hook.** We did **not** run `graphify hook install`. Rationale: outputs are
  gitignored (so a post-commit rebuild is purely local), the binary isn't on a stable PATH
  for all agents/CI, and it adds latency to every commit/checkout. Rebuild on demand instead.
- **Skill registration is local** (`.claude/` is gitignored). Each environment that wants
  `/graphify` runs `graphify install --project --platform claude` after installing the CLI.

## Operational notes / limitations

- Because both the CLI install (`/tmp` venv) and the graph output (gitignored) are
  **per-environment**, graphify is currently a *local productivity tool*, not shared repo
  infrastructure. To make it shared/zero-setup we'd need either (a) a persistent CLI install
  baked into the agent image, or (b) a tracked build step. That is a board/parent
  (PSG-284) call, not a code change — flag it there if team-wide adoption is wanted.
- Doc/PDF/image extraction needs a model backend (`GEMINI_API_KEY`/`GOOGLE_API_KEY`) or the
  host-agent skill flow. We keep that **off** — no keys wired, code-only graph.
