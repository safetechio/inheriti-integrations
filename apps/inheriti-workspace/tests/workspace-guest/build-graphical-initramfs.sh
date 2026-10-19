#!/usr/bin/env bash
# Developer-only graphical appliance probe; never stage this as a product VM.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/../.." && pwd)"
output="${1:?usage: build-graphical-initramfs.sh OUTPUT.cpio.gz [ALPINE_ISO]}"
alpine_iso="${2:-$(dirname -- "$output")/alpine-virt-3.24.2-x86_64.iso}"
iso_hash='3ab424762af704b2c2a9e57df1dc37f982af260071504d977f2fb96822e7130b'
printf '%s  %s\n' "$iso_hash" "$alpine_iso" | sha256sum -c -
command -v isoinfo >/dev/null
command -v unsquashfs >/dev/null
alpine_image='alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6'
stage="$(mktemp -d)"
container_id=""
cleanup() {
  if [ -n "$container_id" ]; then docker rm "$container_id" >/dev/null 2>&1 || true; fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

mkdir -p "$stage/rootfs"
# Package downloads happen at build time. The booted VM has no NIC or disk.
cat > "$stage/Dockerfile" <<'EOF'
FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk add --no-cache \
    eudev=3.2.14-r6 \
    feh=3.12.2-r0 \
    xf86-input-libinput=1.5.0-r0 \
    xorg-server=21.1.25-r0
EOF
image_id="$(docker build --pull=false -q "$stage")"
container_id="$(docker create "$image_id")"
docker export "$container_id" | tar --no-same-owner -xf - -C "$stage/rootfs"
docker rm "$container_id" >/dev/null
container_id=""

# The test display uses Xorg's KMS shadow framebuffer, not OpenGL. Alpine's
# Mesa dependency otherwise brings ~225 MiB of LLVM/Gallium into every VM.
# Force the documented modesetting AccelMethod=none before removing those
# software-rendering libraries. This is deliberately probe-only policy.
mkdir -p "$stage/rootfs/etc/X11/xorg.conf.d"
cat > "$stage/rootfs/etc/X11/xorg.conf.d/20-workspace-probe.conf" <<'EOF'
Section "Device"
    Identifier "Virtio GPU (software framebuffer)"
    Driver "modesetting"
    Option "AccelMethod" "none"
    Option "PageFlip" "off"
EndSection
EOF
rm -f -- "$stage/rootfs"/usr/lib/libLLVM.so.* \
  "$stage/rootfs"/usr/lib/libgallium-*.so
rm -rf -- "$stage/rootfs/usr/lib/dri" \
  "$stage/rootfs/usr/share/misc"

# The verified ISO kernel keeps virtio-gpu as a module in its matching modloop.
# Copy only virtio-gpu and its dependency closure, never the whole modloop.
isoinfo -R -i "$alpine_iso" -x /boot/modloop-virt > "$stage/modloop-virt"
kernel_version='6.18.52-0-virt'
module_dep="$(unsquashfs -cat "$stage/modloop-virt" "modules/$kernel_version/modules.dep" |
  rg '^kernel/drivers/gpu/drm/virtio/virtio-gpu\.ko:')"
[ -n "$module_dep" ] || { echo 'verified ISO lacks expected virtio-gpu dependencies' >&2; exit 1; }
read -r -a module_files <<< "${module_dep//:/}"
module_paths=()
for module in "${module_files[@]}"; do module_paths+=("modules/$kernel_version/$module"); done
module_paths+=("modules/$kernel_version/modules.dep" "modules/$kernel_version/modules.alias")
unsquashfs -quiet -d "$stage/modules" "$stage/modloop-virt" "${module_paths[@]}"
cp -a -- "$stage/modules/modules" "$stage/rootfs/usr/lib/"
ln -s ../usr/lib/modules "$stage/rootfs/lib/modules"

mkdir -p "$stage/rootfs"/{dev,proc,sys,run,tmp}
gcc -O2 -Wall -Wextra -Werror -static \
  -o "$stage/rootfs/usr/sbin/workspace-agent" \
  "$app_dir/guest/package/workspace-agent/workspace-agent.c"
cp -- "$app_dir/guest/overlay/init" "$stage/rootfs/init"
# Test-only trace reaches the serial console and identifies early boot exits.
# Keep the production overlay untouched.
sed -i '/^set -eu$/a set -x' "$stage/rootfs/init"
sed -i 's/poweroff -f/probe_poweroff/g' "$stage/rootfs/init"
sed -i '/^set -x$/a probe_poweroff() { echo "probe: shutting down; Xorg log follows" >&2; [ ! -f /run/Xorg.log ] || cat /run/Xorg.log >&2; /sbin/poweroff -f; }' "$stage/rootfs/init"
sed -i '/^mount -t devtmpfs devtmpfs \/dev$/a exec >/dev/ttyS0 2>\&1' "$stage/rootfs/init"
sed -i '/^\/sbin\/udevadm settle --timeout=10$/a /sbin/modprobe virtio-gpu\n[ -c /dev/dri/card0 ] || probe_poweroff' "$stage/rootfs/init"
sed -i 's#Xorg :0 -ac -nolisten tcp#Xorg :0 -ac -nolisten tcp -extension GLX#' "$stage/rootfs/init"
chmod 0755 "$stage/rootfs/init"

uncompressed_bytes="$(du -sb "$stage/rootfs" | cut -f1)"

mkdir -p -- "$(dirname -- "$output")"
output="$(cd -- "$(dirname -- "$output")" && pwd)/$(basename -- "$output")"
(cd "$stage/rootfs" && find . -print0 | sort -z | cpio --null -o --format=newc 2>/dev/null | gzip -n -9) > "$output"
sha256sum "$output"
printf 'Developer-only graphical probe: %s (%s bytes compressed; %s bytes extracted)\n' \
  "$output" "$(stat -c %s "$output")" "$uncompressed_bytes"
