# CCC Secure Share — Phase 3: Onboarding & Consent UX (design spec)

**Issue:** PSG-256 (Phase 3) · **Track:** CCC Secure Share (plan PSG-174) · **Owner:** Ada (CTO)
**Status of this doc:** design — *unblocked and authored now*. Production wiring is gated on
Phase 0 (PSG-251, CCC dashboard docs) and Phase 1 (PSG-252, `ccc_accounts`).

> Per the plan: *"Design can start now; the exact handshake firms up once Phase 0 (PSG-251)
> delivers the CCC dashboard docs."* This spec is built against the **CIECA BMS** seam and the
> documented CCC ONE export scope. Every place the real CCC handshake could differ is flagged
> **⚠ PHASE-0 FIRM-UP** so the build threads through a single seam, not a rewrite.

---

## 0. Goal & acceptance (restated)

A body shop can **self-enable BSM on their side (in CCC ONE)**, PSG **approves the connection**
on our side, and **connection status is visible end-to-end** for both parties. The shop can see
**exactly what data we receive** (the scope approved in Phase 0) before and after connecting.

Acceptance (from PSG-256):
1. A shop can self-enable and we approve, with status visibility end-to-end.
2. Flows reviewed against the real CCC handshake once Phase 0 docs land.

---

## 1. Surfaces & placement

Two audiences, two surfaces. We do **not** build a screen inside CCC ONE — the shop-side enable
happens in CCC's own dashboard; we own the *instructions*, the *approval*, and the *status*.

| Surface | Audience | Route | Auth gate | New? |
|---|---|---|---|---|
| **A. Connect BSM (per-shop)** | Shop user | `/ops/companies/[id]` → **Integrations** section, "CCC Secure Share" card | ops staff acting for the shop *(see §6 — shop-self-serve portal is a Phase-3.5 option)* | extends existing page |
| **B. Connection approval queue** | PSG superadmin | `/ops/admin/integrations/ccc` | `psg_superadmin` (matches metered/privileged ops surfaces, e.g. `/ops/intel`) | **new route** |
| **C. Data-scope / consent panel** | Shop user (+ visible to ops) | shared component rendered in A and B | n/a (presentational) | **new component** |

Rationale for placement:
- The per-shop record already lives at `/ops/companies/[id]` (employees, programs, import). A
  shop's CCC connection is a property *of that shop*, so the connect card belongs there next to
  the other per-shop integrations — no orphan route.
- The approval queue is a cross-shop PSG-staff workflow (like a moderation inbox), so it sits
  under `/ops/admin` with the other superadmin tools and is added to `OPS_NAV` as a
  `superadminOnly` item to match the `/ops/intel` precedent (nav visibility mirrors the route gate).

---

## 2. Connection state machine (the contract)

A single per-shop status drives every surface. This is the canonical state set the UI renders and
the field Phase 1 must expose on `ccc_accounts` (see §5).

```
            shop enables BSM in CCC ONE                 PSG superadmin
            (CCC posts/handshakes to us)                clicks Approve
   ┌──────────┐   ──────────────────────►   ┌─────────┐  ──────────►  ┌───────────┐
   │ not_      │                             │ pending │               │ connected │
   │ connected │   ◄──────────────────────   │ _review │  ◄─────────   │           │
   └──────────┘     PSG declines / shop       └─────────┘   shop/PSG    └───────────┘
        ▲            cancels before approve         │        disconnects       │
        │                                           │ PSG declines             │ auth/data
        │                                           ▼                          ▼ error from CCC
        │                                      ┌──────────┐               ┌────────┐
        └───────── shop re-enables ────────────│ declined │               │ error  │
                                               └──────────┘               └────────┘
                                                                    (last_event_at stamps every
                                                                     transition; error carries a
                                                                     machine reason + human hint)
```

| State | Meaning | Primary CTA shown |
|---|---|---|
| `not_connected` | No CCC link initiated for this shop. | **"Get connection steps"** (opens A) |
| `pending_review` | Shop enabled on CCC side; awaiting PSG approval. | shop: *"Waiting on PSG"*; PSG: **Approve / Decline** |
| `connected` | Approved + receiving events. | **Disconnect**, **View scope** |
| `error` | Was connected; auth expired or last sync failed. | **Reconnect**, error detail |
| `declined` | PSG declined the request. | shop: reason + **Request again** |

