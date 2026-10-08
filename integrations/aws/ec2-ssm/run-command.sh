#!/usr/bin/env bash
set -euo pipefail

# Run this script on the managed EC2 instance from SSM Run Command. The instance role identifies
# the workload; it does not replace the Inheriti reveal authorization policy.
if [[ -n "${INHERITI_AUTOMATION_CONNECTION_ID:-}" ]]; then
  export INHERITI_AUTOMATION_PROVIDER=AWS
fi
exec "$(cd "$(dirname "$0")/../../runtime" && pwd)/exec.sh" "$@"
