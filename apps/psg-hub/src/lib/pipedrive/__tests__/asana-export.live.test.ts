import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { summarizeExport, createExportSource, dryRunExportProject } from "../asana-export";

// PSG-644 — LIVE runner over the real Asana domain export. Skipped by default; it only runs
// when the operator points it at the actual export file, so no fixture is needed and no CI
// run depends on a file that is not in the repo:
//
//   ASANA_EXPORT_FILE=/srv/psg/backups/domain_export_...json.gz \
//     pnpm --filter psg-hub exec vitest run src/lib/pipedrive/__tests__/asana-export.live.test.ts
//
// It gunzips + parses the file, prints a per-client fleet summary (open vs archived), then
// dry-runs the largest client so the operator/QA can eyeball "exactly what would be created"
// straight off the export — the acceptance-criteria dry-run, with ZERO writes and no token.
// Set ASANA_EXPORT_PROJECT=<gid> to dry-run a specific client instead of the largest.

const file = process.env.ASANA_EXPORT_FILE;
const run = file ? describe : describe.skip;

// Lazy — `describe.skip` still evaluates this body to collect its (skipped) tests, so the
// file must NOT be read until an `it` actually runs (only when ASANA_EXPORT_FILE is set).
function loadRoot(): unknown {
  const buf = readFileSync(file as string);
  const json = file!.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(json);
}

run("Asana domain export — live fleet summary + pilot dry-run", () => {
  it("summarizes the fleet (open to migrate vs closed to archive)", () => {
    const root = loadRoot();
    const { projects, totalOpen, totalClosed } = summarizeExport(root);
    // eslint-disable-next-line no-console -- this spec's whole purpose is the printed report
    console.log(
      `\nAsana export — ${projects.length} clients · ${totalOpen} open (migrate) · ${totalClosed} closed (archive)\n` +
        projects
          .slice(0, 40)
          .map((p) => `  ${p.gid.padEnd(20)} ${String(p.openTaskCount).padStart(5)} open  ${String(p.closedTaskCount).padStart(6)} closed  ${p.name}`)
          .join("\n"),
    );
    expect(projects.length).toBeGreaterThan(0);
    expect(totalOpen + totalClosed).toBeGreaterThan(0);
  });

  it("dry-runs one pilot client with zero writes", async () => {
    const root = loadRoot();
    const source = createExportSource(root);
    const projects = source.listExportProjects();
    const target = process.env.ASANA_EXPORT_PROJECT
      ? projects.find((p) => p.gid === process.env.ASANA_EXPORT_PROJECT) ?? projects[0]
      : projects[0];
    const result = await dryRunExportProject(source, target.gid, { clientLabel: target.name });

    // eslint-disable-next-line no-console -- printed evidence for QA spot-check
    console.log(
      `\nPilot dry-run — ${target.name} (${target.gid}): would create ${result.openTaskCount} tasks, archive ${result.archivedCount}, created ${result.createdCount} (must be 0)\n` +
        result.tasks
          .slice(0, 25)
          .map((t) => `  ${t.parentAsanaGid ? "  └ " : ""}${t.title}  [asana:${t.asanaGid}]  due=${t.dueDate ?? "-"} assignee=${t.assigneeId ?? "-"}`)
          .join("\n"),
    );

    expect(result.dryRun).toBe(true);
    expect(result.createdCount).toBe(0);
    expect(result.openTaskCount).toBeGreaterThanOrEqual(0);
  });
});
