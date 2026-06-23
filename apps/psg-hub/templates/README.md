# W1 master print templates

The proof-gate-approved (A / A) W1 master mail templates, authored into the print
pipeline (PSG-115a / PSG-308). Creative source of truth: the
[PSG-219 design-system doc](/PSG/issues/PSG-219#document-design-system).

## Where the templates actually live

The authoritative, productionized templates are **block-decomposed `MailTemplate`
entries in [`../src/lib/production/templates.ts`](../src/lib/production/templates.ts)**
(`DEFAULT_TEMPLATES`), rendered by the pure mail-merge engine
(`renderMailContent` / `buildMailDocument`). Per-shop variability flows entirely
through the `program.*` skin (`company_programs.customizations_jsonb`); the
warranty paragraph and the logo / owner-signature presentations are
engine-driven variant blocks (PSG-218 model).

| Piece | Product key | Direction |
| --- | --- | --- |
| Thank-You + ACRB survey | `thank_you` | A — "Faithful Letter" (US-Letter, survey ask as a P.S.) |
| Owner service-recovery | `service_recovery` | A — "The Owner's Direct Line" (austere/sincere, owner direct contact) |

## Rendered proofs (derived — for visual / QA review only)

- `thankyou-survey-letter-faithful-rendered.html`
- `owner-service-recovery-rendered.html`

Regenerate them from the engine on the spec sample shop (ABC Auto Body / owner
Steve Smith):

```
pnpm --filter psg-hub exec tsx templates/render-check.ts
```

The CI gate is the test suite, not these files:
`src/lib/production/__tests__/w1-master-templates.test.ts` asserts both masters
render with **zero unresolved tokens** on the same sample, plus the warranty /
logo / signature variant behavior.

> **Non-blocking (PSG-308):** Piece 2 is productized from the closest library
> sources (#10 ACRB Report Card + #15 owner check-in). If the original
> Hot-Spot/Unresolved service-recovery letter surfaces, re-anchor the copy 1:1 —
> the block structure and skin contract do not change.
