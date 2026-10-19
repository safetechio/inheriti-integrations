#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
deployment="${INHERITI_BUILD_DEPLOYMENT:-local}"
if [[ ! "$deployment" =~ ^(local|dev|stg|prod)$ ]]; then echo 'Invalid Workspace deployment' >&2; exit 1; fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'macOS packaging requires a Mac' >&2
  exit 1
fi
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" || "$APPLE_SIGNING_IDENTITY" == '-' ]]; then
  echo 'Developer ID APPLE_SIGNING_IDENTITY is required' >&2
  exit 1
fi

target="$(rustc -vV | sed -n 's/^host: //p')"
if [[ -z "$target" ]]; then
  echo 'Rust host target unavailable' >&2
  exit 1
fi
node_binary="$(command -v node || true)"
if [[ -z "$node_binary" || ! -x "$node_binary" ]]; then
  echo 'Node.js 22 or newer is required' >&2
  exit 1
fi
node_binary="$(realpath "$node_binary")"
node_major="$("$node_binary" --version | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
if [[ -z "$node_major" || "$node_major" -lt 22 ]]; then
  echo 'Node.js 22 or newer is required' >&2
  exit 1
fi
node_license="$(dirname "$(dirname "$node_binary")")/LICENSE"
if [[ ! -f "$node_license" ]]; then
  echo 'Node.js license unavailable' >&2
  exit 1
fi

pnpm build:host
node scripts/stage-workspace-vm.mjs
cargo build --offline --release --manifest-path src-tauri/Cargo.toml --bin workspace-supervisor
mkdir -p src-tauri/binaries
cp "$node_binary" "src-tauri/binaries/node-$target"
cp "$node_license" src-tauri/binaries/NODE-LICENSE

# The helper is added after Tauri builds the app, so the DMG must use that staged app.
cargo tauri build --bundles app --ci --config '{"identifier":"com.safetech.inheriti.workspace.'"$deployment"'","bundle":{"active":true,"resources":{"../dist/host.cjs":"host.cjs","../dist/node_modules":"node_modules","binaries/node-'"$target"'":"node","binaries/NODE-LICENSE":"NODE-LICENSE","workspace-vm/":"workspace-vm/"}}}'
app='src-tauri/target/release/bundle/macos/Inheriti Workspace.app'
if [[ ! -d "$app" ]]; then
  echo 'Tauri app bundle unavailable' >&2
  exit 1
fi
bash scripts/package-preview-macos.sh "$app"

version="$(node -p 'require("./package.json").version')"
arch="$(uname -m)"
mkdir -p src-tauri/target/release/bundle/dmg
dmg="src-tauri/target/release/bundle/dmg/Inheriti Workspace_${version}_${arch}.dmg"
rm -f "$dmg"
hdiutil create -volname 'Inheriti Workspace' -srcfolder "$app" -ov -format UDZO "$dmg"
codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
codesign --verify "$dmg"
