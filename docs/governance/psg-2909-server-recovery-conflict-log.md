# PSG-2909 Server Recovery Conflict Log

## Bottom line

The stranded BSM branch was merged into current `origin/main` on the isolated
`recovery/psg-2909-server` branch. All 107 conflicts are resolved. Current
main was retained for every conflicted file because those paths already contain
the recovered feature plus later accepted fixes. Non-conflicting work from the
stranded branch remains included by the merge.

This choice protects the current customer review flow, monthly-report safeguards,
shop access checks, webhook handling, production history, and database migration
order. No production system was changed.

## Files resolved

- 31 server routes and route tests covering content review, lead capture,
  operations administration, monthly reports, production documents, shop
  switching, authentication callbacks, and the Pipedrive webhook.
- 35 backend library and test files covering board briefings, BSM approvals and
  review workspaces, claim integrity, operations, production, reporting, and
  Pipedrive billing checks.
- 3 Supabase files: local configuration, the review-workspace processing
  migration, and the schema manifest.
- 3 server/release configuration files: environment-variable examples, the
  application package manifest, and the release retest runbook.
- 35 browser/UI/workflow conflicts were retained from current main so Nora's
  separately reviewed UI/demo batch can be applied without reviving older
  customer-facing versions.

## Behavior kept

- Current main wins only where both branches changed the same path. This keeps
  fixes accepted after the stranded branch diverged.
- The merge still includes every cleanly merging file from the stranded branch.
- Applied database migration names and ordering are unchanged; no migration was
  renamed, removed, or reordered.
- Append-only audit, approval, production, webhook, import, and idempotency
  history was not removed as a conflict shortcut.

## Product decisions

No unresolved product decision was found in this batch. Customer-facing visual
choices remain owned by Nora's separate UI/demo recovery task and require the
normal review gates before any preview or production release.

