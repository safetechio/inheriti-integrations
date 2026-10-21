# Inheriti® Workspace architecture

Workspace has three core responsibilities. Their names indicate where a rule or failure belongs.

| Area | Location | Responsibility |
| --- | --- | --- |
| Access | `src-tauri/sidecar/access/`, `src-tauri/src/access/` | Read the protected file, use the existing Business and Client SDK path for authorization and decryption, and provide authorized bytes to a processing boundary. Rust does not create another access authority. |
| Session | `src-tauri/sidecar/session/`, `src-tauri/src/session/` | Keep the operator's identity and organization in the sidecar; manage admitted files, session state and cleanup in Rust. |
| Isolation | `src-tauri/src/isolation/` | Keep file processing away from ordinary host applications. The limited preview and the disposable QEMU guest are separate boundaries within this area. |

`src-tauri/src/host/` contains Tauri commands and transport adapters. `src-tauri/sidecar/` is the Node process that integrates Business and the Client SDK. `ui/` presents the flow, `guest/` builds the guest system, `scripts/` packages components, and `tests/` groups verification by boundary.

## Processing boundaries

The protected-file preview and the disposable guest have distinct display paths:

```text
Protected-file preview
Saved .inheriti file
        ↓
Workspace UI → Tauri → Node sidecar
        ↓
Business access check + Client SDK decryption
        ↓
Isolated preview helper → Workspace preview window
        ↓
Close or expiry → preview content removed

Disposable guest session
Authorized bytes at the guest handoff
        ↓
Rust session → QEMU guest → compatible application inside the guest
                                ↓
                         QEMU guest display
        ↓
Close → terminate guest and discard its temporary state
```

The native session receives authorized bytes through an access handoff; it does not decrypt `.inheriti` files. The guest uses its own memory and temporary `tmpfs` storage. Its default QEMU specification has no disk, guest network or host folder. An approved application adapter adds one read-only virtual disk containing the application; it does not contain the decrypted file. The guest display is QEMU's display, not a rendered file returned to Tauri. Each file entering a session needs its own authorization. Host applications must never receive decrypted file bytes as a fallback.

## Guest application map

The guest keeps file recognition and application choice separate:

```text
Signed adapter manifest → verified download/cache → read-only guest attachment
                                           ↓
Authorized bytes → format_catalog.c (validate family and size)
                 → applications/catalog.c (base or approved adapter binding)
                 → applications/{image,pdf,text,optional}/launch.c (arguments)
                 → application runs inside the disposable guest
```

`applications/catalog.c` is the quick map of applications actually available in the guest. Its base image binding uses `feh`; its PDF binding uses `mupdf-x11`; its text binding uses `xterm` and `less`, including the limited DOCX, XLSX and ZIP views. Document, spreadsheet and archive converters live in `documents/`, `xlsx/` and `archive/`. The optional document binding selects WordCraft for DOCX; the optional spreadsheet binding selects GridCraft, with Gnumeric retained as an explicit compatibility choice; the optional video binding selects mpv for validated MP4 and WebM content. Optional adapters have a signed versioned manifest, a persistent application-only host cache, and a read-only image. The guest verifies the signature, architecture and image hash before mounting, then matches the adapter's family to the validated file content. A replacement application changes its adapter package and launcher without changing access, session policy or the three host platform transports.

## Ownership rules

1. Put preview MIME, platform and byte-size policy in `src-tauri/sidecar/access/policy.ts`. Put session file names, admission and aggregate limits in `src-tauri/src/session/policy.rs`.
2. Keep `session::GuestRuntime` as the outbound port. Session code orchestrates; `isolation::guest` owns platform processes, ingress and cleanup.
3. Keep Tauri commands and the Node protocol as inbound adapters. The UI and QEMU do not decide access.
4. Keep tests under `tests/` by boundary. Unit tests use a fake runtime; VM tests require an explicit native host setup.
5. `src-tauri/src/workspace.rs` preserves older Rust import paths. New code imports `access`, `session` or `isolation` directly.
