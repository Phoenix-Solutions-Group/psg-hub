# Operator Task Protocol

**Status:** Active company policy (board-directed, PSG-240, 2026-06-23)
**Owner:** CEO (Steve)
**Applies to:** All agents

## Why this exists

The board changed how we surface work that needs a human. Previously, agents
"alerted the board" with generic escalations or approval requests. Going forward,
any task that genuinely requires a **human operator** is assigned directly to
**Nick** with clear, descriptive, step-by-step instructions. Nick will take care
of it.

This is a routing change only. It does **not** widen what we hand to humans.

## Relationship to board escalation and public review

The Board Escalation & Review Standard (PSG-1173) complements this runbook
rather than replacing it. This runbook covers steps only a human operator can
physically perform, such as vendor-console actions, legal sign-off, or payment
approval. The board escalation standard also covers moments where Nick needs to
make a business decision, answer a question, give input, or review something
public/customer-facing before it goes live.

When either policy applies, create a child issue assigned to Nick and block the
parent task on that child issue. Keep the ask plain-language, self-contained,
and specific about what Nick needs to do.

## Rule #1 still holds: never hand a human what an agent can do

Route to Nick **only** for steps that an agent genuinely cannot perform. If an
agent (or another agent you can escalate to) can do it, do that instead. When in
doubt, keep it with agents.

Operations that are genuinely human-operator-only (route to Nick):

- Entering / rotating / disabling secret keys in third-party dashboards
  (Supabase, Vercel, SendGrid, Hetzner, AI gateways, Google, etc.).
- Superadmin browser sessions that require credentials agents do not hold.
- Console steps in vendor portals with no API the agent can reach.
- Financial / legal / contractual sign-off (spend approvals, memberships,
  partnership agreements).
- Physical-world or out-of-band actions.

Operations that stay with agents (do **not** route to Nick):

- Writing/reviewing code, running tests, opening PRs, merging.
- Applying migrations or deploys through tooling the agent can drive.
- Anything reachable via an API, MCP tool, or skill the agent has.
- Decisions another agent (e.g. CTO) is authorized to make.

## How to route an operator task to Nick

Nick is the **human board user**, not an agent.

- `assigneeUserId`: `Z9SyE1VMQyTJvDiFOKLaRgWOwCw3LVDW`  (Nick — nick@phoenixsolutionsgroup.net)
- `assigneeAgentId`: `null`
- `status`: `in_review`  (waiting on a human; this is the explicit waiting path)

When the operator step is a sub-step of a larger agent-owned task, create a
**child issue** scoped to just the operator action, assign that child to Nick,
and set the parent `blockedByIssueIds` to the child so the parent auto-resumes
when Nick finishes. Keep the parent with its agent owner.

`PATCH /api/issues/{id}` example fields:

```json
{
  "assigneeUserId": "Z9SyE1VMQyTJvDiFOKLaRgWOwCw3LVDW",
  "assigneeAgentId": null,
  "status": "in_review",
  "comment": "<step-by-step runbook — see template below>"
}
```

## Required instruction quality

Every operator task must be self-contained. Nick should never have to ask "what
do you mean" or go hunting. Include:

1. **Goal** — one line: what this accomplishes and why it matters.
2. **Where** — exact dashboard / URL / console / screen, with the path to it.
3. **Numbered steps** — one action per step. Include exact values, secret names
   (never the secret values themselves in plaintext), button labels, and field
   names. No abbreviations a non-engineer would miss.
4. **Expected result** — what Nick should see after each meaningful step.
5. **Verification** — how to confirm it worked.
6. **What to paste back** — the exact output/confirmation the agent needs to
   continue (e.g. "paste the new key into the secret manager", "reply 'done'",
   "paste the row count").
7. **Rollback / safety** — what to do if a step fails or looks wrong; never
   guess on irreversible steps.

### Template

```markdown
## Operator action: <short title>

**Goal:** <one line>
**Estimated time:** <e.g. 5 min>
**You'll need:** <access / credentials / which account>

### Steps
1. Go to <exact URL / dashboard path>.
2. <single action, exact labels/values>.
   - Expected: <what you should see>
3. <next action>.
   ...

### Verify
- <how to confirm success>

### When done
- <exactly what to paste back / which secret to set / reply "done">

### If something looks wrong
- <stop condition + who to ping; do not proceed on irreversible steps>
```

## Closing the loop

- After Nick completes the action and replies, the assigned agent is woken
  (blocker resolved or comment), verifies the result, and closes the work.
- Agents must **verify** operator-completed steps where possible (e.g. confirm
  prod is green, confirm the row exists) rather than assuming success.

## Examples already following this pattern

- Secret rotation (PSG-206): Nick did all console steps; agent verified prod.
- Migration apply (PSG-44, PSG-217): operator applies; agent verifies drift = 0.
- Live smoke needing superadmin browser + test keys (PSG-233): handed to Nick
  with a runbook; agent verifies audit rows on unblock.
