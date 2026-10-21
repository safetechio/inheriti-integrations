# The Workspace virtual machine

This folder builds the small Linux computer that Inheriti® Workspace starts inside your computer. In the code, **guest** means that virtual computer; **host** means your Windows, macOS, or Linux computer.

```text
Your computer (host)
  └─ Inheriti® Workspace
       └─ Temporary virtual computer (guest)
            └─ Viewer opens the file here
```

Workspace sends an authorized file into the virtual computer. Its viewer and temporary files stay there. Closing the session shuts that computer down and discards its contents. It has no connection to your computer's files or network, and it does not use apps installed on your computer.

The image includes a small set of viewers:

| File content | Viewer inside the virtual computer |
| --- | --- |
| PNG, JPEG | Image viewer |
| PDF | MuPDF's X11 document viewer |
| UTF-8 text, JSON, CSV | Read-only terminal viewer |
| XLSX | Read-only cell table in the terminal viewer |
| DOCX, ODT | Read-only extracted text in the terminal viewer |
| ZIP | Read-only index of names and sizes, without extracting members |

The [format catalog](package/workspace-agent/format_catalog.c) identifies supported content and its limits. The [application map](package/workspace-agent/applications/catalog.c) shows which installed program opens each view; launch arguments live beside it under `applications/image/`, `applications/pdf/` and `applications/text/`. Document, spreadsheet and archive converters stay in their own family folders. The same Linux image is used on Linux, Windows and macOS hosts; the host never opens decrypted bytes with its own applications.

An optional application can be downloaded once and reused from Workspace's application cache. Its signed manifest names the version, Linux architecture, family, maximum size, download URL and image hash. Workspace verifies the manifest and image before launch; this virtual computer verifies them again before mounting the image read-only. The image supplies a `family` file and executable `bin/launch` wrapper. The protected document and any output remain in the temporary virtual computer, while only the application image persists in the cache. The release public key must be included in the virtual computer; its private signing key stays outside this repository.

## Build and test

Use the pinned `buildroot-2026.08.tar.xz` archive (SHA-256 `87aaca4164ea9d5c8085854953018263f7963f07c22e73a2a2185cc98c581c34`). The script checks it before extracting it.

From `apps/inheriti-workspace`:

```sh
./guest/build.sh --check x86_64 /path/buildroot-2026.08.tar.xz /tmp/workspace-guest-x86
./guest/build.sh --check aarch64 /path/buildroot-2026.08.tar.xz /tmp/workspace-guest-arm
python3 tests/guest/test_agent.py
```

To build an image, replace `--check` with `--build` and set `WORKSPACE_BUILD_JOBS=1` or `2` to bound memory use. Each build writes a kernel, `rootfs.cpio.gz`, checksums, and a source manifest under `artifacts-<arch>/`. Package only these verified product artifacts, with their required license notices. The images under `tests/workspace-guest` are test fixtures, not the product image.
