---
phase: 19
slug: secure-document-review
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7, Supabase SQL tests, Playwright 1.60.0, axe 4.11.3, converter fixture self-check |
| **Config file** | `vitest.config.ts`, `playwright.config.ts`, `e2e/global.setup.ts`; phase SQL and converter entrypoints added in Wave 0 |
| **Quick run command** | `pnpm test -- src/lib/document-review` |
| **Full suite command** | `pnpm test && supabase db reset --local && pnpm test:e2e -- e2e/document-review.spec.ts e2e/document-review-accessibility.spec.ts` |
| **Estimated runtime** | Quick checks under 30 seconds; full local gate under 15 minutes after fixtures exist |

## Sampling Rate

- **After every task commit:** Run the narrowest affected Vitest, SQL, converter, or Playwright check.
- **After every plan wave:** Run `pnpm test`, local migration/RLS tests, and the relevant converter corpus; UI waves also run targeted Playwright.
- **Before phase verification:** Run the full suite, production build, malicious-file corpus, authenticated and guest E2E, keyboard-only/axe checks, and zero-production-mutation proof.
- **Max feedback latency:** 30 seconds for ordinary task checks.

## Requirement Verification Map

| Requirement | Secure behavior | Test type | Automated command | File exists | Status |
|-------------|-----------------|-----------|-------------------|-------------|--------|
| SDR-01 | Capability-gated create and allowlisted upload | Route + E2E | `pnpm test -- src/app/api/document-reviews/__tests__/upload.test.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-02 | Validate before persistence; private inert artifact only | Converter + storage | `pnpm test -- src/lib/document-review/__tests__/upload.test.ts` plus converter corpus | ❌ Wave 0 | ⬜ pending |
| SDR-03 | Assigned auth user or digest-only expiring guest | Unit + RLS + E2E | `pnpm test -- src/lib/document-review/__tests__/tokens.test.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-04 | Exact-resource access; no enumeration or direct object access | Route + SQL + E2E | `pnpm test -- src/lib/document-review/__tests__/auth.test.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-05 | Draft pin mutations; locked after submit | Unit + RPC + E2E | `pnpm test -- src/lib/document-review/__tests__/comments.test.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-06 | Stable normalized coordinates at resize and zoom | Unit + Playwright | `pnpm test -- src/lib/document-review/__tests__/coordinates.test.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-07 | Atomic immutable snapshot and deduped notice | SQL/RPC + route | `pnpm test -- src/lib/document-review/__tests__/submission.test.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-08 | Document-order comments and bidirectional focus jump | Component + E2E | `pnpm test:e2e -- e2e/document-review.spec.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-09 | Reopen generation and immutable version history | SQL/RPC + E2E | Local SQL suite plus document-review E2E | ❌ Wave 0 | ⬜ pending |
| SDR-10 | Token, IDOR, malicious file, and HTML-isolation defenses | Unit + converter corpus | `pnpm test -- src/lib/document-review` plus converter corpus | ❌ Wave 0 | ⬜ pending |
| SDR-11 | Keyboard pin workflow, focus, relationships, axe | E2E + axe | `pnpm test:e2e -- e2e/document-review-accessibility.spec.ts` | ❌ Wave 0 | ⬜ pending |
| SDR-12 | Local schema/RLS proof; production untouched | Migration + SQL | `supabase db reset --local` plus phase SQL tests | Harness exists; tests ❌ Wave 0 | ⬜ pending |

## Wave 0 Requirements

- [ ] `src/lib/document-review/__tests__/tokens.test.ts`
- [ ] `src/lib/document-review/__tests__/auth.test.ts`
- [ ] `src/lib/document-review/__tests__/coordinates.test.ts`
- [ ] `src/lib/document-review/__tests__/submission.test.ts`
- [ ] `supabase/tests/document_review_rls.sql`
- [ ] `workers/document-converter/` with pinned conversion image, deterministic fixtures, and malicious corpus
- [ ] `e2e/document-review.spec.ts`
- [ ] `e2e/document-review-accessibility.spec.ts`
- [ ] Vercel Sandbox entitlement and deny-all custom-image smoke
- [ ] Docker available for local Supabase and converter-image checks

## Security Fixture Corpus

- Valid minimal PDF, DOCX, and self-contained HTML must normalize deterministically.
- Extension/signature mismatches, malformed or encrypted PDFs, invalid OOXML, ZIP bombs, and 101-page outputs must be rejected without Storage writes.
- HTML scripts, event attributes, remote assets, fetch/WebSocket calls, and `file://` references must execute zero active behavior and make zero successful network requests.
- Converter timeouts, crashes, and invalid manifests must leave no persistent object or version row.

## Manual-Only Verifications

| Behavior | Requirement | Why manual | Test instructions |
|----------|-------------|------------|-------------------|
| Representative PSG document fidelity | SDR-02 | Business acceptability cannot be fully asserted from structure | Compare approved PDF, DOCX, and HTML fixtures against normalized page output at desktop and mobile widths. |
| Sandbox entitlement and cost acceptance | SDR-02, SDR-10 | Account capability and commercial approval are external | Run the isolated converter smoke in a non-production environment and record availability, region, duration, and estimated cost before implementation proceeds past Wave 0. |

## Validation Sign-Off

- [ ] Every planned task has an automated check or explicit Wave 0 dependency.
- [ ] No three consecutive tasks lack automated verification.
- [ ] Wave 0 covers every missing test reference.
- [ ] No watch-mode flags appear in plan verification commands.
- [ ] Ordinary feedback latency remains under 30 seconds.
- [ ] `nyquist_compliant: true` is set after the checker confirms plan coverage.

**Approval:** pending plan verification
