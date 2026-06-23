# PSG-241 — Competitor discovery (web_grounded/Yext): QA plan

Wave 1B follow-on to [PSG-226](/PSG/issues/PSG-226). Owner: Ravi · QA: Tess · Security review
(service-role write path): Ada.

Discovery is the missing seam: PSG-226's monitor only reports on shops that **already** have
`competitors` rows. This adds grounded discovery that finds a real shop's competitors and seeds
that table, so scoring + monitor then have something to work on. It does **not** fork scoring.

The two gating risks to prove: **per-shop tenant isolation on the write path** and **spend cap /
degrade-to-nothing while G5 is not cleared**.

## What shipped (branch `feat/psg-241`)

- `src/lib/intel/competitor/discovery.ts`
  - `runCompetitorDiscovery(service, opts, deps)` — per-shop pass: for each shop, run a grounded
    provider → dedupe → upsert into `competitors` on conflict `(shop_id, normalized_name)`.
  - `makeGroundedDiscoveryProvider(...)` — default provider; routes the `web_grounded` profile
    through the existing 16-01 router (G5 provider gate + month-to-date spend cap both apply).
  - `DiscoveryProvider` seam — a Yext-backed provider can be slotted behind the same type later
    (shops already carry `yext_entity_id`).
  - Pure helpers: `normalizeCompetitorName`, `candidateToRow`, `dedupeCandidates`,
    `groundedDiscoveryEnabled`.
- `src/lib/intel/competitor/__tests__/discovery.test.ts` — 19 tests; discovery.ts coverage
  98.75% lines / 96.59% stmts. Full `src/lib/intel` suite 103/103, tsc 0, eslint 0.
- **No new migration.** Discovery upserts into the existing `competitors` table
  (`20260618183000_competitors.sql`), which was already authored discovery-ready (`place_id`,
  `raw jsonb`, `discovered_at`, unique `(shop_id, normalized_name)`).

## Safety properties to verify

### A. Degrade-to-nothing while G5 is not cleared (zero spend, zero rows)

Discovery **writes** rows, so unlike the report's narrative/research seams it must never fabricate.
The `web_grounded` chain has an ungrounded Anthropic tail (fine for prose, would hallucinate fake
shops here). Two layers enforce no-fabrication:

1. `runCompetitorDiscovery` checks `groundedDiscoveryEnabled(enabled)` first. With only Anthropic
   enabled (G5 not cleared) it dispatches **nothing**, writes **nothing**, and marks every shop
   `gated`. Test: `runCompetitorDiscovery — gate / degrade-to-nothing`.
2. `makeGroundedDiscoveryProvider` persists a result **only when the winning model was genuinely
   grounded** (Perplexity / Gemini). If the router fell through to the Anthropic tail, it returns
   `[]`. Test: `returns [] when the router falls to the ungrounded Anthropic tail (no fabrication)`.

**Live check (once G5 keys exist):** with `INTEL_ENABLED_PROVIDERS` unset, run a discovery pass
against the QA DB and confirm `competitors` row count is unchanged and `llm_call_log` records no
new `intel:web_grounded` spend.

### B. Spend cap

Per-shop cap defaults to **$25** (`INTEL_DISCOVERY_SPEND_CAP_USD`), lower than the report's $200,
enforced against the **shared** month-to-date intel ledger (so a whole pass is bounded too). Over
the cap with only a metered provider enabled → no dispatch, `[]` returned. Test:
`over the spend cap with perplexity-only, never dispatches and returns [] (budget enforced)`.

### C. Per-shop tenant isolation (the gating test)

Every upserted row carries the owning `shop_id`; the upsert conflict key is
`(shop_id, normalized_name)`; per-shop work is clamped to one shopId at a time — identical to
`sync.ts` / `run-monitor.ts`. Service-role bypasses RLS, so this per-shop scoping in code IS the
write-path isolation boundary; the `competitors` RLS policies guard customer reads.

Unit proof: `upserts discovered competitors per shop, tenant-scoped` asserts each upsert batch
carries ONLY its own shop_id.

**Live check (RLS-enforced, NOT service role):** seed discovered rows for `shop_A` and `shop_B`,
then as a `shop_A` member:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user_in_shop_A>","role":"authenticated"}';
select shop_id, count(*) from public.competitors group by shop_id;
```

**PASS:** only `shop_A` rows return; `shop_B`'s discovered competitors are invisible. (This reuses
PSG-226's competitors-table isolation proof — discovery only adds rows to that same table.)

### D. End-to-end: discovery → scoring → non-empty report

Acceptance requires the existing monitor to produce a **non-empty** report for a shop that had
none. Proven at unit level by
`integration — discovery output feeds the existing scorer (non-empty report path)`: discovered
rows map cleanly through `sync.ts rowToCompetitor` into `scoreShopCompetitors`, yielding a ranked,
non-empty score set with the consolidator on top.

**Live check (once G5 + a real shop are available):** run discovery for one real shop, then
`runCompetitorMonitor` (PSG-226) and confirm `report.summary.totalCompetitors > 0` and a
`competitor_monitor_runs` row with `status != skipped`.

## Activation (G5) follow-on — out of scope for this QA

Live discovery needs board spend approval **G5** + operator API keys (`INTEL_ENABLED_PROVIDERS`
including a grounded provider). Until then discovery degrades to nothing. Wiring a scheduled
trigger (a cron, or a discovery step ahead of the PSG-226 monitor) is the activation step and
lands with G5 — it is intentionally not enabled here.
