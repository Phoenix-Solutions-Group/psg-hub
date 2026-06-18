# CI — Production happy-path E2E

**Issue:** PSG-54 · **Workflow:** [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) · **Owner:** Ada (Chief Developer)

The `E2E` workflow runs the v1.3 Quality-Gate Playwright suite — including
`apps/psg-hub/e2e/production-happy-path.spec.ts` (PSG-52) — against a throwaway **local**
Supabase stack on the GitHub runner. A green run of the production happy path
(`batch → print → historical → reprint`) is a **hard go-condition for the PSG-44 cutover**.

## What it does

1. Installs deps (pnpm, Node 24) and the Playwright chromium browser.
2. Verifies the `LOB_API_KEY` secret is present and is a `test_*` key (refuses anything else).
3. `supabase start` — boots a local Supabase stack (Docker) and applies `apps/psg-hub/supabase/migrations/*`.
4. Writes `apps/psg-hub/.env.test.local` with the **local** stack URL + keys (remapped from
   `supabase status -o env`), plus the Lob test key. The spec's local-only guard then asserts the
   target is `127.0.0.1` — the zero-PII guarantee.
5. `pnpm --filter psg-hub test:e2e` — builds + starts the app against the local stack, seeds fixtures, runs the suite.

## Zero live spend

The print/reprint legs call the **Lob TEST API only**. CI hard-refuses any key that is not
`test_*`, so it can never incur per-piece Lob spend. The `live_*` key is gated behind board
gate **G4** (PSG-45) and is only ever set in the prod environment — **never** as a CI secret.

## Operator setup (one-time — required for the first green run)

1. **Set the CI secret.** In the GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret**.
   - **Name:** `LOB_API_KEY`  *(exact name — the workflow reads `secrets.LOB_API_KEY`)*
   - **Value:** a Lob **`test_*`** key from the Lob Dashboard → Settings → API Keys.
   - This is a provider-console action (no agent console access); it is escalated to the board on PSG-52.
2. **Land the workflow on the remote.** This workflow file is committed locally; pushing it to
   `Phoenix-Solutions-Group/psg-hub` requires git push credentials (PSG-25, board-pending).
   Once pushed, the workflow runs on every push/PR to `main` and via **Run workflow** (manual dispatch).

After both land, a single green run covering `batch → print → reprint → historical` closes PSG-52
and satisfies the v1.3 Quality-Gate E2E go-condition for PSG-44.

## Triggers

- `push` / `pull_request` to `main`
- `workflow_dispatch` (manual **Run workflow** button)

## Failure triage

The **Upload Playwright artifacts** step publishes `test-results/`, `e2e/screenshots/`, and
`playwright-report/` (when present) on every run for download from the run summary.
