# Move 1 — deal-won → onboarding delivery board (no browser UI)

PSG-584 / PSG-576. When a Pipedrive **deal is won**, we auto-create the client's
onboarding delivery board (one Pipedrive **project** + the 5 D-phases + tasks from
Noelle's confirmed template on PSG-580) **entirely through the REST API**. No Pipedrive
browser UI and no browser-automation tool is involved anywhere in this path.

## Pieces

| File | Role |
|---|---|
| `onboarding-template.ts` | The CONFIRMED WHM template as typed data (5 phases, 25 tasks, owners, day-offsets). |
| `projects.ts` | Projects API client (`createProjectsClient`) + `provisionOnboardingBoard()` builder + `isDealWonTransition()`. |
| `../../app/api/webhooks/pipedrive/route.ts` | The webhook handler Pipedrive calls on every deal update. |

## Required env (Vercel — server-side only)

| Var | Purpose |
|---|---|
| `PIPEDRIVE_API_KEY` | Write-capable personal API token (same admin token the intake path uses). |
| `PIPEDRIVE_COMPANY_DOMAIN` | e.g. `psg` (for `https://psg.pipedrive.com`). Optional; falls back to `api.pipedrive.com`. |
| `PIPEDRIVE_ONBOARDING_BOARD_ID` | The Projects board new onboarding projects are created on. |
| `PIPEDRIVE_ONBOARDING_PHASE_ID` | The board phase (kanban column) new projects land in. |
| `PIPEDRIVE_SALES_PIPELINE_ID` | Sales pipeline whose won deals build a board — set to **`8`** (`https://psg.pipedrive.com/pipeline/8`, the pipeline Nick confirmed). Won deals in other pipelines are ignored. Leave unset to accept won deals from **every** pipeline. |
| `PIPEDRIVE_WEBHOOK_USER` / `PIPEDRIVE_WEBHOOK_PASS` | HTTP Basic auth pair the webhook is registered with; the route verifies it timing-safe. |

## One-time setup — all via `curl`, no UI

Replace `$TOKEN` with the write token and `$DOMAIN` with the subdomain (e.g. `psg`).

**1. Discover the board + phase to drop projects into:**

```bash
curl -s "https://$DOMAIN.pipedrive.com/v1/projects/boards?api_token=$TOKEN"
# pick the delivery board id →  BOARD_ID
curl -s "https://$DOMAIN.pipedrive.com/v1/projects/phases?board_id=$BOARD_ID&api_token=$TOKEN"
# pick the starting phase id →  PHASE_ID
```

Set `PIPEDRIVE_ONBOARDING_BOARD_ID=$BOARD_ID` and `PIPEDRIVE_ONBOARDING_PHASE_ID=$PHASE_ID` in Vercel.

**2. Register the deal-won webhook (API-created — no UI):**

```bash
curl -s -X POST "https://$DOMAIN.pipedrive.com/v1/webhooks?api_token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription_url": "https://<prod-host>/api/webhooks/pipedrive",
    "event_action": "updated",
    "event_object": "deal",
    "http_auth_user": "'"$PIPEDRIVE_WEBHOOK_USER"'",
    "http_auth_password": "'"$PIPEDRIVE_WEBHOOK_PASS"'",
    "version": "1.0"
  }'
```

Pipedrive has no native "deal.won" event, so we subscribe to `deal` `updated` and the
handler fires only on the transition **into** `won` (`isDealWonTransition`) — an
already-won deal re-sent is a no-op, and provisioning itself is idempotent on a
deterministic project title, so a webhook retry never double-creates.

## Role assignment (PSG-587 — wired)

The webhook now builds a `roleUserMap` from env on every deal-won and passes it to
`provisionOnboardingBoard`, so tasks land on real people instead of being created
unassigned. Config lives in `role-user-map.ts` (`loadRoleUserMap`).

**One env var per role**, each holding that role owner's Pipedrive **user id**:

| Var | Role |
|---|---|
| `PIPEDRIVE_ROLE_USER_AS` | Account Strategist |
| `PIPEDRIVE_ROLE_USER_ADS` | Ads Engineer |
| `PIPEDRIVE_ROLE_USER_ANALYTICS` | Analytics Engineer |
| `PIPEDRIVE_ROLE_USER_WEB` | Web Engineer |
| `PIPEDRIVE_ROLE_USER_CRO` | CRO Analyst |

Behaviour: a role is assigned **only** when its var holds a positive integer user id.
Any role left blank (or set to a malformed value) stays **unassigned** — the accountable
role remains in the task title, and provisioning never fails on a missing/bad value. So
partial rollout works: set the roles you have confirmed, add the rest later.

**Finding the user IDs** (the "PSG team records" step): call the Projects client's
`listUsers()` (or `curl -s "https://$DOMAIN.pipedrive.com/v1/users?api_token=$TOKEN"`),
match each role owner to their `id`, and set the vars above in Vercel.

## D6/D7

Out of scope here by design (Noelle, PSG-580): the ongoing monthly recurring loop is a
**separate** recurring board so onboarding can actually reach "Done" at D5 sign-off.
Tracked as its own follow-on issue.
