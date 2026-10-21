# Workspace VM packaging input

Release packaging requires `INHERITI_WORKSPACE_VM_DIR` and
`INHERITI_WORKSPACE_VM_MANIFEST_SHA256`. The latter is the SHA-256 of the exact
bytes of `manifest.sha256.json` and must be fixed in the trusted release build
configuration after the QEMU and guest image version is reviewed.

The input directory contains the native host executable
`qemu-system-x86_64` or `qemu-system-aarch64` (`.exe` on Windows), `vmlinuz`,
`initramfs`, a nonempty `LICENSES/` directory, and `manifest.sha256.json`.
Include any QEMU runtime libraries and data in this same directory. The
manifest has this shape:

```json
{"schema":1,"files":{"qemu-system-x86_64":"<sha256>","vmlinuz":"<sha256>","initramfs":"<sha256>","LICENSES/QEMU.txt":"<sha256>"}}
```

Every regular file except the manifest must be listed by its relative path
with `/` separators; no extra files or symbolic links are accepted. Packaging
checks the pinned manifest hash, each listed hash, and the copied bundle before
Tauri includes it under `Contents/Resources/workspace-vm/` on macOS or the
equivalent Tauri resource directory on Linux and Windows. The build does not
download or create QEMU and guest assets.

QEMU's SDL caption includes a hard-coded `QEMU` prefix even when `-name` is
supplied. Build the bundled QEMU with
[`qemu/sdl-workspace-title.patch`](qemu/sdl-workspace-title.patch) applied to
`ui/sdl2.c` so the VM window uses `Inheriti® Workspace` on Linux, Windows and
macOS. The patch changes only the caption. Release packaging rejects an
unbranded display binary. Local Linux GUI probes prepared with
`tests/workspace-guest/prepare-local-qemu.sh --gui` also replace the known SDL
caption and stop if that module differs from the expected build.

On macOS, Developer ID signing changes the bytes of QEMU and any bundled
Mach-O plugins. Packaging first verifies the copied bundle against the pinned
input manifest. It then signs the binaries, stores the original pinned
manifest as `Contents/Resources/workspace-vm-input-manifest.sha256.json`, and
replaces `workspace-vm/manifest.sha256.json` with hashes of the final signed
bytes. Packaging verifies the final manifest and file inventory before signing
the containing `.app`. The input manifest remains available to trace the
reviewed source bundle; the manifest inside `workspace-vm/` describes the
installed files.
