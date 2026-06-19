#!/usr/bin/env bash
#
# psg-vercel-ads-env.sh — one-command env plumbing for the Ads Mutation Studio live gate
# (PSG-102 / PSG-26c). Sets every Vercel env var the sandbox transport needs and installs
# the operator-minted Google Ads / GTM secrets, then verifies — so the only human step is
# minting 6 credential values + dropping a scoped VERCEL_TOKEN.
#
# WHY THIS EXISTS:
#   - There is NO Vercel console "enable Sandbox" toggle. `@vercel/sandbox` is already a
#     runtime dep on main (apps/psg-hub/package.json) and Sandbox.create() auto-auths via
#     the deployment's OIDC token. The sandbox "just works" once the env below is set and
#     ADS_MUTATIONS_SANDBOX_ENABLED=true flips the gate (bridge.ts getBridge()).
#   - Everything except the 6 secret VALUES is agent-settable. This script is that automation.
#
# WHAT IT SETS (verified against origin/main sandbox-transport.ts + bridge.ts):
#   Non-secret (config, set inline by this script):
#     ADS_MUTATIONS_SANDBOX_ENABLED=true          # the gate (bridge.ts:50)
#     ADS_MUTATIONS_REPO_URL=<repo https url>      # REQUIRED — git URL the sandbox clones
#     ADS_MUTATIONS_REPO_REVISION=main             # optional (default main)
#     ADS_MUTATIONS_APP_DIR=apps/psg-ads-mutations # optional (default)
#     ADS_MUTATIONS_SANDBOX_TIMEOUT_MS=600000      # optional (default)
#     GOOGLE_ADS_USE_PROTO_PLUS=true               # recommended config, not a secret
#   Secret (operator-minted, read from --secrets-file, NEVER echoed or committed):
#     GOOGLE_ADS_DEVELOPER_TOKEN
#     GOOGLE_ADS_CLIENT_ID
#     GOOGLE_ADS_CLIENT_SECRET
#     GOOGLE_ADS_REFRESH_TOKEN
#     GOOGLE_ADS_LOGIN_CUSTOMER_ID
#     GTM_REFRESH_TOKEN
#
# PREREQUISITES (the irreducible human steps):
#   1. Operator mints the 6 secret values (developer token is Google-account-approved;
#      refresh tokens come from a browser OAuth consent via
#      `python -m googleads_psg.auth_bootstrap` / `gtm_psg.auth_bootstrap`).
#   2. A scoped VERCEL_TOKEN (+ VERCEL_ORG_ID / VERCEL_PROJECT_ID for psg-digital/psg-hub)
#      is exported in this shell. Without it the Vercel CLI cannot reach the project.
#
# USAGE:
#   export VERCEL_TOKEN=...            # scoped to psg-digital/psg-hub
#   export VERCEL_ORG_ID=...           # team id (or use --link)
#   export VERCEL_PROJECT_ID=...       # psg-hub project id
#   scripts/psg-vercel-ads-env.sh --secrets-file ./ads-secrets.env [--targets "production preview"] [--dry-run]
#
#   The --secrets-file is a KEY=VALUE file (same 6 keys above). It MUST be gitignored —
#   .env / .env.* already are. This script refuses to run if the file is tracked by git.
#
# SAFETY:
#   - Secret VALUES are never printed; only KEY NAMES are echoed.
#   - Idempotent: each var is removed (if present) then re-added, per target environment.
#   - --dry-run prints the plan (key names + targets) and exits without mutating anything.
#
set -euo pipefail

# ----- config -----------------------------------------------------------------
REPO_HTTPS_URL="https://github.com/Phoenix-Solutions-Group/psg-hub.git"
TARGETS="production preview"
SECRETS_FILE=""
DRY_RUN=0
DO_LINK=0

NONSECRET_KEYS=(
  "ADS_MUTATIONS_SANDBOX_ENABLED"
  "ADS_MUTATIONS_REPO_URL"
  "ADS_MUTATIONS_REPO_REVISION"
  "ADS_MUTATIONS_APP_DIR"
  "ADS_MUTATIONS_SANDBOX_TIMEOUT_MS"
  "GOOGLE_ADS_USE_PROTO_PLUS"
)
declare -A NONSECRET_VALUES=(
  ["ADS_MUTATIONS_SANDBOX_ENABLED"]="true"
  ["ADS_MUTATIONS_REPO_URL"]="$REPO_HTTPS_URL"
  ["ADS_MUTATIONS_REPO_REVISION"]="main"
  ["ADS_MUTATIONS_APP_DIR"]="apps/psg-ads-mutations"
  ["ADS_MUTATIONS_SANDBOX_TIMEOUT_MS"]="600000"
  ["GOOGLE_ADS_USE_PROTO_PLUS"]="true"
)
SECRET_KEYS=(
  "GOOGLE_ADS_DEVELOPER_TOKEN"
  "GOOGLE_ADS_CLIENT_ID"
  "GOOGLE_ADS_CLIENT_SECRET"
  "GOOGLE_ADS_REFRESH_TOKEN"
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID"
  "GTM_REFRESH_TOKEN"
)