Every state carries `last_event_at` (timestamptz) and the last event label, so both sides see a
fresh **"Last event: Workfile saved · 3 min ago"** style line. ⚠ PHASE-0 FIRM-UP: the exact set
of CCC handshake callbacks (does CCC notify us on shop-enable, or do we poll? is there a
webhook verification step?) firms up the `not_connected → pending_review` edge. The state set is
designed to absorb either: a push edge or a polled-discovery edge both land on `pending_review`.

---

## 3. Flows

### 3.1 Shop self-enable → PSG approve (happy path)

```
SHOP                              CCC ONE                  PSG-HUB (us)                 PSG STAFF
 │  opens "Connect BSM" card (A) │                          │                            │
 │ ───────────────────────────► reads data-scope (C),       │                            │
 │                               clicks "Get steps"          │                            │
 │  follows step list ─────────► enables BSM / Secure Share  │                            │
 │                               in CCC dashboard            │                            │
 │                                       │ handshake ───────►│ creates ccc_account row    │
 │                                       │  (push or poll)   │ status=pending_review      │
 │                                       │                   │ ──── appears in queue (B) ─►│
 │  card now shows "Waiting on PSG"      │                   │                            │ reviews:
 │                                       │                   │                            │ shop match,
 │                                       │                   │                            │ scope, PSGID
 │                                       │                   │ ◄──── clicks Approve ───────│
 │                                       │                   │ status=connected           │
 │  card shows "Connected ✓" + scope     │                   │ first events flow (Phase 2)│
```

### 3.2 PSG declines

PSG staff clicks **Decline** with a required reason (free-text, ≤280 chars). `status=declined`,
reason stored, `last_event_at` stamped. Shop card shows the reason and a **"Request again"** CTA
that returns the shop to the step list (back to `not_connected`).

### 3.3 Error / reconnect

