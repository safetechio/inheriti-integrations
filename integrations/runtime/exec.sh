#!/usr/bin/env bash
set -euo pipefail

: "${INHERITI_SECRETS_PLAN:?INHERITI_SECRETS_PLAN is required}"
: "${INHERITI_SECRETS_ENV:?INHERITI_SECRETS_ENV is required}"
if [[ "$#" -eq 0 ]]; then
  echo 'Usage: exec.sh command [argument ...]' >&2
  exit 2
fi

args=(secrets exec "$INHERITI_SECRETS_PLAN" --output "${INHERITI_SECRETS_OUTPUT:-suppress}")
if [[ "${INHERITI_AUTOMATION_PROVIDER:-}" == GOOGLE_CLOUD ]]; then
  : "${INHERITI_AUTOMATION_CONNECTION_ID:?connection id is required}"
  : "${INHERITI_AUTOMATION_AUDIENCE:?audience is required}"
  args+=(--automation)
elif [[ "${INHERITI_AUTOMATION_PROVIDER:-}" == PORTABLE ]]; then
  : "${INHERITI_AUTOMATION_CONNECTION_ID:?connection id is required}"
  : "${INHERITI_AUTOMATION_PRIVATE_KEY_FILE:?private key file is required}"
  args+=(--automation)
elif [[ "${INHERITI_AUTOMATION_PROVIDER:-}" == AWS ]]; then
  : "${INHERITI_AUTOMATION_CONNECTION_ID:?connection id is required}"
  [[ -n "${AWS_REGION:-${AWS_DEFAULT_REGION:-}}" ]] || { echo 'AWS region is required' >&2; exit 2; }
  args+=(--automation)
fi
while IFS= read -r mapping; do
  [[ -z "$mapping" ]] && continue
  args+=(--env "$mapping")
done <<< "$INHERITI_SECRETS_ENV"

exec inheriti "${args[@]}" -- "$@"
