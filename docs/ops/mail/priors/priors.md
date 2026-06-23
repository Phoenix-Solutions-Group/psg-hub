# Direct-mail trigger + A/B priors (mined)

- Source: production batch 2021-09-07 (1767 sends) × repair-customer + survey exports
- Outcome window: 180 days after send
- Computed at: 2021-09-07
- Outcome = repeat OR referral OR returned survey OR subsequent RO inside the window.

## Trigger: followup_sequence

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=Customer|repeat=N|region=CO | 14 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=N|region=IN | 14 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=N|region=MA | 14 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=N|region=NM | 15 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=Y|region=AR | 10 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=Y|region=CO | 14 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=Y|region=FL | 14 | A | 1 | 0 | 0.0% |
| paytype=Customer|repeat=Y|region=IN | 14 | A | 2 | 0 | 0.0% |
| paytype=Customer|repeat=Y|region=MN | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=AR | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=IL | 14 | A | 3 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=MA | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=MI | 14 | A | 2 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=MN | 14 | A | 4 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=NY | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=OH | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=TX | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=N|region=WA | 14 | A | 2 | 0 | 0.0% |
| paytype=Ins|repeat=Y|region=AR | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=Y|region=FL | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=Y|region=MA | 10 | B | 1 | 0 | 0.0% |
| paytype=Ins|repeat=Y|region=MA | 14 | A | 1 | 0 | 0.0% |
| paytype=Ins|repeat=Y|region=MN | 14 | A | 4 | 0 | 0.0% |
| paytype=unknown|region=unknown | 10 | A | 387 | 0 | 0.0% |
| paytype=unknown|region=unknown | 10 | B | 67 | 0 | 0.0% |
| paytype=unknown|region=unknown | 12 | A | 10 | 0 | 0.0% |
| paytype=unknown|region=unknown | 13 | A | 2 | 0 | 0.0% |
| paytype=unknown|region=unknown | 14 | A | 496 | 0 | 0.0% |
| paytype=unknown|region=unknown | 15 | A | 313 | 0 | 0.0% |
| paytype=unknown|region=unknown | 16 | A | 64 | 0 | 0.0% |

**A/B verdicts:**
- **paytype=unknown|region=unknown / 10**: arm **A** wins (0.0% A vs 0.0% B, 0.0% lift).

## Trigger: survey_followup_warranty

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=unknown|region=unknown | 07 | A | 244 | 0 | 0.0% |

## Trigger: total_loss_thank_you

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=unknown|region=unknown | t | A | 1 | 0 | 0.0% |

## Trigger: warranty_letter

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=unknown|region=unknown | 04 | B | 149 | 0 | 0.0% |

> **Coverage (honest):** mined from the **only** per-recipient send batch in
> the repo (2021-09-07, 1767 sends; spec §2 — the full 30-year
> send log lands via the operator bridge, after which re-running
> `scripts/mine-mail-priors.mts` scales these priors up unchanged).
> 34/1767 sends matched a repair-customer profile for
> segmentation; 0 sends had a positive outcome inside the
> 180-day window. Thin cells are expected at this data volume.
