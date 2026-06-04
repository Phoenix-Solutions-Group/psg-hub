> **psg-hub integration:** This Python worker is invoked from psg-hub via Vercel Sandbox at v1.2 (Ads Mutation Studio) per Decisions **D36 + D52**. The dry-run → execute → audit safety pattern documented below is preserved end-to-end; psg-hub adds web-UI surfacing + RBAC + an `is_high_risk` superadmin gate (D65). See `apps/psg/projects/psg-hub/PLANNING.md` v1.2 milestone for the integration contract. Relocated from `~/apps/ads/` in Phase 1 / 01-07 (history bundled at `archive/_repo-bundles/ads-pre-drop-20260531.bundle`).

---

# PSG Google Ads Tooling

Python-based mutation tooling for Google Ads API. Read-side is handled by the `google-ads-mcp` MCP server; this repo handles writes (conversion actions, negative keywords, keyword pauses, ad group restructures, bidding strategy swaps).

## Layout

```
apps/ads/
├── googleads_psg/              # reusable SDK wrapper + mutation library
│   ├── client.py               # GoogleAdsClient factory (loads .env)
│   ├── audit_log.py            # writes before/after JSON to logs/
│   └── mutations/
│       └── conversion_actions.py
├── ops/                        # one-shot op scripts per client
│   └── wallace/
│       └── fix_landing_page.py
├── logs/                       # gitignored — audit trail per mutation
├── .env.example                # template
└── pyproject.toml
```

## Setup (one-time)

```bash
cd apps/ads
python3.11 -m venv .venv          # or 3.12; NOT 3.14 (SDK wheel mismatch)
source .venv/bin/activate
pip install -e .
cp .env.example .env
# edit .env with real credentials
```

### Getting a refresh token

If you only have Client ID + Secret (no refresh token yet):

```bash
python -m googleads_psg.auth_bootstrap
```

This opens a browser, you grant consent, and it prints the refresh token to paste into `.env`.

## Safety rules (non-negotiable)

1. Every mutation script defaults to `--dry-run`. Pass `--execute` to actually hit the API.
2. Customer ID is always required as CLI arg. No defaults. Prevents wrong-account pushes.
3. Every execute run writes a JSON audit log to `logs/{op-name}-{customer-id}-{timestamp}.json` with full before-state + after-state.
4. Never commit `.env`. Never log credentials.

## Running an op

```bash
# Dry run (default) — prints what would change, does not mutate.
python -m ops.wallace.fix_landing_page --customer-id 6048611995

# Execute — actual mutation. Writes audit log.
python -m ops.wallace.fix_landing_page --customer-id 6048611995 --execute
```

## Verification loop

After every `--execute` run, verify via the read-only MCP:

```
mcp__google-ads-mcp__search with customer_id=<id>, resource=conversion_action, fields=[...]
```

Confirm the field values match what the audit log says was written.
