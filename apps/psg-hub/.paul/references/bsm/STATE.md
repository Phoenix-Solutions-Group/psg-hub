# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-04-11)

**Core value:** Collision repair shops get continuous, data-driven marketing optimization without hiring agencies or learning marketing themselves.
**Current focus:** Phase 5 — Reputation and ads (starting with review ingestion)

## Current Position

Milestone: v0.1 Agent Engine MVP (v0.1.0)
Phase: 5 of 7 (Reputation and ads) — In progress
Plan: 05-05 COMPLETE — Phase 5 all plans shipped (pending transition: commits + PROJECT.md + ROADMAP update)
Status: Phase 5 COMPLETE at code level. Transition ceremony pending.
Last activity: 2026-04-19 — UNIFY complete for 05-05; Phase 5 (5/5) code-complete

Progress:
- Milestone: [██████████] 100% (phase 5 closed pending transition)
- Phase 5: [██████████] 100% (5 of 5 plans complete)

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [05-05 closed — Phase 5 complete pending transition]
```

### Skill Audit (05-04)
| Expected | Invoked | Notes |
|----------|---------|-------|
| /uncodixfy | ✓ | TierGateCard + banners plain style (no glassmorphism, no pills) |
| /frontend-design | ✓ | Reused Table/Button/Badge primitives; sidebar extension matches pattern |
| /humanizer | ✓ | UI copy active voice (Upgrade, Link Google Ads, Disconnect) |
| /brand | ✓ | PSG tokens via existing oklch vars; primary color discipline |

Status: All 4 required skills invoked ✓ (carry-over from session).

## Accumulated Context

### Decisions

| Decision | Phase | Impact |
|----------|-------|--------|
| Paperclip AI for orchestration | Init | All agent coordination flows through Paperclip |
| Agents as collaborative peers | Init | Any agent can invoke any other on demand |
| Sanity as content store | Init | Agent output lands in Sanity for review/publish |
| Node.js + PostgreSQL stack | Init | Piggyback on Paperclip's runtime |
| Tracy's as test client | Phase 1 | tracysbodyshop.com, Lincoln NE, full PSG access |
| Survey data as optional enrichment | Phase 1 | Not all shops have PSG Advantage data |
| Local deployment for Phase 2 | Phase 2 | Paperclip at localhost:3100, deploy to server later |
| Sanity project ID: 436nqu7v | Phase 2 | BSM content store in PSG org |
| Content review via Sanity Studio | Phase 2 | Primary approval mechanism for agent content |
| Reviews: Google + Yelp first, Facebook/Carwise deferred | Phase 5 | Facebook Graph gating + Carwise no-API → defer to 05-01b |
| 2026-04-19: Enterprise audit on 05-02-PLAN | Phase 5 | Applied 9 must-have + 5 strongly-recommended upgrades; deferred 3. Verdict: conditionally acceptable → enterprise-ready post-upgrade. See 05-02-AUDIT.md |
| 2026-04-19: Encryption scope carve-out for OAuth refresh tokens (Plan 05-03) | Phase 5 | Ads OAuth refresh tokens encrypt at Phase 5 (AES-256-GCM). Yelp/Places API keys remain deferred to Phase 6 per prior decision. Rationale: OAuth tokens authorize ad spend → exfil risk materially higher than simple API keys. |
| 2026-04-19: Enterprise audit on 05-03-PLAN | Phase 5 | Applied 11 must-have + 6 strongly-recommended upgrades; deferred 4. Verdict: conditionally acceptable → enterprise-ready post-upgrade. Key additions: tier gating (Performance $999/mo), budget ceiling ($500/day default), shop preflight (address/website/radius required), OAuth user-auth binding at callback, revoke-at-Google on disconnect, upsert-on-reconnect, key rotation map, last_error PII sanitization. See 05-03-AUDIT.md |
| 2026-04-19: Split original 05-04 into 05-04 + 05-05 | Phase 5 | Original 05-04 "Ads dashboard and Performance tier" was too large. 05-04 = billing + ads scaffold + link-account flow. 05-05 = campaigns UI (create/detail modals + metrics + sync). ROADMAP updated. |
| 2026-04-19: Enterprise audit on 05-04-PLAN | Phase 5 | Applied 5 must-have + 5 strongly-recommended upgrades; deferred 4. Verdict: conditionally acceptable → enterprise-ready post-upgrade. Key additions: post-upgrade grace banner (webhook latency race mitigation), popup-blocker detection, snapshot-and-diff polling, useEffect cleanup, env-var validation on checkout, multi-shop fallback (prefer owner), a11y on TierGateCard. See 05-04-AUDIT.md |
| 2026-04-19: Enterprise audit on 05-05-PLAN | Phase 5 | Applied 5 must-have + 5 strongly-recommended upgrades; deferred 4. Verdict: conditionally acceptable → enterprise-ready post-upgrade. Key additions: template drift-detection test (prevents hand-transcription rot), aria-live on sync status, metrics shape tolerance helper + tests, clickable-row Space preventDefault, sync error maps id→campaign name, soft-cap pagination footer, 2-decimal precision guard on budget input, stale-data hint in detail modal, delete confirm copy clarity, shared focus-trap helper + tests. See 05-05-AUDIT.md |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| Google Search Console OAuth | Plan 02-05 | S | Phase 5 or when ready |
| Google Business Profile OAuth | Plan 02-05 | S | Phase 5 (05-01 uses Places API for Google reviews) |
| Automated heartbeat scheduling | Plan 02-05 | M | When deploying to persistent server |
| Paperclip-to-Sanity approval gate wiring | Plan 02-04 | M | Phase 3 enhancement |
| Facebook Graph + Carwise review adapters | Plan 05-01 | M | 05-01b |
| Review source credential encryption | Plan 05-01 | M | Phase 6 |
| Reputation agent Paperclip wiring | Plan 05-01 | M | After 05-02 (now unblocked — next up) |
| Pre-send PII redaction / DLP | Plan 05-02 | M | Separate plan after MVP; regex-only in MVP |
| LLM model fallback chain (Haiku → Sonnet) | Plan 05-02 | S | Separate plan |
| Admin UI for llm_call_log + version history | Plan 05-02 | M | Phase 7 or dedicated admin plan |

### Infrastructure

| Service | Status | Location |
|---------|--------|----------|
| Paperclip server | Running | http://127.0.0.1:3100 |
| Embedded PostgreSQL | Running | port 54329 |
| Sanity (BSM project) | Active | Project 436nqu7v, dataset: production |
| SEMrush API | Connected | .env |
| BigQuery | Connected | .env |
| Firecrawl | Connected | .env |
| Yelp Fusion API | Not connected | Needs YELP_API_KEY |
| Google Places API | Not connected | Needs GOOGLE_PLACES_API_KEY |
| Anthropic API (Haiku 4.5) | Not connected | Needs ANTHROPIC_API_KEY (review response drafts) |
| Google Ads API (v20) | Not connected | Needs 7 env vars + Google Cloud OAuth app + developer token (Standard tier) + MCC + Performance-tier subscription per shop |

### Test Client

Tracy's Collision Center, tracysbodyshop.com, Lincoln NE. Sanity shop ID: 5ba4d383-171f-4591-baca-f5210d2a7c63.

## Session Continuity

Last session: 2026-04-24
Stopped at: Mid /paul:discuss Phase 6 — context presented, awaiting user answers on goals/scope/vendors.
Next action: Resume Phase 6 discussion (answer goals questions) → write CONTEXT.md → /paul:plan Phase 6. OR redirect to reconcile ROADMAP/PROJECT drift first.
Resume file: .paul/HANDOFF-2026-04-24.md
Git strategy: main (no WIP commit this pause; parent HEAD a158537, dashboard subrepo 31f8814)
Resume context:
- Phase 5 shipped (5/5 plans closed), transition ceremony still pending.
- ROADMAP.md stale — shows "4 of 7 complete" and 05-04/05-05 "not started". Actual: all 5 shipped.
- PROJECT.md stale — dated 2026-04-11, version 0.0.0 "Initializing", old Phase 0–5 numbering scheme. Needs refresh.
- Parent repo working tree has significant untracked drift (Phase 2/3/4 planning files, supabase/migrations/{001,002}, dashboard/ nested repo, CLAUDE.md, preview tooling). Prior handoff claimed "clean" — it is not. User declined WIP commit this pause.
- Phase 6 discussion queued: Email/SMS (SendGrid/Twilio) + BigQuery analytics + PSG Value Meter. Goals question posed with prompts re: vendor choice, TCPA/compliance, opt-outs, attribution schema, split scope.
- Runtime-verify blockers for Phase 5 still open (Stripe Performance price, Supabase link, Google Cloud OAuth app, Ads dev token, MCC, encryption keys, ANTHROPIC/YELP/PLACES API keys).

---
*STATE.md — Updated after every significant action*
