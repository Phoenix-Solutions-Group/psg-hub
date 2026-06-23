#!/usr/bin/env bash
#
# skillsmith-seed-uninstall.sh — Track C / C5 rollback for Skillsmith + Seed.
#
# Reverses the pinned-local install documented in
#   docs/runbooks/skillsmith-seed-install.md (C1 / PSG-344)
# and specified in
#   docs/runbooks/skillsmith-seed-rollback.md (C5 / PSG-350).
#
# SAFETY CONTRACT:
#   - Removes ONLY the artifacts the @chrisai installers create:
#       <root>/.claude/commands/skillsmith
#       <root>/.claude/commands/seed
#       <root>/.claude/skillsmith-specs
#     and the two npm devDependencies (@chrisai/skillsmith, @chrisai/seed).
#   - NEVER deletes the whole .claude/ directory. Any pre-existing
#     .claude content (CLAUDE.md, skills/, your own commands) is preserved.
#   - Idempotent: safe to re-run; reports clean if nothing is installed.
#
# Usage:
#   scripts/skillsmith-seed-uninstall.sh [--dry-run] [--root <project-root>]
#
# Defaults: --root = git toplevel of CWD, else CWD.
# Exit codes: 0 = clean revert verified, 1 = usage/precondition error,
#             2 = residue remained after removal (verification failed).

set -euo pipefail

DRY_RUN=0
ROOT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$ROOT" ]; then
  ROOT="$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if [ ! -d "$ROOT" ]; then
  echo "ERROR: project root not found: $ROOT" >&2; exit 1
fi

CLAUDE_DIR="$ROOT/.claude"

# The exact, closed set of scaffold paths the installers create.
SCAFFOLD_PATHS=(
  "$CLAUDE_DIR/commands/skillsmith"
  "$CLAUDE_DIR/commands/seed"
  "$CLAUDE_DIR/skillsmith-specs"
)

PKGS=( "@chrisai/skillsmith" "@chrisai/seed" )

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN> $*"
  else
    echo "+ $*"
    "$@"
  fi
}

echo "== Skillsmith + Seed rollback =="
echo "Project root : $ROOT"
echo "Mode         : $([ "$DRY_RUN" -eq 1 ] && echo 'dry-run (no changes)' || echo 'apply')"
echo

# --- Step 1: remove scaffolded skill files (scoped, never the whole .claude) ---
echo "-- Step 1: remove scaffolded skill directories --"
for p in "${SCAFFOLD_PATHS[@]}"; do
  if [ -e "$p" ]; then
    run rm -rf "$p"
  else
    echo "  (absent) $p"
  fi
done
echo

# --- Step 2: remove the pinned npm devDependencies ---
echo "-- Step 2: remove pinned npm packages --"
if [ -f "$ROOT/package.json" ] && grep -q '@chrisai/' "$ROOT/package.json" 2>/dev/null; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN> (cd $ROOT && npm uninstall ${PKGS[*]})"
  else
    ( cd "$ROOT" && npm uninstall "${PKGS[@]}" 2>&1 | tail -3 )
  fi
else
  echo "  (not in package.json — skipping npm uninstall)"
  # Best-effort: drop any stray vendored copies even if package.json was already clean.
  if [ -d "$ROOT/node_modules/@chrisai" ]; then
    run rm -rf "$ROOT/node_modules/@chrisai"
  fi
fi
echo

# --- Step 3: verify clean revert ---
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry-run complete. No changes made."
  exit 0
fi

echo "-- Step 3: verify clean revert --"
RESIDUE=0

for p in "${SCAFFOLD_PATHS[@]}"; do
  if [ -e "$p" ]; then echo "  RESIDUE: $p still exists"; RESIDUE=1; fi
done

if [ -d "$ROOT/node_modules/@chrisai" ] && [ -n "$(ls -A "$ROOT/node_modules/@chrisai" 2>/dev/null)" ]; then
  echo "  RESIDUE: node_modules/@chrisai not empty"; RESIDUE=1
fi

if grep -q '@chrisai/' "$ROOT/package.json" 2>/dev/null; then
  echo "  RESIDUE: @chrisai still referenced in package.json"; RESIDUE=1
fi

LOCK_HITS=0
if [ -f "$ROOT/package-lock.json" ]; then
  LOCK_HITS=$(grep -c '@chrisai/' "$ROOT/package-lock.json" 2>/dev/null || true)
fi
if [ "${LOCK_HITS:-0}" -ne 0 ]; then
  echo "  RESIDUE: @chrisai referenced $LOCK_HITS time(s) in package-lock.json"; RESIDUE=1
fi

# Confirm .claude itself survived (we must not have nuked unrelated content).
if [ -d "$ROOT/.claude" ]; then
  echo "  OK: .claude/ preserved (pre-existing content intact)"
fi

if [ "$RESIDUE" -eq 0 ]; then
  echo
  echo "✅ Clean revert verified: Skillsmith + Seed fully removed; pre-rollout state restored."
  exit 0
else
  echo
  echo "❌ Rollback incomplete — residue above. Inspect manually before retrying." >&2
  exit 2
fi
