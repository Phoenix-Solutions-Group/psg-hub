#!/usr/bin/env bash
#
# psg-worktree.sh — per-issue git worktree isolation for the shared psg-hub checkout.
#
# WHY: Multiple agents share one working tree (.../psg-hub). Switching branches or
# `git stash`-ing in that shared checkout is a realized data-loss hazard — a routine
# stash already swept up another agent's uncommitted work (PSG-85). This helper gives
# every issue its OWN isolated worktree off origin/main, so branch work never touches
# the shared checkout's HEAD or anyone else's uncommitted files.
#
# KEYING: per-issue (one issue -> one worktree -> one branch -> one PR). Preferred over
# per-agent because it maps cleanly to the review/merge unit.
#
# LOCATION: worktrees live in a SIBLING dir of the checkout ($PSG_WT_ROOT, default
# ../psg-worktrees), entirely outside the tracked tree — nothing to accidentally commit.
#
# USAGE:
#   scripts/psg-worktree.sh create  <issue-id> [--base <ref>] [--branch <name>]
#   scripts/psg-worktree.sh path    <issue-id>
#   scripts/psg-worktree.sh list
#   scripts/psg-worktree.sh cleanup <issue-id> [--force]
#
# EXAMPLES:
#   # Start isolated work for PSG-99 off origin/main:
#   eval "$(scripts/psg-worktree.sh create PSG-99 --print-cd)"   # creates + cd's you in
#   # ...or just create and cd manually:
#   scripts/psg-worktree.sh create PSG-99
#   cd "$(scripts/psg-worktree.sh path PSG-99)"
#   # ...do work, commit with EXPLICIT pathspecs, push...
#   git add path/to/file && git commit && git push -u origin feat/psg-99
#   # When merged, tear it down:
#   scripts/psg-worktree.sh cleanup PSG-99
#
set -euo pipefail

err() { printf 'psg-worktree: %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

# The shared (main) checkout root — stable regardless of which worktree we run from.
# git-common-dir points at <main>/.git; its parent is the main checkout.
common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || die "not inside a git repository"
case "$common_dir" in
  /*) ;;                                   # already absolute
  *)  common_dir="$(cd "$common_dir" && pwd)" ;;
esac
MAIN_ROOT="$(cd "$(dirname "$common_dir")" && pwd)"

# Worktree root: sibling of the checkout by default, overridable.
WT_ROOT="${PSG_WT_ROOT:-$MAIN_ROOT/../psg-worktrees}"

normalize_id() {
  # Accept "PSG-87", "psg-87", "87" -> canonical "PSG-87".
  local id="$1"
  [ -n "$id" ] || die "missing <issue-id>"
  if [[ "$id" =~ ^[0-9]+$ ]]; then id="PSG-$id"; fi
  printf '%s' "$id" | tr '[:lower:]' '[:upper:]'
}

wt_path() { printf '%s/%s' "$WT_ROOT" "$1"; }

default_branch_for() {
  # PSG-87 -> feat/psg-87
  printf 'feat/%s' "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
}

branch_exists_local()  { git -C "$MAIN_ROOT" show-ref --verify --quiet "refs/heads/$1"; }
branch_exists_remote() { git -C "$MAIN_ROOT" show-ref --verify --quiet "refs/remotes/origin/$1"; }

cmd_create() {
  local id base="origin/main" branch="" print_cd=0
  id="$(normalize_id "${1:-}")"; shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --base)     base="${2:?--base needs a ref}"; shift 2 ;;
      --branch)   branch="${2:?--branch needs a name}"; shift 2 ;;
      --print-cd) print_cd=1; shift ;;
      *) die "unknown create flag: $1" ;;
    esac
  done
  [ -n "$branch" ] || branch="$(default_branch_for "$id")"

  local path; path="$(wt_path "$id")"
  if [ -e "$path" ]; then
    err "worktree already exists: $path"
    [ "$print_cd" = 1 ] && printf 'cd %q\n' "$path"
    return 0
  fi

  err "fetching origin (no effect on shared checkout HEAD)..."
  git -C "$MAIN_ROOT" fetch --quiet origin

  mkdir -p "$WT_ROOT"
  if branch_exists_local "$branch"; then
    err "checking out existing local branch '$branch' into isolated worktree"
    git -C "$MAIN_ROOT" worktree add "$path" "$branch"
  elif branch_exists_remote "$branch"; then
    err "tracking existing origin/$branch in isolated worktree"
    git -C "$MAIN_ROOT" worktree add --track -b "$branch" "$path" "origin/$branch"
  else
    err "creating new branch '$branch' off $base"
    # --no-track: do NOT inherit $base (e.g. origin/main) as upstream, or a bare
    # `git push` could target main. Upstream is set intentionally via `push -u origin $branch`.
    git -C "$MAIN_ROOT" worktree add --no-track -b "$branch" "$path" "$base"
  fi

  err "ready: $path  (branch: $branch)"
  if [ "$print_cd" = 1 ]; then
    printf 'cd %q\n' "$path"
  else
    err "next: cd \"$path\"  — commit with EXPLICIT pathspecs, then push -u origin $branch"
  fi
}

cmd_path() {
  local id; id="$(normalize_id "${1:-}")"
  printf '%s\n' "$(wt_path "$id")"
}

cmd_list() {
  git -C "$MAIN_ROOT" worktree list
}

cmd_cleanup() {
  local id force=0
  id="$(normalize_id "${1:-}")"; shift || true
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force=1; shift ;;
      *) die "unknown cleanup flag: $1" ;;
    esac
  done
  local path; path="$(wt_path "$id")"
  [ -d "$path" ] || { err "no worktree at $path (already cleaned?)"; git -C "$MAIN_ROOT" worktree prune; return 0; }

  if [ "$force" != 1 ]; then
    # Refuse to discard uncommitted changes.
    if [ -n "$(git -C "$path" status --porcelain)" ]; then
      die "worktree has uncommitted changes: $path  (commit/push first, or pass --force)"
    fi
    # Refuse to discard unpushed commits.
    local upstream ahead
    if upstream="$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
      ahead="$(git -C "$path" rev-list --count "$upstream"..HEAD 2>/dev/null || echo 0)"
      [ "$ahead" = 0 ] || die "$ahead unpushed commit(s) on this worktree's branch (push first, or pass --force)"
    else
      die "branch has no upstream — push it first (or pass --force to discard)"
    fi
  fi

  git -C "$MAIN_ROOT" worktree remove ${force:+--force} "$path"
  git -C "$MAIN_ROOT" worktree prune
  err "removed worktree: $path"
}

usage() {
  sed -n '3,40p' "$0"
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    create)  cmd_create "$@" ;;
    path)    cmd_path "$@" ;;
    list)    cmd_list "$@" ;;
    cleanup) cmd_cleanup "$@" ;;
    ""|-h|--help|help) usage ;;
    *) err "unknown command: $cmd"; usage; exit 2 ;;
  esac
}

main "$@"
