#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${INHERITI_AUTOMATION_CONNECTION_ID:-}" ]]; then
  export INHERITI_AUTOMATION_PROVIDER=AWS
fi
exec "$(cd "$(dirname "$0")/../../runtime" && pwd)/exec.sh" "$@"
