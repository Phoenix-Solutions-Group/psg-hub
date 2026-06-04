# Enterprise Plan Audit Report

**Plan:** .paul/phases/05-reputation-ads/05-02-PLAN.md
**Audited:** 2026-04-19
**Verdict:** Conditionally acceptable → enterprise-ready after upgrades applied

---

## 1. Executive Verdict

**Conditionally acceptable.** The original plan had a sound architectural spine (DB + adapter + API + UI, single concern) but was not audit-defensible for a regulated operating environment. Nine release-blocking gaps were identified around prompt injection, audit trail, idempotency/concurrency, authorization granularity, rate limiting, observability, output safety, and testing. All must-have and strongly-recommended findings have been applied automatically. Post-upgrade, the plan is approvable for APPLY.

Would I sign my name to the post-upgrade plan for production? Yes, assuming the tests pass and runtime verification occurs once secrets are available. The original plan as first written? No.

---

## 2. What Is Solid (Do Not Change)

- **Scope honesty on automated posting.** The decision to ship draft→approve→copy-to-clipboard without auto-posting is correct. Yelp has no reply API; Google GBP needs OAuth deferred in 02-05. The original plan did not pretend the posting integration exists — this avoids a class of failure that often bites AI products (claiming to "post" when the last mile is manual).
- **Boundaries on prior work.** Migrations 001/002/003 marked immutable; 05-01 adapter files locked. This protects the 05-01 output from regression.
- **Prompt caching design.** System prompt marked as the stable cache target, review body kept out of the cache surface. Correct for cost and latency.
- **Service-role client for ingestion-style writes.** Continuing the 05-01 pattern keeps RLS on for user queries while allowing controlled cross-tenant writes. Do not change.
- **Adapter registry re-use.** Plan consumes the existing `ReviewAdapter` types rather than forking — maintains symmetry with 05-01.

---

## 3. Enterprise Gaps / Latent Risks

The following non-obvious risks were identified in the original plan:

1. **Prompt injection.** Review bodies are untrusted user-generated text flowing directly into an LLM prompt. A malicious reviewer could include instruction-like text ("Ignore previous instructions and...") and steer the model. Original plan had no defense.
2. **Audit trail insufficient.** Only current body stored. `version` counter incremented but prior content overwritten. Regulated review asks "What did the AI originally produce before the human edited it?" — answer was unrecoverable.
3. **Idempotency / cost exposure.** No rate limit. Double-click on "Regenerate" = two LLM calls = two charges. No per-user, per-shop, or per-review ceiling.
4. **State machine unenforced.** Status enum existed but no API-layer constraint. `approved → draft` transitions, or edits on `approved`, silently allowed depending on caller.
5. **Concurrency race.** Two users approving simultaneously both succeed. No optimistic lock. `approved_by` reflects last writer, not first.
6. **Tenancy check RLS-only.** Original plan leaned on RLS to return empty rows for cross-tenant queries. RLS filters rows; it does not return 403. A subtle implementation error could invoke the LLM before the select result is checked.
7. **Authorization granularity.** Any `shop_member` could approve. Existing `shop_role` enum (owner/manager/viewer) not leveraged. Viewer-level users should not approve outbound content.
8. **Observability gap.** Plan explicitly deferred observability. For LLM calls in a regulated environment this is unacceptable: post-incident reconstruction, cost attribution, abuse investigation all fail without structured logs.
9. **Output safety.** Model can produce admissions of liability, insurance promises, PII echoes, or defamatory content. Plan had no post-generation check. System prompt instructions alone are not a control — they are a suggestion to a probabilistic model.
10. **Timeout + error handling missing.** No AbortController, no timeout, no typed error paths. Anthropic outage could stall requests indefinitely.
11. **a11y gap.** Modal with no ARIA, no focus trap, no ESC handling. Not enterprise-grade.
12. **No tests.** Plan specified only "manual smoke test." Release bar requires automated coverage for auth boundary, rate limit, state transitions, safety regex.
13. **Secret hygiene.** `ANTHROPIC_API_KEY` added to `.env.example` with no rotation note.
14. **Append-only constraint reliance on app code.** Version history, if added in app code only, is trivially bypassed by anyone with service-role access. Must be DB-trigger enforced.

