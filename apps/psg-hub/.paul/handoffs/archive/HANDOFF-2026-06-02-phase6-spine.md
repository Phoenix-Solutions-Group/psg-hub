# PAUL Session Handoff

**Session:** 2026-06-02 (psg-hub, v0.2 Customer MVP / Phase 6 RBAC + RLS spine)
**Phase:** 6 of 8 — RBAC + RLS spine (v0.2 phase 1 of 3)
**Context:** Resumed psg-hub; reconciled stale PAUL state to the post-absorb reality; shipped 06-04 (reviews surface); authored 06-05 (spine close). Paused before 06-05 APPLY.

---

## Session Accomplishments

- **State reconcile (big):** discovered the project was absorbed into a new monorepo `Phoenix-Solutions-Group/psg-internal` (commits f8e5324, 0a630ae). Corrected STATE/PROJECT facts: remote `data`→`psg-internal`, branch `chore/phase-3-integrations`→`main`, design-system submodule GONE (vendored as 191 tracked font/asset blobs), Vercel gitLink=None. Submodule deploy-blocker (M3) proven structurally dead.
- **06-04 reviews surface reconcile — LOOP CLOSED + LIVE.** Repointed `reviews`→`review_items`, `shop_members`→`shop_users`, `review_id`→`review_item_id`; EXTENDed `review_responses` on shared prod with 11 governance cols + UNIQUE (migration `20260602170000`, advisor 0-new, 0 rows); deployed `vercel --prod` (dpl_BjgwCaH5JrQHccE8ZYkXhuneMEsg, hub.psgweb.me); proved draft→approve write path via synthetic roundtrip; 188 tests, build green. SUMMARY written.
- **06-05 spine-close PLAN authored** (re-scoped from ads stand-up → spine-completion + guard). Awaiting approval.
- **Pushed** origin/main in sync (Phase-3 architecture + psg-import HMAC-session security commits).

---

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| 06-04 = EXTEND `review_responses` (vs strip/hybrid) + app-side rename `review_id`→`review_item_id` | Live table lacked the app's shipped governance model; 0 rows = zero data risk | Migration adds 11 cols; version concurrency + safety override + approval attribution preserved |
| 06-04 reads stay on user-session client, no new RLS policy | `review_items`/`review_responses` already membership-clamped via `user_shop_ids()` | Defense-in-depth RLS; path-A default-deny posture intact |
| 06-05 = spine-completion + GUARD (NOT ads stand-up) | Ads needs encrypted-OAuth tables + is v0.3 ROADMAP scope; keep Phase 6 a true spine | Repoint + 1 small table + guards; defer Google Ads→v0.3, agents→v1.6, ingest→its milestone |
| Stand up `llm_call_log` in 06-05 | Grounding found reviews DRAFT path 500s on phantom `llm_call_log` (rate-limit throws) — a 06-04 gap | One small table closes a shipped-surface gap |
| M3 (git auto-deploy) handled as ops, not a plan | Absorb made it cheap; re-point is operator-gated prod config | Exact 3-step delta prepared; CLI `vercel --prod` works today |

---

## Gap Analysis with Decisions

### Reviews DRAFT path broken on phantom `llm_call_log`
**Status:** CREATE (in 06-05 Task 2)
**Notes:** `rate-limit.ts assertWithinLimits` reads `llm_call_log` and THROWS on error → draft-response 500s today. 06-04's raw-SQL roundtrip bypassed the route so it slipped through. 06-05 stands the table up.
**Reference:** `@src/lib/reviews/rate-limit.ts`, `@src/lib/logging/llm-call.ts`

### supabase-js PostgREST alias parsing not exercised (06-04)
**Status:** DEFER / low
**Notes:** raw SQL proved schema acceptance; the `body:draft_text`/`review_id:review_item_id` alias strings covered only by operator in-browser approval. First real data lands at ingest (06-05 guards ingest; data path = later milestone).

### Uncommitted prod state
**Status:** INTENTIONAL (commit at Phase 6 transition)
**Notes:** prod runs 06-04 code + migrations 163208/163210/163212/170000 while UNCOMMITTED to git. Repo cannot reproduce prod until 06-05 closes and the phase commit lands.

### Vercel M3 git auto-deploy re-point
**Status:** DEFER (operator-gated ops)
**Notes:** connect Vercel `psg-hub` → `psg-internal`/`main`, rootDir `apps/psg-hub`→`psg-hub/apps/psg-hub`, keep include-outside ON. No submodule grant needed.

---

## Open Questions

- None blocking. 06-05 awaits a simple approve (autonomous:false — the `llm_call_log` migration is the one prod write).
- Optional: do M3 re-point now (pull v0.3 reproducible-deploy forward) or stay CLI until v0.4 per ROADMAP.

---

## Reference Files for Next Session

```
@.paul/STATE.md
@.paul/phases/06-rbac-rls-spine/06-05-PLAN.md
@.paul/phases/06-rbac-rls-spine/06-04-SUMMARY.md
@.paul/phases/06-rbac-rls-spine/06-RESEARCH-DOSSIER.md
@.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md
@src/lib/auth/shop-access.ts
@src/lib/reviews/rate-limit.ts
```

---

## Prioritized Next Actions

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Approve + `/paul:apply .paul/phases/06-rbac-rls-spine/06-05-PLAN.md` (spine close + llm_call_log) | M |
| 2 | Phase 6 transition on 06-05 close — evolve PROJECT/ROADMAP, **git commit the whole phase** (first VCS landing) | S |
| 3 | (optional) Vercel M3 git-deploy re-point — operator-gated prod config | S |
| 4 | After Phase 6 → `/paul:plan` Phase 7 (tier gating + shop switcher) | — |

---

## State Summary

**Current:** Phase 6 — 4/5 plans LOOP CLOSED (06-01..06-04 ✅); 06-05 PLAN created, awaiting approval. Loop: PLAN ✓ / APPLY ○ / UNIFY ○.
**Next:** approve 06-05 → APPLY → Phase 6 transition (commits the phase).
**Resume:** `/paul:resume` then read this handoff.

---

*Handoff created: 2026-06-02*
