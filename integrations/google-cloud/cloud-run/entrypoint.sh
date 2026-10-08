#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${INHERITI_AUTOMATION_CONNECTION_ID:-}" || -n "${INHERITI_AUTOMATION_AUDIENCE:-}" ]]; then
  export INHERITI_AUTOMATION_PROVIDER=GOOGLE_CLOUD
fi
exec "$(cd "$(dirname "$0")/../../runtime" && pwd)/exec.sh" "$@"
