#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
deployment="${INHERITI_BUILD_DEPLOYMENT:-local}"
if [[ ! "$deployment" =~ ^(local|dev|stg|prod)$ ]]; then echo 'Invalid Workspace deployment' >&2; exit 1; fi
export TAURI_CONFIG="{\"identifier\":\"com.safetech.inheriti.workspace.$deployment\"}"
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Workspace prototype requires Linux' >&2
  exit 1
fi

node_binary="$(command -v node || true)"
if [[ -z "$node_binary" || ! -x "$node_binary" ]]; then
  echo 'Node.js 22 or newer is required to build the workspace' >&2
  exit 1
fi
node_binary="$(readlink -f "$node_binary")"
node_major="$("$node_binary" --version | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
if [[ -z "$node_major" || "$node_major" -lt 22 ]]; then
  echo 'Node.js 22 or newer is required to build the workspace' >&2
  exit 1
fi

pnpm build:host
cargo build --offline --manifest-path src-tauri/Cargo.toml --bins
runtime=src-tauri/target/debug/workspace-host
mkdir -p "$runtime"
cp -L "$node_binary" "$runtime/node.next"
mv -f "$runtime/node.next" "$runtime/node"
cp dist/host.cjs "$runtime/host.cjs"
rm -rf "$runtime/node_modules"
cp -a dist/node_modules "$runtime/node_modules"
