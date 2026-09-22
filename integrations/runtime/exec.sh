#!/usr/bin/env bash
set -euo pipefail

: "${INHERITI_SECRETS_PLAN:?INHERITI_SECRETS_PLAN is required}"
: "${INHERITI_SECRETS_ENV:?INHERITI_SECRETS_ENV is required}"
if [[ "$#" -eq 0 ]]; then
  echo 'Usage: exec.sh command [argument ...]' >&2
  exit 2
fi

args=(secrets exec "$INHERITI_SECRETS_PLAN" --output "${INHERITI_SECRETS_OUTPUT:-inherit}")
while IFS= read -r mapping; do
  [[ -z "$mapping" ]] && continue
  args+=(--env "$mapping")
done <<< "$INHERITI_SECRETS_ENV"

exec inheriti "${args[@]}" -- "$@"
