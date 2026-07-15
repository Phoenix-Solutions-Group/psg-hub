# Alarm and safety check closing standard

Owner: Engineering. Scope: alarms, monitors, coverage checks, and safety checks only.

## Bottom line

Do not close an alarm, monitor, coverage check, or safety check until the evidence proves both things:

1. The required behaviour exists in `origin/main` by content, not by a commit name.
2. The check can fail when the protected condition is broken.

This rule is intentionally narrow. Ordinary product features do not need this extra friction because
missing feature code is usually visible during normal review and testing. Silent checks are different:
a check that only appears to pass can leave the business unprotected while everyone believes the
guardrail is working.

## Why content beats commit IDs

Commit IDs are temporary until the work reaches `main`. A local branch can contain the right patch
under one commit ID, then a rebase or merge can land the same bytes on `main` under a different ID.
If the closing evidence says only "commit `<sha>` is on main," a reviewer can correctly fail to find
that SHA even though the content landed.

For this task class, prove content instead:

- `git show origin/main:<path>` shows the exact assertion, alarm condition, or safety rule.
- A fresh checkout of `origin/main` runs the check and shows the protected behaviour.
- `git branch -r --contains <sha>` is acceptable only as a reachability check for the commit you are
  closing from; it is not enough by itself when a rebase could have renamed the commit.

## Closing checklist

Before marking one of these tickets done, paste evidence for each item:

1. **Content-on-main proof:** show `origin/main` contains the actual rule or assertion. Prefer
   `git show origin/main:<path> | rg "<specific assertion or string>"`.
2. **Red test:** break the protected condition in a controlled input and show the command exits red.
   A green run alone is not evidence.
3. **Anti-stranding check:** confirm the work is pushed and reachable from `origin/main` by content.
   Do not close from a local-only branch, an unpushed commit, or a stale unrelated feature branch.
4. **Scope check:** say whether the ticket is an alarm, monitor, coverage check, or safety check. If
   it is an ordinary feature, this standard does not apply.
5. **QA code review by Tess:** for this ticket class, Tess verifies the code or check logic itself,
   not just the pasted run output.

## Worked example: Pipedrive Won billing coverage check

The Won billing coverage check lives at:

`apps/psg-hub/scripts/pipedrive-won-billing-coverage-check.mjs`

It protects finance by checking that exactly the expected billing fields are still required before a
Pipedrive deal can be marked won.

### Content-on-main proof

Use a content check against `origin/main`, not a local commit name:

```bash
git fetch origin
git show origin/main:apps/psg-hub/scripts/pipedrive-won-billing-coverage-check.mjs \
  | rg "ok: missingCodes.length === 0 && unexpectedCodes.length === 0"
```

Expected proof line:

```text
ok: missingCodes.length === 0 && unexpectedCodes.length === 0,
```

### Red test

Feed the check a deliberately broken copy of the expected input by removing one required field from
the simulated Pipedrive response. The check must report `ok: false` and name the missing billing
field.

```bash
node --input-type=module <<'EOF'
import {
  buildWonBillingCoverageCheck,
  EXPECTED_WON_BILLING_REQUIRED_FIELDS,
  PSG_SALES_PIPELINE_ID,
  WON_STAGE_ID,
} from "./apps/psg-hub/scripts/pipedrive-won-billing-coverage-check.mjs";

const required = {
  stage_ids: [WON_STAGE_ID],
  statuses: { [String(PSG_SALES_PIPELINE_ID)]: ["won"] },
};

const brokenDealFields = EXPECTED_WON_BILLING_REQUIRED_FIELDS.slice(1).map((field) => ({
  id: field.id,
  key: field.code,
  name: field.name,
  required_fields: required,
}));

const result = buildWonBillingCoverageCheck({ dealFields: brokenDealFields });
console.log(JSON.stringify({
  ok: result.ok,
  missingNames: result.missingNames,
  alertText: result.alertText,
}, null, 2));

if (result.ok) {
  process.exit(1);
}
EOF
```

Expected red-test output:

```json
{
  "ok": false,
  "missingNames": [
    "Signed Contract / Approval Link"
  ],
  "alertText": "Won-gate billing check lost coverage: Signed Contract / Approval Link no longer required. Finance may be unable to invoice new sales."
}
```

This proves the check fails for the business risk it is meant to catch. It also avoids the false
comfort of reading printed `requiredFields` data: printed input can show values such as `statuses`
without proving the assertion actually tested them.

## Reviewer rule

For alarms, monitors, coverage checks, and safety checks, Tess reviews the source rule and the red
test setup. Do not ask QA to approve only a pasted green run, because a green run can be produced by
a check that never asserted the important condition.
