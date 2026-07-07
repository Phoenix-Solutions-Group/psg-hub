# Staff SOP — Attaching files to WHM monthly tasks (Pipedrive)

**One-line rule:** Keep the file in **Google Drive**, then **paste the Drive share link into the task's description**. Do not hunt for a "attach file to task" button — Pipedrive does not have one.

_Source of truth: [PSG-610](/PSG/issues/PSG-610#document-plan) §2d · implemented for [PSG-642](/PSG/issues/PSG-642). Applies to every task on a "Monthly Service — …" project._

---

## Why (30-second version)

Pipedrive **cannot attach a file to an individual task** — that is a Pipedrive product limitation, not a bug in our setup, and it is not on their roadmap. This is fine: the files we attach on monthly work (analytics reports, customer-comment graphics) already live in **Google Drive**, which we already use. So the standard is a **link**, not an upload.

## The default flow (use this ~99% of the time)

1. Put the file in the client's Google Drive folder (where it already goes).
2. In Drive, click **Share → Copy link** (make sure the link's access is set so the intended people can open it).
3. Open the task in the Pipedrive monthly project.
4. Paste the link into the task's **Description** box. Add a word of context, e.g.
   `March analytics report: https://drive.google.com/…`
5. Save. Done — the link is now on the task for anyone working that step.

That's it. The link lives on the task, travels with it, and is visible to everyone on the project.

## The rare exception — a file that must physically live in Pipedrive

If a file genuinely has to sit inside Pipedrive (not just be linked), attach it at the **whole-project level** instead of the task:

- Open the **project** (not the task) → **Files** / attachments area → upload there.
- Note in the relevant task's description which project-level file it refers to.

Use this only when a link truly won't do. The Drive-link default is faster and is how the team already works.

---

## Technical detail (for the team)

The recurrence engine and our Pipedrive client already support both paths — no manual API calls needed for normal use, but here is what backs the SOP:

- **Task description is writable** via the thin v2-Tasks adapter:
  `PATCH /api/v2/tasks/{id}` → `PipedriveProjectsClient.updateTask(taskId, { description })`
  (see `projects.ts`). This is the one place a beta-v2 field change would be fixed.
- **Project-level file attach** for the rare true-file case:
  `POST /api/v1/files` (multipart, `file` + `project_id`) →
  `PipedriveProjectsClient.attachProjectFile({ projectId, fileName, content })`.
- The v2 Tasks API is still **beta**; both calls are isolated in `projects.ts` so a field or
  endpoint rename is a one-line, one-file fix.
- Secret hygiene: the Pipedrive token rides only in the query string and never appears in
  logs or error messages (same discipline as the rest of the client).
