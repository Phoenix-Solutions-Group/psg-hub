# Direct-mail aggregate volume priors (ingested ledger)

- Source: Production Counts_PSG + The Mail House (docs/ops/mail/source/production-counts-ledger.full.csv)
- Span: 2021-08-10 → 2026-06-18
- Mailings: 476 · Total pieces: 715,177
- Computed at: 2026-06-23
- Volume prior = each piece's share of all pieces mailed; a stable mix weight the
  engine leans on before per-segment outcome rates (`priors.ts`, PSG-224) refine it.

## Piece mix (volume prior)

| Piece | Name | Total | Share |
| --- | --- | ---: | ---: |
| 07 | Thank You + Warranty + Survey | 193,958 | 27.1% |
| 14 | 1 Year | 184,042 | 25.7% |
| 10 | 3 Month | 115,713 | 16.2% |
| 15 | 18 Month | 80,213 | 11.2% |
| 04 | Thank You + Warranty | 43,357 | 6.1% |
| S | Special Mailing | 40,927 | 5.7% |
| 16 | 2 Year | 36,654 | 5.1% |
| 01 | Survey Only | 12,336 | 1.7% |
| 12 | Drivers | 3,030 | 0.4% |
| 06 | Thank You Only | 1,064 | 0.1% |
| 11 | Birthday | 929 | 0.1% |
| 05 | Warranty Only | 641 | 0.1% |
| 13 | 6 Month | 614 | 0.1% |
| T | Total Loss | 535 | 0.1% |
| 03 | Thank You + Survey | 477 | 0.1% |
| E | Estimate Follow-Up | 354 | 0.0% |
| A | Agent Report Card | 333 | 0.0% |

## Volume by year

| Piece | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 07 | 21,438 | 46,466 | 42,700 | 38,247 | 31,822 | 13,285 |
| 14 | 15,331 | 39,692 | 43,207 | 42,654 | 38,621 | 4,537 |
| 10 | 13,171 | 28,389 | 26,922 | 24,447 | 22,106 | 678 |
| 15 | 8,578 | 20,000 | 19,114 | 17,693 | 14,465 | 363 |
| 04 | 2,390 | 5,662 | 9,398 | 9,233 | 13,378 | 3,296 |
| S | 9,791 | 12,795 | 11,491 | 3,191 | 3,659 | 0 |
| 16 | 2,636 | 4,032 | 8,486 | 11,436 | 9,857 | 207 |
| 01 | 441 | 776 | 1,982 | 4,165 | 3,605 | 1,367 |
| 12 | 412 | 910 | 715 | 656 | 332 | 5 |
| 06 | 177 | 364 | 278 | 147 | 75 | 23 |
| 11 | 349 | 506 | 0 | 74 | 0 | 0 |
| 05 | 222 | 387 | 32 | 0 | 0 | 0 |
| 13 | 110 | 401 | 103 | 0 | 0 | 0 |
| T | 135 | 154 | 147 | 51 | 42 | 6 |
| 03 | 84 | 316 | 31 | 21 | 25 | 0 |
| E | 64 | 112 | 178 | 0 | 0 | 0 |
| A | 73 | 67 | 119 | 62 | 12 | 0 |
| **All** | **75,402** | **161,029** | **164,903** | **152,077** | **137,999** | **23,767** |

## AC1 reconciliation — per-recipient batch vs ledger row

Production date **2021-09-07**: per-recipient envelope artifacts vs the ledger's recorded counts.

| Piece | Batch (envelopes) | Ledger | Δ |
| --- | ---: | ---: | ---: |
| 04 | 153 | 154 | -1 |
| 07 | 246 | 246 | 0 |
| 10 | 459 | 459 | 0 |
| 12 | 11 | 11 | 0 |
| 13 | 2 | 2 | 0 |
| 14 | 527 | 527 | 0 |
| 15 | 316 | 316 | 0 |
| 16 | 64 | 64 | 0 |
| T | 1 | 1 | 0 |
| **Total** | **1779** | **1780** | **-1** |

The only gap is piece 04: its envelope artifact is absent from the sample batch (only the letter is present), so its one letter-only recipient is unobserved here. That single recipient is the entire delta — the batch's 1779 parsed recipients + 1 letter-only 04 = the ledger's 1780. After household dedup the importer (PSG-223) persists 1766. The representations agree.

