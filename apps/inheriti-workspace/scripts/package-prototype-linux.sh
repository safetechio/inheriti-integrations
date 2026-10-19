#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
deployment="${INHERITI_BUILD_DEPLOYMENT:-local}"
if [[ ! "$deployment" =~ ^(local|dev|stg|prod)$ ]]; then echo 'Invalid Workspace deployment' >&2; exit 1; fi
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Linux .deb packaging requires a Linux host' >&2
  exit 1
fi

target="$(rustc -vV | sed -n 's/^host: //p')"
if [[ -z "$target" ]]; then
  echo 'Rust host target unavailable' >&2
  exit 1
fi

node_binary="$(command -v node || true)"
if [[ -z "$node_binary" || ! -x "$node_binary" ]]; then
  echo 'Node.js 22 or newer is required to package the workspace' >&2
  exit 1
fi
node_binary="$(readlink -f "$node_binary")"
node_major="$("$node_binary" --version | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
if [[ -z "$node_major" || "$node_major" -lt 22 ]]; then
  echo 'Node.js 22 or newer is required to package the workspace' >&2
  exit 1
fi
node_license="$(dirname "$(dirname "$node_binary")")/LICENSE"
if [[ ! -f "$node_license" ]]; then
  echo 'Node.js license unavailable' >&2
  exit 1
fi

pnpm build:host
node scripts/stage-workspace-vm.mjs
cargo build --offline --release --manifest-path src-tauri/Cargo.toml --bin preview-helper
mkdir -p src-tauri/binaries
cp src-tauri/target/release/preview-helper "src-tauri/binaries/preview-helper-$target"
cp -L "$node_binary" "src-tauri/binaries/node-$target"
cp "$node_license" src-tauri/binaries/NODE-LICENSE
cargo tauri build --bundles deb --ci --config '{"identifier":"com.safetech.inheriti.workspace.'"$deployment"'","bundle":{"active":true,"resources":{"../dist/host.cjs":"host.cjs","../dist/node_modules":"node_modules","binaries/node-'"$target"'":"node","binaries/NODE-LICENSE":"NODE-LICENSE","workspace-vm/":"workspace-vm/"},"externalBin":["binaries/preview-helper"],"linux":{"deb":{"depends":["bubblewrap","libc-bin","poppler-utils"]}}}}'
