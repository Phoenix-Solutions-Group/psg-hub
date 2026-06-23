# Triggered-letter matrix — end-to-end dry run (PSG-304, W2)

Wires PSG's full Master Follow-Up letter tree onto the PSG-218 trigger/suppression
engine and proves it **end-to-end as a dry run** through the proof gate. **No live
mail** — that stays behind the G4 spend gate + prod Lob key + a QA-signed dry run.

## What's wired

| Layer | File |
| --- | --- |
| Trigger + suppression engine (which letters fire) | `src/lib/production/triggers.ts` |
| **Letter matrix** (the creative: every piece × ≥2 variants, as copy-data over one chassis) | `src/lib/production/letter-matrix.ts` |
| **Deterministic anti-repeat variant selection** | `src/lib/production/variant-select.ts` |
| **Dry-run orchestrator** (trigger → suppress → variant → merge → proof → audit) | `src/lib/production/dry-run.ts` |
| Pure mail-merge renderer + proof-gate hash (reused) | `src/lib/production/templates.ts`, `template-gate.ts` |
| 30-yr suppression / dedup (reused) | `src/lib/ops/mail/suppression.ts` |

### The full matrix

`thank_you` (PS682) · `warranty` (PS105) · `perfect_score` · `recommend_agent` ·
`agent_acknowledgement` (to the agent) · `call_your_agent` · `totaled_vehicle` (`t`) ·
`estimate_followup` (PSG_P_016) · `cycle_anniversary` win-back (`16`) ·
`seasonal_greeting` (birthday/seasonal) · `service_recovery` (offer-free).

Each piece carries **two creative directions (A/B)** — the rotation axis the
per-recipient anti-repeat uses. Copy is productized from PSG's real library; final
brand-voice is the proof gate / CMO + designer's call (PSG-219 owner).

## Acceptance, as executable tests

`src/lib/production/__tests__/letter-matrix-dryrun.test.ts`:

- **AC1** — every letter resolves trigger → template + variant → merge → proof with
  **0 unresolved tokens** (every piece *and* every variant rendered clean).
- **AC2** — per-recipient anti-repeat: a recipient never gets a repeat letter or
  variant. Three mechanisms, all seeded from the 30-yr history:
  - variant rotation excludes already-sent creatives;
  - a piece is **fully suppressed once all its variants are exhausted** (never repeats);
  - piece-scoped `already_mailed` dedup (`household_key` × `piece_code`);
  - plus household opt-out drops **all** of a recipient's pieces.
- **AC3** — deterministic in `runId`: the same run reproduces an identical audit +
  selection; the `contentHash` binds each audit row to the exact proofed bytes
  (auditable proof == what would print).
- **AC4** — **zero live submits**: the orchestrator never constructs or calls a mail
  adapter; **every attempt writes an audit row** with `mode: "dry_run"`,
  `submitted: false`.

## Run it

```bash
# from apps/psg-hub
pnpm vitest run src/lib/production/__tests__/letter-matrix-dryrun.test.ts
```

To dry-run against de-identified PSG-216 import data, call
`runLetterMatrixDryRun(recipients, { runId, asOf, suppressionRows })` from a script /
ops route: build `DryRunRecipient[]` from de-identified import rows (salted
`householdKey`/`recipientHash`, merge values, `priorVariantsByPieceCode` from send
history), pass the 30-yr `suppressionRows`. It returns `{ audit, proofs, counts }` —
render `proofs[].document.file` in the gate preview; persist `audit` rows.

## Guardrails

- `service_recovery` is relationship-only: the orchestrator runs
  `validateRecoveryContent` on the rendered recovery proof and **fails closed**
  (records a suppression) if any offer/coupon/price language leaks in.
- The dry run is PURE and adapter-free; promoting to live mail is a separate,
  gated change (G4 spend gate + prod Lob key + this dry run signed off by QA).