---

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | Prompt injection defense | `<acceptance_criteria>` AC-5; Task 2 prompts.ts action | Added explicit "UNTRUSTED USER INPUT" boundary in system prompt; hard-constraint list (no fault admission, no insurance promises, no PII, no disparagement); test fixture required |
| 2 | Append-only audit trail | Task 1 action (new `review_response_versions` table); DB trigger | New table; REVOKE UPDATE/DELETE; trigger on INSERT/UPDATE of body auto-inserts snapshot. AC-2 strengthened, AC-8 added. |
| 3 | Explicit tenancy check | Task 2 + Task 3 action; AC-4 strengthened | SELECT shop_id from review + SELECT role from shop_members BEFORE any LLM call. 403 returned explicitly, not via empty RLS result. |
| 4 | State machine enforcement | Task 3 action; AC-7 added; DB check constraints | API enforces allowed transitions (draft→approved, draft→rejected, draft→draft, approved→draft); invalid → 409. DB constraint: status='approved' requires approved_by + approved_at. |
| 5 | Rate limiting + cost governance | Task 2 action (new `rate-limit.ts`); AC-6 added | 10 drafts/review/hour + 100 calls/shop/day. Enforced BEFORE Anthropic call. Rate-limited attempts logged. |
| 6 | Observability (LLM call log) | Task 1 (new `llm_call_log` table); Task 2 action (new `logging/llm-call.ts`); AC-8 added | Every call logged: user_id, shop_id, review_id, model_id, tokens, latency, result, error_code. Every result type captured including rate_limited and safety_blocked. |
| 7 | Output safety guardrails | Task 2 (new `safety.ts`); AC-9 added; Task 1 schema (safety_flags, safety_overridden, safety_overridden_by) | Regex post-generation scan. Critical patterns (admission, promise, PII) block approval unless `override_safety` action invoked by owner role with audit. |
| 8 | Role-gated approval | Task 3 action; AC-3 strengthened | Approve requires owner or manager. Override requires owner. Viewer cannot approve. |
| 9 | Timeout + typed error paths | Task 2 action | AbortController with 20s timeout. Timeout → 504 + log `timeout`. Other errors → 500 + log `error`. |

### Strongly Recommended

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | Optimistic concurrency | Task 3 action; AC-7; API contract | `expectedVersion` required on approve-response. UPDATE ... WHERE version=:expectedVersion; mismatch → 409. |
| 2 | Prompt reproducibility | Task 1 schema (prompt_version column); Task 2 (PROMPT_VERSION const) | Every response row stores the prompt version used, enabling audit reconstruction. |
| 3 | a11y on modal | Task 3 action | `role="dialog"`, `aria-modal`, focus trap, ESC, return-focus-on-close. |
| 4 | Automated test coverage | New Task 4 | Unit tests on prompts + safety; integration tests on routes asserting auth boundary, rate-limit, state machine, optimistic lock, role gate. |
| 5 | Secret rotation note | Task 2 (.env.example comment) | Comment indicating quarterly rotation expectation. |

### Deferred (Can Safely Defer)

| # | Finding | Rationale for Deferral |
|---|---------|----------------------|
| 1 | Full pre-send PII redaction/DLP | Plan relies on post-generation regex + human approval. Full DLP layer deserves its own plan with proper tokenizer and allowlist policy, not a rushed add-on. Called out explicitly in `<boundaries>`. |
| 2 | Model fallback chain (Haiku 4.5 → Sonnet fallback on 5xx) | Pinned model is acceptable for launch. Fallback design touches cost policy and prompt re-validation per model — a separate plan. |
| 3 | UI for inspecting llm_call_log + version history | Admin tooling is not user-facing in 05-02. DB tables and service-role access sufficient for operators. Add in Phase 7 (intelligence/scale) or a dedicated admin plan. |

---

## 5. Audit & Compliance Readiness

**Post-upgrade:**

- **Defensible audit evidence.** `review_response_versions` captures every body change with actor, source, model_id, prompt_version, timestamp. Append-only enforced at DB layer (REVOKE + trigger). `llm_call_log` captures every call attempt with token counts for cost attribution and abuse reconstruction.
- **Silent failure prevention.** Every API error path (auth, tenancy, rate-limit, safety-block, timeout, upstream error) writes to `llm_call_log`. Nothing is lost to stdout.
- **Post-incident reconstruction.** Given an incident timestamp, operator can: SELECT llm_call_log by window → find call → join to review_response_versions by response_id → replay prompt_version + original body. Full reproducibility.
- **Ownership and accountability.** `created_by`, `approved_by`, `safety_overridden_by` fields identify actors. Role gate means only owners can override safety flags — explicit, not accidental.

**Residual risk:** The post-generation regex-only safety check is a necessary-but-not-sufficient control. A determined adversarial input could produce unsafe output that misses the regex surface. This is mitigated by the mandatory human approval gate — approval is the backstop, not the regex. Called out as an explicit scope limit.

---

## 6. Final Release Bar

**Before this plan ships:**

- All 4 tasks complete with Task 4 tests green
- Migration 004 applied cleanly; versions append-only verified; check constraints enforced
- Cross-tenant regression test passing (no LLM invocation on 403 path)
- Rate-limit test passing (counter enforced before call)
- Keyboard-only walk of the modal (Tab/ESC/focus return) documented in SUMMARY
- ANTHROPIC_API_KEY provided by user (runtime verify blocker)

**Residual risks if shipped post-upgrade:**

- Adversarial prompt-injection variants that evade the regex-plus-human backstop. Risk capped by mandatory approve step. Acceptable for launch.
- Cost overrun if rate-limit thresholds are set too loosely — operator tuning needed post-launch.
- Anthropic data retention: calls go to Anthropic. Default retention policy applies unless Zero Data Retention (ZDR) is enabled on the account. Recommend confirming before handling sensitive shop data beyond public reviews.

**Sign-off:** Would I sign my name to this system post-upgrade? Yes, contingent on the 4-task plan executing as written and the pending user-supplied secrets arriving before any real traffic.

---

**Summary:** Applied 9 must-have + 5 strongly-recommended upgrades. Deferred 3 items with documented rationale.
**Plan status:** Updated and ready for APPLY.

---
*Audit performed by PAUL Enterprise Audit Workflow*
*Audit template version: 1.0*
