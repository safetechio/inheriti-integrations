#!/usr/bin/env bash
set -euo pipefail

: "${INHERITI_SECRETS_PLAN:?plan is required}"
: "${INHERITI_SECRETS_ENV:?env mappings are required}"
: "${INHERITI_SECRETS_COMMAND:?run is required}"
automation_args=()
if [[ -n "${INHERITI_AUTOMATION_CONNECTION_ID:-}" || -n "${INHERITI_AUTOMATION_AUDIENCE:-}" ]]; then
  : "${INHERITI_AUTOMATION_CONNECTION_ID:?connection-id is required}"
  : "${INHERITI_AUTOMATION_AUDIENCE:?audience is required}"
  : "${ACTIONS_ID_TOKEN_REQUEST_URL:?grant id-token: write to the calling workflow}"
  : "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:?grant id-token: write to the calling workflow}"
  automation_args=(--automation)
fi

args=(secrets exec "$INHERITI_SECRETS_PLAN" --output "${INHERITI_SECRETS_OUTPUT:-suppress}")
args+=("${automation_args[@]}")
while IFS= read -r mapping; do
  [[ -z "$mapping" ]] && continue
  args+=(--env "$mapping")
done <<< "$INHERITI_SECRETS_ENV"

# The run input is intentionally a trusted workflow command, just like GitHub's run: key.
exec npm exec --yes --package="@safetech/inheriti-cli@${INHERITI_CLI_VERSION:-latest}" -- \
  inheriti "${args[@]}" -- bash -c "$INHERITI_SECRETS_COMMAND"
