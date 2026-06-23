# PSG Numbered Letter-Library Catalog

**Issue:** PSG-222 (PSG-216c / PSG-115e) · **Parent:** [PSG-216](/PSG/issues/PSG-216) · **Spec:** `docs/specs/002-mail-send-history-w0/spec.md` §4
**Productized by:** PSG-115a · **Machine-readable companion:** [`letter-library.json`](./letter-library.json)

This catalogs the **numbered letter library** — PSG's real direct-mail template set, the
one PSG-115a productizes for the BSM direct-mail engine. Every piece below is grounded in
the one production batch present in the repo plus the Master Follow-Up Program definition.

## Sources

| Source | Location |
|--------|----------|
| Production batch (the actual pieces) | `docs/psg/production-center/production-files-sample/2021-09-07/` — 25 files, named `<piece_code>-<variant>-09-07.md` |
| Program / trigger definition | `docs/psg/master-follow-up-program/samples/` (`001.md`, `002.md`, `front.md`, `back.md`) |

The 2021-09-07 batch is the **only** production batch in the repo. The per-recipient send
log (recipient × piece × date) is **not** present — that gap is the first-class blocker
tracked on PSG-216 (spec §2) and does not affect this catalog.

## Variants

| Variant | What it is |
|---------|-----------|
| `letter` | Primary printed letter (message body). |
| `envelope` | Outer/window envelope carrier, often with a teaser line (e.g. *"Your Repair Warranty Enclosed"*). |
| `warranty` | Enclosed ACRB-registered repair/paint warranty certificate. |
| `survey` | Enclosed ACRB satisfaction survey with Online Security Code + Survey ID. |

## Triggered-letter tree (ACRB / Master Follow-Up Program)

The board-named triggers and how the numbered pieces map to them:

- **Totaled-Vehicle** — insurer declined to repair; thank-you + valuation help → piece **`t`**
- **Perfect-Score** — customer rated the survey 100% / responded positively → piece **`10b`**
- **Estimate-Followup** — consumer-rights / estimate-phase education → piece **`15`**
- **Recommend-Agent** — survey shows agent dissatisfaction; shop offers help → *Agent-Contact program letter set; **no numbered piece** in this batch*

Pieces that aren't one of the four board triggers carry a descriptive trigger (base repair-completed,
survey-not-returned, time-based, calendar). See each entry below.

## Catalog

| Code | Name | Trigger | Program trigger | Variants present | Sample (letter) |
|------|------|---------|-----------------|------------------|-----------------|
| `t` | Total-Loss Thank-You (Vehicle Valuation Assistance) | Insurer declined to repair (total loss) | **totaled_vehicle** | letter, envelope | [`t-letter`](../../psg/production-center/production-files-sample/2021-09-07/t-letter-09-07.md) |
| `04` | Thank-You + Warranty Enclosed | Repair completed | base_repair_completed | letter, warranty | [`04-letter`](../../psg/production-center/production-files-sample/2021-09-07/04-letter-09-07.md) |
| `04b` | Thank-You + Warranty Enclosed (variant B) | Repair completed (branding variant of 04) | base_repair_completed | letter, envelope, warranty | [`04b-letter`](../../psg/production-center/production-files-sample/2021-09-07/04b-letter-09-07.md) |
| `07` | Thank-You + Warranty + Survey Notice | Repair completed; opens the survey cycle | base_repair_completed | letter, envelope, survey, warranty | [`07-letter`](../../psg/production-center/production-files-sample/2021-09-07/07-letter-09-07.md) |
| `10` | Survey Non-Responder Reminder | ACRB survey sent but not returned | survey_not_returned | letter, envelope | [`10-letter`](../../psg/production-center/production-files-sample/2021-09-07/10-letter-09-07.md) |
| `10b` | Survey Responder Thank-You / Perfect-Score + Referral | Customer completed survey (positive) | **perfect_score** | letter, envelope | [`10b-letter`](../../psg/production-center/production-files-sample/2021-09-07/10b-letter-09-07.md) |
| `12` | Driver's License Renewal Reminder | Time-based: license near renewal | time_based_courtesy | letter, envelope | [`12-letter`](../../psg/production-center/production-files-sample/2021-09-07/12-letter-09-07.md) |
| `13` | Free Paint Maintenance Check-Up Offer | Post-repair: 6-mo paint check-up (18 mo) | time_based_post_repair | letter, envelope | [`13-letter`](../../psg/production-center/production-files-sample/2021-09-07/13-letter-09-07.md) |
| `14` | One-Year Anniversary Follow-Up | ~1 year after repair | time_based_post_repair | letter, envelope | [`14-letter`](../../psg/production-center/production-files-sample/2021-09-07/14-letter-09-07.md) |
| `15` | Consumer Rights / Estimate-Followup Education | Estimate-phase / consumer-rights education | **estimate_followup** | letter, envelope | [`15-letter`](../../psg/production-center/production-files-sample/2021-09-07/15-letter-09-07.md) |
| `16` | Repeat / Referral Appreciation (Past Patronage) | Time-based loyalty: past patronage + referrals | time_based_loyalty | letter, envelope | [`16-letter`](../../psg/production-center/production-files-sample/2021-09-07/16-letter-09-07.md) |
| `b` | Birthday / Seasonal Greeting | Calendar: birthday + seasonal/holiday | calendar_birthday_seasonal | *(no sample in batch)* | — |

