# PSG brand mirror canonical check

Checked on 2026-07-10 for PSG-1056 against `Phoenix-Solutions-Group/design-system`
on `main` via the GitHub connector.

## Exact SHA matches

| File | Canonical blob SHA | Local blob SHA | Result |
| --- | --- | --- | --- |
| `colors_and_type.css` | `78bcdb227b830d6cb3af0cc08320196b24a1cd04` | `78bcdb227b830d6cb3af0cc08320196b24a1cd04` | Match |
| `fonts/LICENSE.md` | `a79d4ac4aa7d4187ea4843916db5f32a85108650` | `a79d4ac4aa7d4187ea4843916db5f32a85108650` | Match |
| `assets/psg-logo-stacked.svg` | `788ec3ead9f790105404a84a3dfd7400c3f1df17` | `788ec3ead9f790105404a84a3dfd7400c3f1df17` | Match |
| `assets/psg-logo-stacked-reverse.svg` | `772ee5e82ed6cbe6ef338ed778492ef6c0101940` | `772ee5e82ed6cbe6ef338ed778492ef6c0101940` | Match |
| `assets/psg-mark-square.svg` | `21d101fc42f18e57d4efd1c39845d643089afd7b` | `21d101fc42f18e57d4efd1c39845d643089afd7b` | Match |

## Text reconciliation

- `README.md` no longer says the logo art is reconstructed or missing official vectors.
- `README.md` now points to the official v3.0 vector source, current neutral token values
  from `colors_and_type.css`, the current asset names, and the font license file.
- `SKILL.md` no longer tells agents to redraw or swap reconstructed logos and now points
  to the full official asset set plus `fonts/LICENSE.md`.

## Remaining local blocker

The exported docs mirror under `docs/psg/logos-graphics/psg-logos/psg-logo-30/`
still contains older Markdown exports. Those files are owned by `root` in this
workspace, and this agent account cannot edit or chmod them. They should be marked
as non-canonical and pointed at `packages/ui/psg-brand/` once writable.