# ----- args -------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --secrets-file) SECRETS_FILE="$2"; shift 2 ;;
    --targets)      TARGETS="$2"; shift 2 ;;
    --repo-url)     NONSECRET_VALUES["ADS_MUTATIONS_REPO_URL"]="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --link)         DO_LINK=1; shift ;;
    -h|--help)      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

# ----- preflight --------------------------------------------------------------
[[ -n "${VERCEL_TOKEN:-}" ]] || die "VERCEL_TOKEN not set — operator must drop a scoped token first (PSG-102 prereq)."
[[ -n "$SECRETS_FILE" ]] || die "--secrets-file is required (KEY=VALUE file with the 6 minted secrets)."
[[ -f "$SECRETS_FILE" ]] || die "secrets file not found: $SECRETS_FILE"

# Refuse to proceed if the secrets file is tracked by git — guards against committing creds.
if git -C "$(dirname "$SECRETS_FILE")" ls-files --error-unmatch "$(basename "$SECRETS_FILE")" >/dev/null 2>&1; then
  die "secrets file $SECRETS_FILE is git-tracked. Move it out of version control (.env* is gitignored)."
fi

# Vercel CLI — install on demand (none ships in the agent sandbox).
VERCEL="vercel"
if ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI absent — using 'npx --yes vercel@latest'"
  VERCEL="npx --yes vercel@latest"
fi
VC="$VERCEL --token $VERCEL_TOKEN"

# Project linkage: prefer env ids; optionally interactive-link.
if [[ "$DO_LINK" == "1" ]]; then
  $VC link --yes
fi
if [[ -z "${VERCEL_ORG_ID:-}" || -z "${VERCEL_PROJECT_ID:-}" ]]; then
  echo "NOTE: VERCEL_ORG_ID / VERCEL_PROJECT_ID not both set — relying on .vercel/project.json (run with --link to create it)." >&2
fi

# Load secrets into an associative array WITHOUT echoing values.
declare -A SECRET_VALUES=()
while IFS='=' read -r k v; do
  [[ -z "$k" || "$k" == \#* ]] && continue
  k="$(echo "$k" | tr -d '[:space:]')"
  SECRET_VALUES["$k"]="$v"
done < "$SECRETS_FILE"

missing=()
for k in "${SECRET_KEYS[@]}"; do
  [[ -n "${SECRET_VALUES[$k]:-}" ]] || missing+=("$k")
done
[[ ${#missing[@]} -eq 0 ]] || die "secrets file missing values for: ${missing[*]}"

# ----- plan -------------------------------------------------------------------
echo "==> Targets: $TARGETS"
echo "==> Non-secret vars: ${NONSECRET_KEYS[*]}"
echo "==> Secret vars (values hidden): ${SECRET_KEYS[*]}"
echo "==> ADS_MUTATIONS_REPO_URL=${NONSECRET_VALUES[ADS_MUTATIONS_REPO_URL]}"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY RUN — no changes made."
  exit 0
fi

# ----- apply (idempotent: rm then add per target) -----------------------------
set_var() {  # set_var KEY VALUE
  local key="$1" val="$2" t
  for t in $TARGETS; do
    $VC env rm "$key" "$t" --yes >/dev/null 2>&1 || true
    printf '%s' "$val" | $VC env add "$key" "$t" >/dev/null
    echo "   set $key [$t]"
  done
}

echo "==> Writing non-secret config vars..."
for k in "${NONSECRET_KEYS[@]}"; do
  set_var "$k" "${NONSECRET_VALUES[$k]}"
done

echo "==> Writing secret vars (values not displayed)..."
for k in "${SECRET_KEYS[@]}"; do
  set_var "$k" "${SECRET_VALUES[$k]}"
done

# ----- verify -----------------------------------------------------------------
echo "==> Verifying (key names + targets only)..."
$VC env ls 2>/dev/null | grep -E "ADS_MUTATIONS_|GOOGLE_ADS_|GTM_" || true

echo
echo "DONE. The gate (ADS_MUTATIONS_SANDBOX_ENABLED=true) is set. Trigger a redeploy so the"
echo "new env takes effect, then hand PSG-26e (E2E QA) the dry-run -> execute round-trip to verify."
