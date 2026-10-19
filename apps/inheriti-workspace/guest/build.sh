#!/usr/bin/env bash
# Build or validate the two diskless guest variants from a pinned Buildroot release.
set -euo pipefail

usage() {
    echo "usage: $0 --check|--build x86_64|aarch64 /path/buildroot-2026.08.tar.xz /path/output" >&2
    exit 2
}
[ "$#" -eq 4 ] || usage
mode=$1
arch=$2
archive=$3
output=$4
case "$mode" in --check|--build) ;; *) usage ;; esac
case "$arch" in x86_64|aarch64) ;; *) usage ;; esac
[ -f "$archive" ] || { echo "Buildroot archive missing: $archive" >&2; exit 2; }
guest_dir=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$output"
output=$(cd "$output" && pwd -P)
archive=$(cd "$(dirname "$archive")" && pwd -P)/$(basename "$archive")
export BR2_DL_DIR="$output/dl"
expected=87aaca4164ea9d5c8085854953018263f7963f07c22e73a2a2185cc98c581c34
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
[ "$actual" = "$expected" ] || { echo "Buildroot 2026.08 checksum mismatch" >&2; exit 2; }

source_dir="$output/buildroot-2026.08"
if [ ! -f "$source_dir/Makefile" ]; then
    tar -xJf "$archive" -C "$output"
fi
build_dir="$output/build-$arch"
make -C "$source_dir" BR2_EXTERNAL="$guest_dir" O="$build_dir" "workspace_${arch}_defconfig"

config="$build_dir/.config"
for option in BR2_PACKAGE_WORKSPACE_AGENT BR2_PACKAGE_FEH BR2_PACKAGE_XTERM BR2_PACKAGE_LESS \
    BR2_PACKAGE_DEJAVU BR2_PACKAGE_DEJAVU_MONO \
    BR2_PACKAGE_LIBZIP BR2_PACKAGE_LIBXML2 BR2_PACKAGE_MUPDF \
    BR2_PACKAGE_OPENSSL BR2_PACKAGE_LIBOPENSSL_BIN \
    BR2_PACKAGE_XSERVER_XORG_SERVER_MODULAR BR2_TARGET_ROOTFS_CPIO \
    BR2_TARGET_ROOTFS_CPIO_GZIP BR2_LINUX_KERNEL \
    BR2_ROOTFS_DEVICE_CREATION_DYNAMIC_EUDEV BR2_PACKAGE_EUDEV \
    BR2_PACKAGE_XDRIVER_XF86_INPUT_LIBINPUT; do
    grep -qx "$option=y" "$config" || { echo "Missing selected option: $option" >&2; exit 2; }
done
if grep -q '^BR2_TARGET_GENERIC_GETTY=y$' "$config"; then
    echo "Guest must have no login prompt" >&2
    exit 2
fi
case "$arch" in
    x86_64) kernel_config="board/qemu/x86_64/linux.config" ;;
    aarch64) kernel_config="board/qemu/aarch64-virt/linux.config" ;;
esac
grep -qx "BR2_LINUX_KERNEL_CUSTOM_CONFIG_FILE=\"$kernel_config\"" "$config" || {
    echo "Unexpected guest kernel configuration" >&2
    exit 2
}
fragment="$guest_dir/configs/no_sit_interface.fragment"
grep -Fxq 'BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_INHERITI_WORKSPACE_PATH)/configs/no_sit_interface.fragment"' "$config" || {
    echo "Unexpected guest kernel configuration fragment" >&2
    exit 2
}
grep -Fxq 'BR2_ROOTFS_POST_BUILD_SCRIPT="$(BR2_EXTERNAL_INHERITI_WORKSPACE_PATH)/post-build.sh"' "$config" || {
    echo "Guest public-key staging hook is missing" >&2
    exit 2
}
grep -qx '# CONFIG_IPV6_SIT is not set' "$fragment" || {
    echo "Guest kernel must not create a sit0 tunnel interface" >&2
    exit 2
}
for option in CONFIG_VIRTIO_BLK CONFIG_EXT4_FS CONFIG_SND CONFIG_SND_PCM CONFIG_SND_VIRTIO; do
    grep -qx "$option=y" "$fragment" || {
        echo "Guest kernel lacks required built-in option: $option" >&2
        exit 2
    }
done
for option in CONFIG_VIRTIO_CONSOLE CONFIG_DRM_VIRTIO_GPU \
    CONFIG_VIRTIO_INPUT CONFIG_INPUT_EVDEV CONFIG_TMPFS; do
    grep -qx "$option=y" "$source_dir/$kernel_config" || {
        echo "Kernel lacks required built-in option: $option" >&2
        exit 2
    }
done
if [ "$mode" = --check ]; then
    echo "Buildroot 2026.08 $arch configuration valid; no image built"
    exit 0
fi

# Buildroot compiles a toolchain, kernel, Xorg and feh. Keep RAM demand bounded.
jobs=${WORKSPACE_BUILD_JOBS:-2}
case "$jobs" in 1|2) ;; *) echo "WORKSPACE_BUILD_JOBS must be 1 or 2" >&2; exit 2 ;; esac
export WORKSPACE_ADAPTER_PUBLIC_KEY_PEM
make -C "$source_dir" BR2_EXTERNAL="$guest_dir" O="$build_dir" -j"$jobs"
make -C "$source_dir" BR2_EXTERNAL="$guest_dir" O="$build_dir" legal-info

case "$arch" in
    x86_64) kernel="$build_dir/images/bzImage" ;;
    aarch64) kernel="$build_dir/images/Image" ;;
esac
rootfs="$build_dir/images/rootfs.cpio.gz"
[ -s "$kernel" ] && [ -s "$rootfs" ] || { echo "Buildroot did not produce kernel and external initramfs" >&2; exit 1; }
artifacts="$output/artifacts-$arch"
mkdir -p "$artifacts"
cp "$kernel" "$artifacts/kernel"
cp "$rootfs" "$artifacts/rootfs.cpio.gz"
(
    cd "$artifacts"
    sha256sum kernel rootfs.cpio.gz > SHA256SUMS
    printf 'buildroot_release=2026.08\nbuildroot_archive_sha256=%s\narchitecture=%s\n' \
        "$expected" "$arch" > SOURCE-MANIFEST
)
echo "Guest artifacts and checksums: $artifacts"
