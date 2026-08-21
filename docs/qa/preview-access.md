# QA preview access — running the deployed-preview checks

How anyone on the team gets a working preview retest, and what to check before
reporting one as blocked.

## The one file that matters

`apps/psg-hub/.env.test.local` is the **single source of truth** for QA
credentials. The preview checks read it and nothing else.

It carries two target blocks:

| Block | Keys | Points at |
|---|---|---|
| local | unprefixed (`NEXT_PUBLIC_SUPABASE_URL`, `DEMO_SHOP_EMAIL`, …) | the local `supabase start` stack |
| preview | `PREVIEW_*` | the **real demo** Supabase project (`gylkkzmcmbdftxieyabw`) |

Keep the unprefixed block pointed at the local stack: `e2e/global.setup.ts`
refuses to seed a non-local target, and that guard is what stops a local test run
from writing into a hosted project.

`e2e/_qa-env.mjs` loads a block by name and refuses to hand anything back if a
Supabase URL and a Supabase key inside it belong to different projects.

### Getting the values

The file is gitignored, so a fresh checkout has none of it. Copy the QA blocks
from `apps/psg-hub/.env.example` and fill them from the shared PSG credential
store. Never paste credentials into a ticket, a chat message, or a command-line
flag — see `/srv/psg/apps/home/data/.claude/CLAUDE.md`.

The QA demo accounts on the demo project:

| Role | Account | Owns |
|---|---|---|
| Shop owner | `PREVIEW_DEMO_SHOP_EMAIL` | Riverside Collision **and** South Lincoln |
| Operator | `PREVIEW_DEMO_OPERATOR_EMAIL` | Riverside Collision, ops/superadmin surfaces |

Riverside Collision there carries the approved demo state: 3 Google Ads accounts,
2 campaigns, 150 analytics snapshots.

## Which Supabase project is which

There are two projects that look plausible, and confusing them is the failure
mode this document exists to prevent:

| Project ref | Name | What it is |
|---|---|---|
| `gylkkzmcmbdftxieyabw` | localreach | **The real demo backend.** Holds the approved Riverside demo data. The name is historical — do not read it as "unrelated to psg-hub". |
| `ncksoeindpscpohembuh` | psg-hub-qa-demo | A thin, largely empty copy. Riverside there has **0** ads accounts and **0** analytics snapshots. |

A preview pointed at `ncksoeindpscpohembuh` signs in fine and then renders empty
Analytics and Ads panels — which reads exactly like missing demo data. It isn't.
The preview check now records `checks.backend` (expected vs. observed project)
and fails when they differ, so this can't be misread again.

Prefer `.env.test.local` over `.env.preview.local`: both name the same project
today, but two files holding the same credentials is how they drift apart.

`NEXT_PUBLIC_*` values are inlined at **build time**, so correcting a Vercel env
var does not change an existing deployment. Repointing a preview requires a
**redeploy**; re-running QA against the same URL will keep failing.

## Running a preview check

```bash
cd apps/psg-hub
node e2e/psg-2928-preview-check.mjs                       # uses PREVIEW_BASE_URL
PREVIEW_BASE_URL=https://some-other.vercel.app node e2e/psg-2928-preview-check.mjs
```

Evidence lands in `e2e/screenshots/psg-2928/` (`result.json` plus screenshots).

### Browser dependencies

The bundled Chromium needs system libraries that are not installed by default.
If it fails with `error while loading shared libraries: libnspr4.so`:

```bash
pnpm exec playwright install-deps chromium     # needs root
```

## Reading a login failure honestly

`result.json` records **`loginFailure.reason`**. Read it before escalating —
these mean very different things, and only one of them is an access problem:

| `reason` | What it means | Who fixes it |
|---|---|---|
| `form-not-interactive` | The page never hydrated; nothing was submitted. | QA / harness |
| `empty-submission` | A sign-in request went out **with no email**. | QA / harness |
| `credentials-rejected` | The server refused fully-populated credentials. | Account owner |
| `no-redirect` | Sign-in succeeded but the app never reached `/dashboard`. | Builder |

If sign-in passes but panels are empty, check `checks.backend.matches` before
concluding anything about demo data.

`loginFailure.authCalls[].emailPresent` is the raw signal: `false` means the form
was submitted empty and the credentials were never actually tested.

### The PSG-2928 false alarm

A retest reported the Riverside demo account as broken, citing Supabase 400
`"missing email or phone"`. That message means the request body had **no email
at all** — a rejected password returns `"Invalid login credentials"` instead.

The cause was in the check, not the account: it navigated with
`waitUntil: "domcontentloaded"` and filled the form immediately, so React
hydrated *after* the fill and reset both controlled inputs to their empty
initial state. The click then submitted nothing. The demo account was healthy
throughout.

`e2e/_sign-in.mjs` now waits for React to attach, confirms the typed values
survived, and classifies failures using the table above.
