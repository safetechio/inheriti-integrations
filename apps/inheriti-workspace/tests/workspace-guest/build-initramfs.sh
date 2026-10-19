#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
output="${1:?usage: build-initramfs.sh OUTPUT.cpio.gz}"
busybox="${BUSYBOX_STATIC:-/usr/bin/busybox}"
command -v gcc >/dev/null
command -v cpio >/dev/null
command -v gzip >/dev/null
file "$busybox" | grep -q 'statically linked' || { echo 'BUSYBOX_STATIC must be statically linked' >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage"/{bin,dev,proc,sys,run}
cp -- "$busybox" "$stage/bin/busybox"
gcc -O2 -Wall -Wextra -Werror -static -o "$stage/bin/guest-agent" "$script_dir/guest-agent.c"
cp -- "$script_dir/init" "$stage/init"
chmod 0755 "$stage/init"
mkdir -p -- "$(dirname -- "$output")"
output="$(cd -- "$(dirname -- "$output")" && pwd)/$(basename -- "$output")"
(cd "$stage" && find . -print0 | sort -z | cpio --null -o --format=newc 2>/dev/null | gzip -n -9) > "$output"
printf 'built %s (%s bytes)\n' "$output" "$(stat -c %s "$output")"
