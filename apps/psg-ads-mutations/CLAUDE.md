# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo does

Write-side tooling for Google Ads API across PSG-managed client accounts. Reads are handled by the `google-ads-mcp` MCP server; this repo only mutates. After every `--execute` run, verify changes via `mcp__google-ads-mcp__search`.

## Setup

Python 3.11 or 3.12 only — **not 3.14** (SDK wheel mismatch).

```bash
cd apps/ads
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
# fill in .env with credentials
```

If you only have Client ID + Secret (no refresh token yet):

```bash
python -m googleads_psg.auth_bootstrap
```

## Run commands

```bash
# Dry run (safe, default)
python -m ops.wallace.fix_landing_page --customer-id 6048611995

# Actually mutate (writes audit log to logs/)
python -m ops.wallace.fix_landing_page --customer-id 6048611995 --execute

# Run tests
pytest
```

## Architecture

Two authentication patterns coexist:

- **`googleads_psg/client.py`** — `load_client()` reads from `apps/ads/.env` env vars. Used by all `ops/` scripts and the shared mutation library.
- **`ops/flower-hill/google-ads/config/google-ads.yaml`** — yaml config loaded by `ops/flower-hill/google-ads/src/client.py`. That subtree is a standalone campaign builder with its own venv and does not use `googleads_psg`.

The Wallace scripts under `ops/wallace/` (e.g. `fix_conversion_actions.py`, `create_campaigns.py`, `fix_qualify_lead_category.py`) add the repo root to `sys.path` so they work whether invoked as `python -m ops.wallace.<name>` or as direct files. Tedesco scripts under `ops/tedesco/` are pure `-m` modules and rely on the editable install of `googleads_psg`.

### `googleads_psg/` — reusable SDK wrapper

- `client.py` — factory, validates all required env vars on load
- `audit_log.py` — writes `logs/{op}-{customer_id}-{mode}-{timestamp}.json` with before/after state
- `mutations/conversion_actions.py` — `fetch_state()` / `apply_changes()` / dataclasses for conversion action mutations. The key lever is `include_in_conversions_metric`: setting it `False` removes the action from Smart Bidding signal without deleting history.

### `ops/` — one-shot operation scripts

Each script under `ops/{client}/` targets one specific account problem. Pattern: parse `--customer-id` (required) and `--execute` (optional), fetch before-state, print planned changes, mutate if `--execute`, fetch after-state, write audit log.

### `ops/flower-hill/google-ads/src/` — campaign builder

Standalone script that creates full campaign structures (budgets → campaigns → ad groups → keywords → ads → extensions). Campaigns are created **paused**; enable in the UI after QA. Data (customer IDs, ad copy, keywords) lives in `data.py`.

## Non-negotiable safety rules

1. Every mutation script defaults to `--dry-run`. Pass `--execute` to actually hit the API.
2. `--customer-id` is always required; no defaults.
3. Every `--execute` run writes a JSON audit log to `logs/`.
4. Never commit `.env` or `google-ads.yaml` files.
5. `primary_for_goal` and `CustomerConversionGoal` mutations require separate op scripts — the conversion actions module does not handle them.

## Client accounts

| Client | Customer ID |
|--------|-------------|
| Wallace Collision Center | 6048611995 |
| Tedesco Auto Body | 7763526490 |
| Flower Hill Auto Body | see `ops/flower-hill/google-ads/src/data.py` |
