#!/usr/bin/env bash
# Developer-only QEMU/KVM and verified Alpine kernel; does not install host packages.
set -euo pipefail

output="${1:?usage: prepare-local-qemu.sh OUTPUT_DIRECTORY [--gui]}"
gui_package=""
case "${2:-}" in
  "") ;;
  --gui) gui_package=qemu-system-gui ;;
  *) printf 'usage: prepare-local-qemu.sh OUTPUT_DIRECTORY [--gui]\n' >&2; exit 2 ;;
esac
if [ "$#" -gt 2 ]; then
  printf 'usage: prepare-local-qemu.sh OUTPUT_DIRECTORY [--gui]\n' >&2
  exit 2
fi
mkdir -p -- "$output"
output="$(cd -- "$output" && pwd)"
stage="$(mktemp -d)"
container_id=""
cleanup() {
  if [ -n "$container_id" ]; then docker rm "$container_id" >/dev/null 2>&1 || true; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

cat > "$stage/Dockerfile" <<'EOF'
FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac
ARG EXTRA_QEMU_PACKAGE
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends qemu-system-x86 ${EXTRA_QEMU_PACKAGE} && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/qemu-system-x86_64"]
EOF
docker build --pull=false -q --build-arg "EXTRA_QEMU_PACKAGE=$gui_package" -t inheriti-workspace-qemu-local "$stage"
container_id="$(docker create inheriti-workspace-qemu-local)"
mkdir -p -- "$output/rootfs"
docker export "$container_id" | tar --no-same-owner -xf - -C "$output/rootfs"
docker rm "$container_id" >/dev/null
container_id=""
ln -sfn ../seabios/bios-256k.bin "$output/rootfs/usr/share/qemu/bios-256k.bin"

iso="$output/alpine-virt-3.24.2-x86_64.iso"
iso_hash=3ab424762af704b2c2a9e57df1dc37f982af260071504d977f2fb96822e7130b
if ! printf '%s  %s\n' "$iso_hash" "$iso" | sha256sum -c - >/dev/null 2>&1; then
  candidate="$stage/alpine-virt.iso"
  curl -fL --retry 2 --max-time 120 -o "$candidate" \
    https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-virt-3.24.2-x86_64.iso
  printf '%s  %s\n' "$iso_hash" "$candidate" | sha256sum -c -
  mv -f -- "$candidate" "$iso"
fi
printf '%s  %s\n' "$iso_hash" "$iso" | sha256sum -c -
isoinfo -R -i "$iso" -x /boot/vmlinuz-virt > "$output/vmlinuz-virt"

cat > "$output/qemu-local" <<'EOF'
#!/bin/sh
set -eu
base="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/rootfs"
export QEMU_MODULE_DIR="$base/usr/lib/x86_64-linux-gnu/qemu"
exec "$base/lib64/ld-linux-x86-64.so.2" \
  --library-path "$base/lib/x86_64-linux-gnu:$base/usr/lib/x86_64-linux-gnu:$base/usr/lib/x86_64-linux-gnu/pulseaudio" \
  "$base/usr/bin/qemu-system-x86_64" -L "$base/usr/share/qemu" "$@"
EOF
chmod 0700 "$output/qemu-local"
"$output/qemu-local" --version | head -1
if [ -n "$gui_package" ]; then
  "$output/qemu-local" -display help | grep -E '(^|[[:space:]])sdl([[:space:]]|$)'
fi
sha256sum "$output/vmlinuz-virt"
printf 'Developer QEMU ready in %s; no host package installed.\n' "$output"
