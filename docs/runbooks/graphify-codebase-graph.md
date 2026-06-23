# Graphify — codebase knowledge graph

**Status:** Installed + validated on `psg-hub` (PSG-285, 2026-06-23). Tool: `graphifyy` CLI (binary name `graphify`), v0.8.45.

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

On our tree the code-only graph is **~10.7k nodes / ~16.2k edges / ~700 communities**,
built in **~18s**.

---

## Install

The graph build needs no API key. Code extraction is deterministic AST work.

**Normal environments — preferred:**
```bash
uv tool install graphifyy        # or: pipx install graphifyy  /  pip install graphifyy
graphify --version
```

**This Paperclip sandbox (no `uv`/`pipx`/system `pip`):** bootstrap pip into a venv first.
```bash
python3 -m venv --without-pip /tmp/graphify-venv
curl -sSL https://bootstrap.pypa.io/get-pip.py | /tmp/graphify-venv/bin/python -
/tmp/graphify-venv/bin/pip install graphifyy
# then call the binary by full path:
/tmp/graphify-venv/bin/graphify --version
```
> ⚠️ The sandbox venv lives in `/tmp` and is **not persistent** across environments/CI.
> Each fresh environment must reinstall (and rebuild the graph). See "Operational notes".

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
Run this after meaningful code changes to keep the graph current (~18s). `graphify update .`
is the offline code-only path; it is what we validated. (The `/graphify .` skill flow can
additionally pull docs/PDFs/images into the graph, but that uses the host agent as the LLM
and is optional — code extraction alone covers our needs.)

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
