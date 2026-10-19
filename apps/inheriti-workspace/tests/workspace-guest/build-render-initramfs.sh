#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
output="${1:?usage: build-render-initramfs.sh OUTPUT.cpio.gz}"
alpine_image='alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6'
stage="$(mktemp -d)"
chmod 0755 "$stage"
trap 'docker run --rm -v "$stage:/out" "$alpine_image" chown -R '"$(id -u):$(id -g)"' /out >/dev/null 2>&1 || true; rm -r -- "$stage"' EXIT

# Build-time package fetch only. The booted VM has -nic none and no disks.
docker run --rm --network bridge -v "$stage:/out" "$alpine_image" sh -ec '
  apk add --no-cache \
    poppler-utils=25.12.0-r1 libjpeg-turbo-utils=3.1.3-r0 >/dev/null
  tar -C / -cf - bin usr lib etc sbin | tar -C /out -xf -
  chown -R '"$(id -u):$(id -g)"' /out
'
mkdir -p "$stage"/{dev,proc,sys,run}
gcc -O2 -Wall -Wextra -Werror -static -DWORKSPACE_RENDER_PROBE \
  -o "$stage/bin/guest-agent" "$script_dir/guest-agent.c"
cp -- "$script_dir/init" "$stage/init"
chmod 0755 "$stage/init"
mkdir -p -- "$(dirname -- "$output")"
output="$(cd -- "$(dirname -- "$output")" && pwd)/$(basename -- "$output")"
(cd "$stage" && find . -print0 | sort -z | cpio --null -o --format=newc 2>/dev/null | gzip -n -9) > "$output"
printf 'built renderer probe %s (%s bytes)\n' "$output" "$(stat -c %s "$output")"
