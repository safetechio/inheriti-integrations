#!/usr/bin/env bash
set -euo pipefail

exec "$(cd "$(dirname "$0")/../../runtime" && pwd)/exec.sh" "$@"
