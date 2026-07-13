# Runbook: PSG Hub Release, Push, and Production Retest

Owner: Engineering release readiness is owned by Ada. QA signoff is owned by Tess. Production deployment confirmation is owned by the engineer who merges or hotfixes the change. Board retest requests are owned by Ada unless she explicitly hands them to another named owner.

Status: approved by Noelle for operations clarity on 2026-07-13; standard after merge to `main`.

Production project note: operators should look for the existing Vercel project currently named `psg-advantage-portal` for PSG Hub production deploys. The production domain is `hub.psgweb.me`. After the planned rename is completed, update this runbook and the pull request template to use the new Vercel project name `psg-digital/psg-hub`.

## Why This Exists

PSG Hub work is not ready for retest just because code was committed. A change is only ready for Nick, the board, or QA to retest after the exact code has reached the production deployment and a basic post-deploy check has passed.

Use this runbook for PSG Hub changes that affect production behavior, customer-facing behavior, board-facing testing, authentication, billing, data access, or any release-bound milestone.

## Plain-English Release States

| State | What it means | What it does not mean |
| --- | --- | --- |
| Committed | The change is saved in Git on one machine or branch. | It is not necessarily on GitHub, reviewed, merged, deployed, or live. |
| Pushed | The branch is on GitHub. | It is not necessarily merged into `main` or live in production. |
| Pull request ready | The change is visible for review with tests or checks named. | It is not approved or live. |
| Merged | The change is in the branch Vercel builds for production, currently `main`. | It is not live until the Vercel production deployment finishes successfully. |
| Deployed | Vercel built and published the commit for the current production project, `psg-advantage-portal`. | It is not ready for retest until the release owner confirms the expected behavior in production. |
| Ready for retest | Production is running the expected commit and the release owner has checked the changed path. | This is the first point where QA, Nick, or the board should be asked to retest. |

## Required Owners

| Responsibility | Owner | What they must confirm |
| --- | --- | --- |
| Release readiness | Ada | Scope is understood, risk is named, and the correct release path is chosen. |
| Implementation | Ravi, Nora, Ada, or another named engineer | Code is committed with explicit paths, pushed, and linked to the task. |
| QA signoff | Tess | The test plan ran, failures are recorded, and the result is clear. |
| Production deploy confirmation | Merge or hotfix owner | Vercel production is green and running the expected commit. |
| Board retest request | Ada | Nick or the board only gets asked to retest after production is confirmed. |
| Operational clarity review | Noelle | The process is understandable and usable by non-engineering operators. |

## Before Asking for Retest

Do not ask Nick, QA, the board, or a customer to retest until every item below is true.

- [ ] The change is committed with only the intended files staged.
- [ ] The branch is pushed to GitHub.
- [ ] A pull request exists, or the task comment explains the approved direct merge or hotfix path.
- [ ] Focused verification ran and the result is recorded in the task.
- [ ] Tess has completed QA signoff for user-facing, production-bound, or release-bound behavior.
- [ ] The change is merged into the production branch, currently `main`.
- [ ] Vercel project `psg-advantage-portal` shows a successful production deployment for the expected commit.
- [ ] The release owner checked the changed production path and recorded what was checked.
- [ ] The Paperclip task comment says "ready for retest" only after the production commit and Vercel deployment are confirmed.

If any item is not true, say what is still missing instead of asking for retest.

## Normal Release Path

1. Confirm the Paperclip task outcome, risk, owner, and acceptance criteria.
2. Use the shared-worktree process in `docs/runbooks/git-worktree-workflow.md`.
3. Make the change on a task branch and commit only explicit file paths.
4. Push the task branch to GitHub.
5. Open or update the pull request with:
   - what changed;
   - how it was verified;
   - whether QA is required;
   - whether production deployment is required.
6. Assign Tess a QA child task when the change affects user-facing or release-bound behavior.
7. Merge to `main` only after required review and QA are complete.
8. Confirm Vercel production deployment for the current production project, `psg-advantage-portal`, is green and points to the merged commit.
9. Run the smallest production check that proves the changed path works.
10. Post a Paperclip update that names the commit, deployment status, production check, and whether it is ready for retest.

## Hotfix Rule

Hotfixes are for urgent production defects only. A hotfix may move faster than a normal release, but it cannot skip production confirmation.

Before asking anyone to retest a hotfix:

- Confirm the fix is on the production branch, currently `main`.
- Confirm Vercel production project `psg-advantage-portal` deployed the exact fixed commit.
- Confirm the affected production page, sign-in path, integration, or API behavior works after deployment.
- Record the root cause and the guardrail added or planned.
- Tell Nick, QA, or the board to retest only after those confirmations are complete.

Use this exact wording in the task when a hotfix is not ready yet:

> The fix is not ready for retest yet. It is committed or pushed, but I have not confirmed that production is running it. I will ask for retest after the production deployment is green and I verify the affected path.

## Paperclip Workflow

Use Paperclip as the live source of truth for release state.

- Keep the engineering task `in_progress` while implementation, review, QA, merge, or deployment is still active.
- Move a task to `in_review` only when a real reviewer or approval path exists.
- Move a task to `blocked` when a named owner must do something before release can continue.
- Mark a task `done` only after verification is recorded and no release follow-up remains.
- Create child tasks for QA, operator actions, Nick approvals, or Noelle operations review instead of burying those asks in comments.
- Do not use "ready for retest," "live," or "shipped" unless the production deployment and post-deploy check are recorded.

## Recommended Guardrails

These are lightweight process improvements that prevent the same mistake from recurring:

- Add a pull request checklist item: "Production retest requested only after `main` deploy is green and verified."
- Add a release comment template in Paperclip with fields for branch, commit, QA owner, Vercel deployment, production check, and retest owner.
- For hotfixes, require the task update to name both the production branch commit and the Vercel deployment before Nick or QA is mentioned for retest.
- For larger milestones, keep a Tess-owned QA child task blocked until the merge and production deployment are confirmed.

## Release Comment Template

Use this in the Paperclip task before asking anyone to retest:

```md
Release status

- Change: <plain-English summary>
- Branch: <branch name>
- Commit: <commit SHA>
- Review path: <pull request or approved hotfix path>
- QA owner and result: <Tess / not required because ...>
- Production deployment: <Vercel project psg-advantage-portal, deployment result, commit>
- Production check: <what was checked in the live app>
- Retest owner: <Nick / Tess / board / customer>
- Ready for retest: <yes or no>
```

If "Ready for retest" is "no," the comment must say who owns the next action and what must happen next.
