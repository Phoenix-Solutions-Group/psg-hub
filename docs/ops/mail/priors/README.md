# Direct-mail trigger + A/B priors — method

**Issue:** PSG-224 (PSG-115e) · parent PSG-216 · spec
[`docs/specs/002-mail-send-history-w0/spec.md`](../../../specs/002-mail-send-history-w0/spec.md) §5/§6 AC3.

This documents how the BSM direct-mail engine's **evidence-based priors** are
mined from PSG's 30-year FileMaker history. The priors answer, per customer
segment: *which numbered piece, and which A/B arm of it, actually converts?*

Code: [`apps/psg-hub/src/lib/ops/mail/priors.ts`](../../../../apps/psg-hub/src/lib/ops/mail/priors.ts)
(pure miner) + [`outcome-sources.ts`](../../../../apps/psg-hub/src/lib/ops/mail/outcome-sources.ts)
(export → outcome normalizer). Output table:
`public.mail_send_priors` (migration `20260623160000_mail_send_priors_w0.sql`).
Worked example: [`example.md`](./example.md) (regenerated from a **synthetic**
fixture — not production data).

## What a prior is

One row per **(segment, piece base, A/B arm)**:

```
outcome_rate = (# sends in that cell that produced a positive outcome in the window)
             / (# sends in that cell)
```

It is written to `mail_send_priors` (machine-readable, engine-facing) **and** to
this folder as a human-readable summary (`renderPriorsSummary`).

## The two sides of the join

| Side | Source | Key fields |
|------|--------|-----------|
| **Send** | `mail_send_history` (PSG-216a import) | `piece_code`, `sent_date`, `ro_number`, `recipient_hash`, `household_key`, + RO-side segment attrs (`pay_type`, `region`, repeat-customer flag) |
| **Outcome** | Repair-Customer + Survey exports (`docs/psg/filemaker/exports/`, 2018–2022) | `RC_SerialNum`/`S_RC_RONumber` (RO#), `RC_*`/`S_RC_*` address+name, repeat/referral/survey flags, dates |

**Match priority** (`matchOutcome`): `ro_number` → `recipient_hash` →
`household_key`, requiring the outcome date to fall inside
`[sent_date, sent_date + windowDays]`. RO number is the strongest key and needs
no PII; the salted hashes are a fallback for send rows with no RO number.

**Outcome window:** default **180 days** after the send (the follow-up program's
~6-month horizon). Configurable via `MineOptions.windowDays`.

**Positive outcome:** `repeat` OR `referral` OR a **returned survey** (a survey
row's existence = a return) OR a **subsequent RO**. Any one inside the window
counts the send as converted.

## Segmentation

`segment_key` is built from RO/customer-side attributes carried on the send
(stable, known before the outcome): `paytype=<bucket>|repeat=<Y/N>|region=<ST>`.

- **paytype** — bucketed from the messy export free text (`normalizePayType`):
  `Ins` (insurance / claimant), `ThirdParty`, `Customer`, `Other`, `unknown`.
- **repeat** — whether the mailed customer was already a repeat customer
  (optional dimension; drop with `segmentByRepeat: false`).
- **region** — 2-letter state code (`unknown` when absent).

## A/B arms

PSG's real numbered-letter set ships **base + lettered-alternate pairs**
(`04`/`04b`, `10`/`10b`). Those alternates **are** the empirical A/B arms the
history gives us, so:

- arm **A** = the base piece (`04`, `07`, `t`, …)
- arm **B** = its lettered alternate (`04b`, `10b`, …)

`splitPiece` folds the `b` suffix into `ab_variant='B'` with the same
`piece_code` base, so a (segment, piece) cell can carry both arms and the
renderer emits an **A/B verdict** (winning arm + lift) wherever both exist. A bare
`b` (birthday/seasonal) is its own base, arm A.

## Piece → trigger

`pieceTrigger` maps the base code to the program trigger it serves (`t` →
`total_loss_thank_you`, `04` → `warranty_letter`, `07` →
`survey_followup_warranty`, `10`/`12`–`16` → `followup_sequence`, `b` →
`birthday_seasonal`). The authoritative catalog is the numbered-letter library
(PSG-216c); this internal map keeps the miner self-contained.

## PII posture (PSG-129/132/133 controls)

No raw name/address is persisted. `mail_send_history` stores only salted
`recipient_hash` + `household_key`. The outcome normalizer computes the same keys
via **injected** hashers (`OutcomeHashers`) — wired to
[`mail/household.ts`](../../../../apps/psg-hub/src/lib/ops/mail/household.ts)
(PSG-221) for the real run, stubbed in unit tests — so this code carries no
secret and no raw PII. The RO-number join (the common case) needs no PII at all.

## Running the miner (gated on PSG-216a)

The pure miner is built, unit-tested (28 cases, ≥99% line coverage), and ready.
It cannot produce **real** priors until the send-history import (PSG-216a) lands
`mail_send_history` rows — only the single 2021-09-07 production batch is in the
repo today; the raw 30-year per-recipient send log is sourced via the operator
read-bridge (spec §2). Once those rows exist, the run is:

```ts
import { createServiceClient } from "@/lib/supabase/service";
import { mineSendPriors, renderPriorsSummary } from "@/lib/ops/mail/priors";
import { buildOutcomeStream } from "@/lib/ops/mail/outcome-sources";
import { householdKey, recipientHash } from "@/lib/ops/mail/household";

// 1. load sends from mail_send_history; 2. load+normalize outcome exports with
//    { householdKey, recipientHash } as the injected hashers; 3. mine; 4. upsert
//    rows ON CONFLICT (segment_key, piece_code, ab_variant); 5. write this doc.
```

(`scripts/gen-priors-example.mts` is the same pipeline against a synthetic
fixture, kept as the template + example regenerator.)

## Acceptance (AC3) mapping

- ✅ Output table `mail_send_priors` (migration) — segment / piece / trigger /
  A/B arm / n_sent / n_outcome / outcome_rate, idempotent on
  `(segment_key, piece_code, ab_variant)`.
- ✅ Miner joins send × outcome on `(ro_number | recipient_hash | household_key,
  date window)`, computes rate per piece + per A/B arm per segment.
- ✅ Human-readable summary at `docs/ops/mail/priors/` (this folder) +
  worked `example.md`; method documented (this file).
- ⏳ **Real priors written to the table** — gated on PSG-216a importing
  `mail_send_history` rows. Auto-resumes when that lands; then handed to Tess (QA).
