#!/usr/bin/env bash
set -euo pipefail

: "${INHERITI_SECRETS_PLAN:?plan is required}"
: "${INHERITI_SECRETS_ENV:?env mappings are required}"
: "${INHERITI_SECRETS_COMMAND:?run is required}"

args=(secrets exec "$INHERITI_SECRETS_PLAN" --output "${INHERITI_SECRETS_OUTPUT:-inherit}")
while IFS= read -r mapping; do
  [[ -z "$mapping" ]] && continue
  args+=(--env "$mapping")
done <<< "$INHERITI_SECRETS_ENV"

# The run input is intentionally a trusted workflow command, just like GitHub's run: key.
exec npm exec --yes --package="@safetech/inheriti-cli@${INHERITI_CLI_VERSION:-latest}" -- \
  inheriti "${args[@]}" -- bash -c "$INHERITI_SECRETS_COMMAND"
