# Direct-mail trigger + A/B priors (mined)

- Source: SYNTHETIC fixture (illustrative — NOT production; real priors land via PSG-216a)
- Outcome window: 180 days after send
- Computed at: SYNTHETIC-FIXTURE
- Outcome = repeat OR referral OR returned survey OR subsequent RO inside the window.

## Trigger: survey_followup_warranty

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=Customer|repeat=N|region=TX | 07 | A | 60 | 14 | 23.3% |
| paytype=Ins|repeat=Y|region=LA | 07 | A | 80 | 25 | 31.3% |

## Trigger: total_loss_thank_you

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=Ins|repeat=N|region=LA | t | A | 40 | 5 | 12.5% |

## Trigger: warranty_letter

| Segment | Piece | Arm | Sent | Outcomes | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| paytype=Ins|repeat=Y|region=LA | 04 | A | 100 | 18 | 18.0% |
| paytype=Ins|repeat=Y|region=LA | 04 | B | 100 | 27 | 27.0% |

**A/B verdicts:**
- **paytype=Ins|repeat=Y|region=LA / 04**: arm **B** wins (18.0% A vs 27.0% B, 9.0% lift).