A previously `connected` account whose CCC auth expires or whose last sync failed moves to
`error` (set by Phase 2 ingest / a Phase 4 health check, never by the UI). The shop card and the
queue both surface the human hint ("CCC authorization expired — re-enable Secure Share in CCC ONE
to restore the feed") and a **Reconnect** CTA that re-runs the step list. ⚠ PHASE-0 FIRM-UP:
whether reconnect needs a fresh shop-side action or a silent token refresh depends on CCC's auth
scheme (Phase 1 leaves the auth seam abstract for exactly this reason).

### 3.4 Disconnect

Either side can disconnect. Shop: **Disconnect** on the card (confirm dialog — note this stops the
data feed). PSG: **Revoke** in the queue. Both → `not_connected`, `last_event_at` stamped, and the
ingest credential is revoked (Phase 1/2 owns the credential teardown). No data is deleted; we stop
receiving new events.

---

## 4. Wireframes (low-fi)

### A. Per-shop "Connect BSM" card — state: `not_connected`

```
┌─ /ops/companies/[id] ─────────────────────────────────────────────┐
│  Acme Collision · PSGID 10428                          [Edit shop] │
│  ─────────────────────────────────────────────────────────────────│
│  Integrations                                                      │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ ◐ CCC Secure Share              status:  ○ Not connected   │    │
│  │ Live estimate & RO feed from CCC ONE — no weekly CSV.      │    │
│  │                                                            │    │
│  │ What we'll receive ▸  (expands the data-scope panel, C)    │    │
│  │                                                            │    │
│  │                       [ Get connection steps ]             │    │
│  └───────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### A′. "Get connection steps" — step list (modal / expanded panel)

```
┌─ Connect Acme Collision to BSM via CCC Secure Share ──────────────┐
│  Do this in your CCC ONE Total Repair Platform:                   │
│                                                                   │
│   1. Open CCC ONE → Configure → [⚠ exact menu path: PHASE 0]      │
│   2. Find "Secure Share" / partner apps                           │
│   3. Search for "Phoenix Solutions Group / BSM"                   │
│   4. Click Enable and approve the data scope shown below          │
│                                                                   │
│  ── What BSM will receive (read-only) ───────────────────────────│
│  [ data-scope panel, component C, inlined ]                       │
│                                                                   │
│  After you enable it in CCC, this card will show "Waiting on PSG" │
│  and our team approves within 1 business day.                     │
│                                            [ Close ]  [ Done ✓ ]   │
└───────────────────────────────────────────────────────────────────┘
```

### A″. Card — state: `pending_review` / `connected` / `error`

```
 pending_review                connected                     error
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│ ◐ CCC Secure Share   │      │ ◑ CCC Secure Share   │      │ ◍ CCC Secure Share   │
│ ⏳ Waiting on PSG     │      │ ✓ Connected          │      │ ⚠ Connection error   │
│ Enabled in CCC on     │      │ Last event:          │      │ CCC authorization     │
│ Jun 23, 2:14 PM.      │      │ Workfile saved ·     │      │ expired. Re-enable    │
│ We approve within 1   │      │ 3 min ago            │      │ Secure Share in CCC.  │
│ business day.         │      │ [ View scope ]       │      │ [ Reconnect ]         │
│ [ Cancel request ]    │      │ [ Disconnect ]       │      │ [ View scope ]        │
└──────────────────────┘      └──────────────────────┘      └──────────────────────┘
```

### B. PSG approval queue — `/ops/admin/integrations/ccc`

```
┌─ CCC Secure Share — Connections ──────────────────────  superadmin ─┐
│  Pending (2)   Connected (37)   Errors (1)   All                     │
│  ───────────────────────────────────────────────────────────────────│
│  PENDING REVIEW                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Acme Collision        PSGID 10428    CCC facility #88231     │    │
│  │ Enabled in CCC: Jun 23, 2:14 PM     Scope: estimates+RO ▸    │    │
│  │ ⚠ PSGID match: auto-matched on facility id (confidence high) │    │
│  │                          [ Decline… ]   [ Approve connection ]│    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ (unmatched) "Bob's Body" CCC #90011  ⚠ No PSGID match        │    │
│  │ Link to shop: [ search shops… ▾ ]                            │    │
│  │                          [ Decline… ]   [ Approve connection ]│    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  CONNECTED (excerpt)                                                  │
│  Riverside Auto · PSGID 10199 · Last event 8m ago        [ Revoke ]  │
│  Hill Country CARSTAR · PSGID 10233 · Last event 2h ago  [ Revoke ]  │
│  ⚠ Westgate Collision · PSGID 10301 · error 40m ago      [ Detail ]  │
└───────────────────────────────────────────────────────────────────────┘
```

Approve is **disabled** until the row is linked to a PSGID (no orphan connections — a connection
with no shop has nowhere to route ingested estimates). Unmatched rows force an explicit shop link.

### C. Data-scope / consent panel (shared component)

Content is grounded in the documented CCC ONE export scope (`docs/psg/ccc-guide/`) and the BMS
canonical mapping Phase 1 builds. ⚠ PHASE-0 FIRM-UP: the *exact* field set CCC grants is fixed by
the app category we register under in Phase 0 — this panel must render **the approved scope**, not
a hardcoded list. Phase 1 should expose the scope as data (`ccc_data_scope`) so this panel is
data-driven and updates if CCC changes the grant.

```
┌─ What BSM receives from your CCC ONE ─────────────────────────────┐
│  Only completed, delivered repair orders. We do NOT receive open  │
│  estimates, totaled vehicles, or your financial/accounting data.  │
│                                                                   │
│  ✓ Customer name & mailing address      (to send mail)            │
│  ✓ Vehicle year / make / model          (personalize the piece)   │
│  ✓ RO number & repair in/out dates      (timing & dedup)          │
│  ✓ Repair $ amount                      (segment & suppress)      │
│  ✓ Insurance company / pay type         (optional, if present)    │
│  ✓ Referral source / agent              (optional, recommended)   │
│                                                                   │
│  ✗ We never receive: open estimates, payment card / banking data, │
│    employee records, or any data outside the scope above.         │
│                                                                   │
│  Data is encrypted in transit and at rest. You can disconnect at  │
│  any time; that stops new data immediately.                       │
└───────────────────────────────────────────────────────────────────┘
```

---

## 5. Data the UI needs from Phase 1 (`ccc_accounts`)

This is the **interface contract** between Phase 3 (UI) and Phase 1 (PSG-252). The UI reads these;
it does not own writes for `connected`/`error` (ingest/health own those). Filed against PSG-252 so
the schema includes them — Phase 1 already owns `ccc_accounts`, this just names the columns the UI
binds to.

| Column | Type | Written by | UI use |
|---|---|---|---|
| `shop_id` | uuid (FK shops, nullable until matched) | approval / handshake | route + per-shop card |
| `ccc_facility_id` | text | handshake | queue match + display |
| `connection_status` | enum (`not_connected`,`pending_review`,`connected`,`error`,`declined`) | handshake/approval/ingest | drives all surfaces (§2) |
| `last_event_at` | timestamptz | ingest (Phase 2) | "last event" line |
| `last_event_label` | text | ingest (Phase 2) | "Workfile saved" |
| `enabled_at` | timestamptz | handshake | "Enabled in CCC on…" |
| `approved_by` / `approved_at` | uuid / timestamptz | approval | audit + display |
| `declined_reason` | text | approval | shop-facing reason |
| `error_reason` | text (machine) + derived hint | ingest/health | error card |
| `data_scope` | jsonb | Phase 0 → Phase 1 seed | drives panel C (data-driven, not hardcoded) |

All transitions write an `access_audit` row (reuse the existing audit pattern — see
`access-audit-viewer.tsx`). RLS: shop users see only their own row; superadmin sees all (mirror the
existing per-shop RLS used by intel/competitor tables).

---

## 6. Open decisions (flag to board / designer; not blocking design)

1. **Shop-self-serve portal vs ops-mediated.** This spec puts surface A inside `/ops` (PSG staff
   act *for* the shop), which ships fastest and matches today's reality (PSG runs the program for
   shops). A true shop-facing self-serve portal (shop logs in, connects themselves) is a larger
   lift (`psg-advantage-portal`). **Recommendation:** ship ops-mediated for Phase 3; treat
   shop-self-serve as Phase 3.5 once volume justifies it. The state machine & components are
   reused either way.
2. **Designer review.** No standalone UX agent on this track (per the issue). These low-fi flows
   should get a visual pass before the connected/error polish lands. Loop in the designer at the
   build review, not before — wireframes are enough to start implementation.
3. **Auto-approve trusted shops?** For shops already in good standing, an auto-approve toggle could
   skip the queue. Deferred — manual approval is the safe default for a new data pipe.

---

## 7. Decomposition (build issues — gated)

| Child | Owner | Scope | Blocked by |
|---|---|---|---|
| Connection-state UI components (card A + scope panel C, state-driven, mock data) | Nora | Build the presentational + state components against the §2 contract with fixtures; no live wiring. **Unblocked now.** | — |
| Approval queue route B + approve/decline/revoke actions | Ravi | `/ops/admin/integrations/ccc`, superadmin gate, nav entry, server actions writing `connection_status` + audit | Phase 1 (PSG-252) `ccc_accounts` |
| Live wiring + handshake edge + scope review | Ravi/Nora | Bind components to `ccc_accounts`, implement `not_connected→pending_review` edge, review flows vs real CCC handshake | Phase 0 (PSG-251) **and** Phase 2 (PSG-255) |

The first child (components against the contract) is genuinely unblocked and is the natural next
build step; the live ones carry blockers so they auto-resume when their dependencies land.

---

## 8. References

- Plan & track: PSG-174 (accepted `af49a3ce`). Phases 0→4 = PSG-251/252/255/256/257.
- CCC export scope: `docs/psg/ccc-guide/ccc-export-guide-psg-001.md`.
- Pattern precedents: `/ops/intel` (superadmin route + nav), `access-audit-viewer.tsx` (audit),
  `google_ads_accounts` (encrypted per-shop account + RLS — the model Phase 1 mirrors).
