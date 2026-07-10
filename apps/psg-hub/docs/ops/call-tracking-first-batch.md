# BSM First-Batch Call Tracking

## Bottom Line

Use manual imports for the first batch so Body Shop Marketer can report phone
leads before we commit to a provider-specific connector.

## First-Batch Inventory

Repo-visible first-batch shops:

| Shop | Evidence in repo | Call tracking provider status |
| --- | --- | --- |
| Wallace Collision Center | Pilot cohort in `README.md` / `PLANNING.md`; Google Ads customer `6048611995` | Not recorded in repo |
| Tedesco Auto Body | Pilot cohort in `README.md` / `PLANNING.md`; Google Ads customer `7763526490` | Not recorded in repo |
| Tracy's Collision Center | BSM fixture transitioning to pilot | Not recorded in repo |

No checked-in source currently proves that CallRail, WhatConverts, or another
call tracking provider is active for one of these shops. The safe first path is
therefore provider-neutral manual import.

## Chosen Data Path

1. Export calls from the client's current call tracking provider.
2. Map the export with `src/lib/call-tracking/import.ts`.
3. Upsert into `public.call_tracking_calls`.
4. Read the ops report `call-tracking-summary`.

The import key is `(shop_id, provider, idempotency_key)`, so re-importing the
same file updates the same calls instead of double-counting them.

## Required Export Fields

Minimum fields:

- Call ID or Lead ID
- Call start date/time
- Source
- Campaign
- Qualified / quotable / lead status

Useful optional fields:

- Duration in seconds
- Provider account/profile ID
- Shop-owned tracking number

Do not import caller phone numbers, recordings, or transcripts into this first
path. The current report needs qualified call counts, source, campaign, and date
only.

## Report Output

The `Call Tracking Summary` report groups by:

- Shop
- Call date
- Source
- Campaign

It returns total calls and qualified calls for the selected period.
