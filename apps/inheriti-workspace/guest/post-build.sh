#!/usr/bin/env bash
# Stage the release verification key into the guest root filesystem.
set -euo pipefail

[ "$#" -eq 1 ] || { echo "usage: $0 TARGET_DIR" >&2; exit 2; }
target_dir=$1
destination="$target_dir/etc/workspace-adapter-pubkey.pem"
rm -f -- "$destination"

# A keyless image still opens built-in formats; optional applications fail closed.
[ -n "${WORKSPACE_ADAPTER_PUBLIC_KEY_PEM:-}" ] || exit 0
source_key=$WORKSPACE_ADAPTER_PUBLIC_KEY_PEM
if [ ! -f "$source_key" ] || [ -L "$source_key" ]; then
    echo "Adapter public key must be a regular, non-symlink file" >&2
    exit 2
fi
key_size=$(wc -c < "$source_key")
if [ "$key_size" -eq 0 ] || [ "$key_size" -gt 4096 ]; then
    echo "Adapter public key size is invalid" >&2
    exit 2
fi
canonical=$(mktemp "$target_dir/etc/.workspace-adapter-pubkey.XXXXXX")
trap 'rm -f -- "$canonical"' EXIT
if ! openssl pkey -pubin -in "$source_key" -pubout -out "$canonical" 2>/dev/null ||
   ! cmp -s -- "$source_key" "$canonical"; then
    echo "Adapter public key must contain only one canonical public PEM" >&2
    exit 2
fi
if ! openssl pkey -pubin -in "$canonical" -outform DER 2>/dev/null |
    openssl asn1parse -inform DER 2>/dev/null |
    grep -Eq 'OBJECT[[:space:]]*:ED25519$'; then
    echo "Adapter public key must be an Ed25519 public PEM" >&2
    exit 2
fi
install -m 0444 -- "$canonical" "$destination"
