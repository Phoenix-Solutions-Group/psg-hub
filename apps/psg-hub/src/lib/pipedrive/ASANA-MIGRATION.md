# Asana → Pipedrive migration (PSG-644)

One-time, per-client tool that copies a body shop's **still-open** website-maintenance
work out of Asana into their new Pipedrive project. Finished/historical work is **archived
to a CSV**, never re-created.

## Layers

| File | Job |
| --- | --- |
| `asana-client.ts` | Read-only Asana API client (PAT in `Authorization: Bearer` header). Live source. |
| `asana-export.ts` | Parses an Asana **domain-export JSON** into the same read interface — offline fallback when a live PAT isn't available. |
| `asana-migration.ts` | Pure planner: open/closed split, one-level subtask flatten, comment→description, `[asana:<gid>]` marker, history CSV. |
| `asana-migrate.ts` | Orchestrator (`migrateClientOpenTasks`) — read → plan → write, dry-run + marker-guard. |
| `app/api/ops/pipedrive/asana-migrate/route.ts` | Agent/ops-runnable endpoint (server-side tokens, timing-safe secret auth). |

## Guarantees (enforced in `asana-migrate.ts`)

- **Dry-run** (`action: "dry-run"`) — reads + plans + builds the archive, makes **zero**
  Pipedrive writes. Returns exactly what *would* be created.
- **Idempotent + marker-guarded** — before writing, reads the target project's existing
  tasks, extracts their `[asana:<gid>]` markers, and skips any open task already migrated.
  A re-run never double-writes. (Refuses to run if the Pipedrive client can't list tasks.)
- **Open-only + archive** — only open tasks are created; closed tasks are returned as a
  history CSV string for upload to Drive.

## Running it (deployed ops route)

Requires three env vars set in Vercel (all SENSITIVE, never returned/logged):
`ASANA_MIGRATION_SECRET` (bearer for this route), `ASANA_ACCESS_TOKEN` (read),
and the existing `PIPEDRIVE_API_TOKEN` (write).

```bash
# 1) DRY-RUN — prove the plan before any write
curl -sS -X POST "$HUB/api/ops/pipedrive/asana-migrate" \
  -H "Authorization: Bearer $ASANA_MIGRATION_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"action":"dry-run",
       "asanaProjectGid":"<asana-project-gid>",
       "pipedriveProjectId":<pipedrive-project-id>,
       "clientLabel":"<Shop Name>",
       "assigneeMap":{"<asanaUserGid>":<pipedriveUserId>}}'

# 2) MIGRATE — real run (idempotent). Same body, action:"migrate".
```

The response `result` carries `openTaskCount`, `createdCount`,
`skippedAlreadyMigratedCount`, `archivedCount`, per-task `tasks[]` evidence
(assignee/due/parent), and `historyCsv` (the archive to upload to Drive).

### assigneeMap (Asana user gid → Pipedrive user id)

The migration leaves any unmapped assignee **unassigned** rather than guessing. Build the
map by matching users by email across the two systems. Asana WHM roster (as of 2026-07-07):

| Asana user | email |
| --- | --- |
| Brian Finn | bfinn@phoenixsolutionsgroup.net |
| Michele LaPorte | mlaporte@phoenixsolutionsgroup.net |
| Ryan George | rgeorge@phoenixsolutionsgroup.net |
| Tina Biancalana | Tina@phoenixsolutionsgroup.net |
| Gaurav Tripathi | gaurav@phoenixsolutionsgroup.net |
| Ramesh | ramesh@phoenixsolutionsgroup.net |
| Nicholas Schoolcraft | nick@phoenixsolutionsgroup.net |

Match each to the corresponding Pipedrive user id (from `listUsers()`), pass as `assigneeMap`.

## Offline fallback (domain export)

If a live Asana PAT is unavailable, `createExportSource(parsedExportJson)` yields the same
`AsanaReadClient`, so `migrateClientOpenTasks` runs unchanged against an export file. Use
`summarizeExport()` / `listExportProjects()` to pick pilot projects (largest open backlog
first). NOTE: the live API is preferred — it needs no large file transfer.

## Order of operations (per PSG-610 §3)

Pilot clients first ([PSG-646]), then batches ([PSG-648]). QA spot-checks data integrity
at the pilot gate ([PSG-647], Tess).