### Piece notes

- **`t` — Total-Loss Thank-You.** Letter body confirms the total-loss framing (*"The insurance
  company elected not to repair your vehicle"*) and carries a *Vehicle Valuation Assistance*
  insert. No warranty/survey variant — no repair was performed.
- **`04` — Thank-You + Warranty.** The base post-repair warranty/thank-you letter. The warranty
  cert is ACRB-registered (`Registered ID #: ACRB####### - PS####`). No envelope variant in this batch.
- **`04b` — variant B.** Same trigger as `04` plus an envelope variant; batch pages show multiple
  recipients/shops (e.g. Marina Auto Body). The `b` suffix is a layout/branding variant, not a new trigger.
- **`07` — full mailing.** The only piece with all four variants. The letter's P.S. announces the
  incoming ACRB survey; the survey variant carries the Online Security Code + Survey ID. This piece
  opens the survey branch that resolves to `10` (non-responder) or `10b` (responder).
- **`10` — non-responder reminder.** *"We noticed that you have not returned their survey."* Branch sibling of `10b`.
- **`10b` — responder / Perfect-Score.** *"Thank you for taking the time to complete the satisfaction
  survey... you can recommend us to your friends and family."* The Perfect-Score / referral-development letter.
- **`12` — license renewal.** Courtesy contact (*"your license is up for renewal this coming October"*).
- **`13` — paint maintenance.** *"FREE paint maintenance check-up every 6 months for 18 months"* — drives re-visits, reinforces the paint warranty.
- **`14` — one-year anniversary.** *"it's been about a year since you brought your... in for repair."*
- **`15` — consumer rights / estimate.** Answers *"Must I obtain three estimates?"* and related
  consumer-rights questions — the Estimate-Followup branch.
- **`16` — repeat/referral appreciation.** *"Your past patronage in September of 2019 is remembered
  with appreciation... thank you... for any associates that you have referred."*
- **`b` — birthday/seasonal.** Listed in spec §4 and described in the program brochure
  (`samples/001.md`: *"multiple birthday greetings, seasonal contacts"*). **No sample in the
  2021-09-07 batch** — cataloged from the program definition only; variants unknown until a
  sample batch is supplied via the operator read-bridge.

## Coverage

- **12** piece codes cataloged: **11** with sample files (25 files total), **1** (`b`) from program docs only.
- Variants present across the batch: **letter ×11, envelope ×10, warranty ×3 (`04`,`04b`,`07`), survey ×1 (`07`)**.
- File-count reconciliation: 11 + 10 + 3 + 1 = **25** files = the full 2021-09-07 batch. ✔

## Gaps & cross-references

- The **`b`** piece has no production sample in this batch — flag for the operator read-bridge if/when birthday/seasonal output is needed for PSG-115a.
- The **Recommend-Agent / Customer-Call-Your-Agent / Agent-Customer-Acknowledgement** triggers
  (Master Follow-Up Program samples `002.md`/`back.md`) are *Agent-Contact* program letters, not
  numbered customer pieces; they are not present in this batch.
- **PSG-115a** consumes this catalog (`piece_code` + `program_trigger` + variants) as the template
  set to productize. The send-history engine ([spec §3.1 `mail_send_history`](../../specs/002-mail-send-history-w0/spec.md))
  references the same `piece_code` / `piece_variant` vocabulary cataloged here.
