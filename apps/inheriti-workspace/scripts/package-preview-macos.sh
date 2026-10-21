#!/usr/bin/env bash
set -euo pipefail

# Run on the staged .app before DMG creation/notarization; a previously built DMG is unchanged.

cd "$(dirname "$0")/.."
deployment="${INHERITI_BUILD_DEPLOYMENT:-local}"
if [[ ! "$deployment" =~ ^(local|dev|stg|prod)$ ]]; then echo 'Invalid Workspace deployment' >&2; exit 1; fi
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'macOS preview packaging requires a Mac' >&2
  exit 1
fi
if [[ $# -ne 1 || ! -d "$1/Contents/MacOS" ]]; then
  echo 'usage: package-preview-macos.sh /path/to/Inheriti® Workspace.app' >&2
  exit 1
fi
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo 'APPLE_SIGNING_IDENTITY is required' >&2
  exit 1
fi
if [[ "$APPLE_SIGNING_IDENTITY" == '-' ]]; then
  echo 'Developer ID signing is required for isolated preview' >&2
  exit 1
fi

cargo build --offline --release --manifest-path src-tauri/Cargo.toml --bin preview-helper
app="$1"
if [[ ! -x src-tauri/target/release/workspace-supervisor ]]; then
  echo 'Workspace supervisor unavailable' >&2
  exit 1
fi
cp src-tauri/target/release/workspace-supervisor "$app/Contents/MacOS/workspace-supervisor"
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$app/Contents/MacOS/workspace-supervisor"
codesign --verify --strict "$app/Contents/MacOS/workspace-supervisor"
vm="$app/Contents/Resources/workspace-vm"
if [[ ! -d "$vm" ]]; then
  echo 'Packaged Workspace VM unavailable' >&2
  exit 1
fi
# Tauri copied the pinned input bundle. Verify it before codesign mutates Mach-O bytes.
node scripts/seal-signed-vm.mjs verify "$vm" "${INHERITI_WORKSPACE_VM_MANIFEST_SHA256:-}"
qemu_arch="$(uname -m)"
if [[ "$qemu_arch" == arm64 ]]; then qemu_arch=aarch64; fi
qemu="$vm/qemu-system-$qemu_arch"
if [[ ! -x "$qemu" ]]; then
  echo 'Packaged QEMU executable unavailable' >&2
  exit 1
fi
# QEMU distributions may carry Mach-O plugins without a .dylib suffix. Sign
# every nested Mach-O before signing the executable and its containing app.
while IFS= read -r -d '' component; do
  if [[ "$component" != "$qemu" ]] && file -b "$component" | grep -q 'Mach-O'; then
    codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$component"
    codesign --verify --strict "$component"
  fi
done < <(find "$vm" -type f -print0)
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" \
  --entitlements scripts/qemu-macos.entitlements "$qemu"
codesign --verify --strict "$qemu"
# Preserve the pinned input manifest outside the VM, then publish a manifest
# matching the signed bytes inside the final VM bundle.
node scripts/seal-signed-vm.mjs seal "$vm" "${INHERITI_WORKSPACE_VM_MANIFEST_SHA256:-}" \
  "$app/Contents/Resources/workspace-vm-input-manifest.sha256.json"
helper_app="$app/Contents/Helpers/Inheriti® Preview.app"
mkdir -p "$helper_app/Contents/MacOS"
cp src-tauri/target/release/preview-helper "$helper_app/Contents/MacOS/preview-helper"
cat > "$helper_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.safetech.inheriti.workspace.preview</string>
  <key>CFBundleExecutable</key><string>preview-helper</string>
  <key>CFBundleName</key><string>Inheriti® Preview</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
</dict></plist>
PLIST

codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" \
  --identifier com.safetech.inheriti.workspace.preview \
  --entitlements scripts/preview-macos.entitlements "$helper_app"
if [[ ! -f "$app/Contents/Resources/node" ]]; then
  echo 'Packaged Node.js runtime unavailable' >&2
  exit 1
fi
for resource in host.cjs workspace-vm/manifest.sha256.json; do
  if [[ ! -f "$app/Contents/Resources/$resource" ]]; then
    echo "Packaged Workspace resource unavailable: $resource" >&2
    exit 1
  fi
done
keyring_arch="$(uname -m)"
if [[ "$keyring_arch" == x86_64 ]]; then keyring_arch=x64; fi
keyring="$app/Contents/Resources/node_modules/@napi-rs/keyring/keyring.darwin-$keyring_arch.node"
if [[ ! -f "$keyring" ]]; then
  echo 'Packaged keychain binding unavailable' >&2
  exit 1
fi
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$keyring"
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" \
  --entitlements scripts/node-macos.entitlements "$app/Contents/Resources/node"
codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$app"
codesign --verify --strict --deep \
  -R "anchor apple generic and identifier \"com.safetech.inheriti.workspace.$deployment\"" "$app"
codesign --verify --strict \
  -R 'anchor apple generic and identifier "com.safetech.inheriti.workspace.preview"' "$helper_app/Contents/MacOS/preview-helper"
codesign -d --entitlements - --xml "$helper_app/Contents/MacOS/preview-helper" \
  | plutil -extract 'com\.apple\.security\.app-sandbox' raw -o - - \
  | grep -qx true
