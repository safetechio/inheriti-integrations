# Opt-in packaged runtime session probe

`workspace_vm::packaged_runtime_synthetic_file_session` exercises the shared
post-decryption boundary without Business or SafeKey. It reads the portable
corpus in `../fixtures/manifest.json` and uses
`platform::prepare_runtime_with_display(GraphicalSdl)` and
`Workspace::open_authorized` for each file. The authorization closure runs
only after the guest reports ready. Each file gets a separate VM session, which
is closed before the next file. The same corpus and platform factory path
exercise KVM on Linux, WHPX on Windows, and HVF on macOS. Linux also checks
that the private socket directory has no new entries after the corpus.

The manifest separates **portable session admission**, **guest admission** and
**guest launch acknowledgement**. The valid corpus includes PNG, PDF, XLSX,
TXT, JSON, CSV, DOCX, ODT and ZIP. The truncated PNG passes its signature
check but fails on launch. These assertions describe guest behavior; the test
does not add a file-type switch to the host runtime.

This is a **protocol/lifecycle probe**, not a pixel rendering or malware-isolation
acceptance test: the guest agent acknowledges launch, but the test does not
capture displayed pixels. The test needs a staged `workspace-vm` resource directory containing
the host's QEMU executable, `vmlinuz`, and `initramfs`. Produce that directory
through `scripts/stage-workspace-vm.mjs` from an independently verified VM
bundle; do not point it at arbitrary host binaries. The target host must have
hardware acceleration and an SDL-capable QEMU with a desktop display. The
product guest needs a virtio GPU and Xorg before it reports ready. Keep the
Linux probe opt-in because it boots a VM.

From `elements/inheriti-integrations`:

```sh
# Linux (x86_64 or aarch64): requires KVM, SDL/display and a private XDG_RUNTIME_DIR.
WORKSPACE_VM_RESOURCE_DIR="$PWD/apps/inheriti-workspace/src-tauri/workspace-vm" \
  CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test workspace_vm packaged_runtime_synthetic_file_session -- --ignored --nocapture
```

```powershell
# Windows PowerShell on the Windows host: requires WHPX and SDL/display.
$env:WORKSPACE_VM_RESOURCE_DIR = (Resolve-Path 'apps/inheriti-workspace/src-tauri/workspace-vm').Path
$env:CARGO_BUILD_JOBS = '1'
cargo test --locked --offline --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml --test workspace_vm packaged_runtime_synthetic_file_session -- --nocapture
```

```sh
# macOS (Intel or Apple Silicon): requires HVF, SDL/display, a native staged VM
# bundle, and a signed workspace-supervisor built for this Mac.
WORKSPACE_TEST_SUPERVISOR="/absolute/path/to/signed/workspace-supervisor" \
WORKSPACE_VM_RESOURCE_DIR="$PWD/apps/inheriti-workspace/src-tauri/workspace-vm" \
  CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test workspace_vm packaged_runtime_synthetic_file_session -- --nocapture
```

On Windows and macOS, an absent `WORKSPACE_VM_RESOURCE_DIR` skips this test;
providing it makes missing or invalid assets and boot failures fail the test.
On macOS, the test requires `WORKSPACE_TEST_SUPERVISOR` and stages a verified,
signed copy beside Cargo's test executable, where the production runtime looks
for its supervisor. The staged copy is removed when the test ends. A stale
`target/debug/deps/workspace-supervisor` must be removed manually after an
interrupted test; the test never overwrites it. The source can be the signed
binary from a locally built macOS app bundle.
Linux retains its explicit `--ignored` opt-in. A launch error on any host means
the local accelerator, bundle, guest boot, or virtio channel still needs
diagnosis. The test does not silently switch to software emulation.

The ordinary Linux `cargo test --test workspace_vm` reports the VM probes as
ignored. On Windows and macOS, it runs the corpus session only when the
resource variable is set. A cross-host compile cannot replace a native Windows
or macOS run.

The corpus session also rereads `tests/fixtures/manifest.json` after every
teardown as a host-side canary. This catches an accidental write into the
fixture directory, while the Linux socket snapshot catches leftover ingress
socket entries. Windows named-pipe and macOS supervisor cleanup are covered by
the successful `workspace.close()` call, but this test does not enumerate those
OS-specific kernel objects after teardown.

## Isolation evidence and network denial

The checked-in cross-host corpus test proves authorized byte ingress, launch
acknowledgement or rejection, and session teardown. It does not prove that a
guest cannot reach the network. Run the existing Linux injected-NIC probe with
the same verified kernel and initramfs to test that boundary:

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/vmlinuz \
WORKSPACE_INITRAMFS=/absolute/path/to/initramfs \
  CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test network_rejection_vm injected_nic_is_rejected_before_authorization \
  -- --ignored --nocapture
```

Expected evidence is a passing baseline guest open followed by a runtime
failure before the authorization closure runs, with no QEMU child and no
private socket residue. The probe is Linux-only. Native Windows and macOS
network denial still require a host-specific probe that inspects the guest
network devices or attempts a controlled connection from inside the guest;
the cross-host corpus run must not be reported as proof of that property.

## Linux signed optional adapter probe

`signed_optional_adapter_vm.py` is a separate, opt-in KVM probe for the dynamic
application path. It builds a tiny signed `document` adapter in a temporary
directory, boots the product guest with 384 MiB, sends the original DOCX bytes,
and requires both admission and launch acknowledgement. A second guest rejects
malformed OOXML before it reaches the optional application. A third guest starts
with one bit changed in the signature and must never
reports its workspace channel ready. QEMU is terminated and reaped on every path.

The signing key is never generated by this probe and is never copied into the
adapter image. Supply the private key used when the guest public key was staged,
plus that matching public PEM, so the probe checks the pair before boot. Use a
test or release key according to the guest image you are testing; do not place
either key in the repository.

```sh
python3 apps/inheriti-workspace/tests/vm/signed_optional_adapter_vm.py \
  --qemu /absolute/path/to/qemu-system-x86_64 \
  --kernel /absolute/path/to/artifacts-x86_64/kernel \
  --initramfs /absolute/path/to/artifacts-x86_64/rootfs.cpio.gz \
  --private-key /absolute/path/to/adapter-signing-private.pem \
  --public-key /absolute/path/to/adapter-signing-public.pem
```

The guest must have been built with the supplied public PEM at
`/etc/workspace-adapter-pubkey.pem`, and must contain the optional adapter
mount and original-file launch code. The probe is Linux x86_64 only because it
uses KVM and the x86_64 product image; its signed manifest, read-only disk,
signature rejection and 384 MiB budget mirror the cross-platform runtime
contract. It is not run by the normal unit or integration test commands.

## Linux real MuPDF cache and session probe

`real_optional_adapter_vm::real_mupdf_adapter_downloads_caches_and_opens_pdf`
is the first release-shaped optional-adapter probe. It receives a MuPDF image
created by `scripts/optional-adapter/recipes/mupdf/build.py`, its signed
manifest and signature, and the public key staged into the guest. The test
uses the production `prepare_runtime_for_signed_adapter` path: the first VM
session copies the image through a local test downloader, then
opens a PDF; the second VM session is started with that transport offline and
must resolve the identical image from the verified cache before opening the
same PDF. Each session uses a fresh disposable guest and 384 MiB.

This probe is intentionally ignored by default. It needs a Linux KVM guest
bundle, a real MuPDF adapter built for that guest, and no private key in the
repository:

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/vmlinuz \
WORKSPACE_INITRAMFS=/absolute/path/to/initramfs \
WORKSPACE_MUPDF_ADAPTER_IMAGE=/absolute/path/to/mupdf.bundle \
WORKSPACE_MUPDF_ADAPTER_MANIFEST=/absolute/path/to/mupdf.manifest \
WORKSPACE_MUPDF_ADAPTER_SIGNATURE=/absolute/path/to/mupdf.signature \
WORKSPACE_ADAPTER_PUBLIC_KEY_PEM=/absolute/path/to/adapter-signing-public.pem \
WORKSPACE_ADAPTER_PRIVATE_KEY_PEM=/absolute/path/to/test-only-signing-private.pem \
WORKSPACE_MUPDF_SCREENSHOT=/absolute/path/to/mupdf-cache-proof.ppm \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test real_optional_adapter_vm real_mupdf_adapter_downloads_caches_and_opens_pdf \
  -- --ignored --nocapture
```

The test stages a temporary QEMU wrapper and resource directory, replacing
SDL output with `-display none` when necessary. It checks download count,
cache bytes, guest launch, offline cache reuse, and cleanup. It also requests
a QEMU monitor screendump and checks PDF page pixels. Finally, it creates a
test-only signed copy whose launcher exits immediately; opening that copy must
fail, proving that the optional adapter was selected instead of silently
falling back to the built-in PDF viewer. The private PEM is used only for that
temporary negative control and must never be committed. A passing run proves
the signed MuPDF adapter lifecycle on Linux. The signed manifest still carries
an HTTPS URL, but this test does not request it over the network. It does not
by itself prove native Windows or macOS execution.

## Linux real Gnumeric cache and session probe

`real_gnumeric_adapter_vm::real_gnumeric_adapter_caches_and_opens_csv_and_xlsx`
is the spreadsheet equivalent of the MuPDF probe. It uses a Gnumeric adapter
built for the bounded spreadsheet guest, opens the checked-in CSV in the first
fresh VM, then switches the local transport offline and opens the XLSX in a
second fresh VM from the verified cache. Both sessions require real
spreadsheet pixels from a QEMU monitor screendump. A temporary validly signed
copy whose launcher exits must fail to open, proving that the optional
spreadsheet adapter was selected instead of a built-in fallback.

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/vmlinuz \
WORKSPACE_INITRAMFS=/absolute/path/to/spreadsheet-initramfs \
WORKSPACE_GNUMERIC_ADAPTER_IMAGE=/absolute/path/to/gnumeric.ext4 \
WORKSPACE_GNUMERIC_ADAPTER_MANIFEST=/absolute/path/to/gnumeric.manifest \
WORKSPACE_GNUMERIC_ADAPTER_SIGNATURE=/absolute/path/to/gnumeric.signature \
WORKSPACE_ADAPTER_PUBLIC_KEY_PEM=/absolute/path/to/adapter-signing-public.pem \
WORKSPACE_ADAPTER_PRIVATE_KEY_PEM=/absolute/path/to/test-only-signing-private.pem \
WORKSPACE_CSV_FIXTURE=/absolute/path/to/tests/fixtures/sample-table.csv \
WORKSPACE_XLSX_FIXTURE=/absolute/path/to/tests/fixtures/sample-spreadsheet.xlsx \
WORKSPACE_GNUMERIC_SCREENSHOT=/absolute/path/to/gnumeric-proof.ppm \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test real_gnumeric_adapter_vm real_gnumeric_adapter_caches_and_opens_csv_and_xlsx \
  -- --ignored --nocapture
```

The test keeps the VM at 384 MiB and uses no private key from the repository.
The private PEM exists only to sign the temporary negative control. A passing
run proves the Linux Gnumeric adapter lifecycle for CSV and XLSX; Windows and
macOS still require native runs.

## Linux real GridCraft cache and session probe

`real_gridcraft_adapter_vm::real_gridcraft_adapter_caches_and_opens_csv_and_xlsx`
is the opt-in probe for the GridCraft 0.8.0 spreadsheet adapter. It uses the
same signed adapter registry, cache, disposable 384 MiB guest, and graphical
pixel smoke assertion as the Gnumeric probe. The first session downloads and verifies
the signed GridCraft image before opening CSV. A second session runs with the
test transport offline and opens XLSX from the verified cache. A temporary
signed launcher that exits must fail, proving that the guest selected GridCraft
instead of silently falling back to a built-in viewer.

The graphical assertion waits for a complete PPM frame and two matching frames
from the test-only QEMU monitor. It checks that the optional application
produced a spreadsheet-like window, but does not perform OCR or prove specific
fixture cell values.

The GridCraft guest must include X11, xkbcommon, and EGL or Vulkan support. The
release archive and adapter image are not stored in the repository. This probe
does not run in ordinary test commands and has not been run on Windows or
macOS.

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/vmlinuz \
WORKSPACE_INITRAMFS=/absolute/path/to/gridcraft-initramfs \
WORKSPACE_GRIDCRAFT_ADAPTER_IMAGE=/absolute/path/to/gridcraft.ext4 \
WORKSPACE_GRIDCRAFT_ADAPTER_MANIFEST=/absolute/path/to/gridcraft.manifest \
WORKSPACE_GRIDCRAFT_ADAPTER_SIGNATURE=/absolute/path/to/gridcraft.signature \
WORKSPACE_ADAPTER_PUBLIC_KEY_PEM=/absolute/path/to/adapter-signing-public.pem \
WORKSPACE_ADAPTER_PRIVATE_KEY_PEM=/absolute/path/to/test-only-signing-private.pem \
WORKSPACE_CSV_FIXTURE=/absolute/path/to/tests/fixtures/sample-table.csv \
WORKSPACE_XLSX_FIXTURE=/absolute/path/to/tests/fixtures/sample-spreadsheet.xlsx \
WORKSPACE_GRIDCRAFT_SCREENSHOT=/absolute/path/to/gridcraft-proof.ppm \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test real_gridcraft_adapter_vm real_gridcraft_adapter_caches_and_opens_csv_and_xlsx \
  -- --ignored --nocapture
```

## Linux graphical pixel probe

`graphical_vm::png_pixels_reach_qemu_display` is a separate opt-in test for the
graphical appliance. It opens a generated 96 × 96 PNG through `Workspace::open_authorized`
with `DisplayMode::GraphicalSdl`, then asks a **test-only** QEMU monitor for a
PPM screendump and checks for 1024 exact fixture-colored pixels. The test
wrapper replaces `-monitor none` only in its own QEMU invocation; production
QEMU commands still disable the monitor. The local test guest uses 384 MiB by
default; `WORKSPACE_MEMORY_MIB` may select 128–512 MiB for a different image.
The test destroys the guest on exit. It requires a built graphical guest appliance,
an SDL-capable QEMU, KVM, and a desktop display. A protocol-only initramfs
cannot pass this test. No Business or SafeKey service or customer file is used.

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/guest/kernel \
WORKSPACE_INITRAMFS=/absolute/path/to/guest/rootfs.cpio.gz \
WORKSPACE_GRAPHICAL_DUMP=/absolute/path/to/optional-screendump.ppm \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test graphical_vm png_pixels_reach_qemu_display -- --ignored --nocapture
```

This probe checks displayed pixels on **Linux only**. It does not establish
malware containment, persistence guarantees, or native Windows/macOS graphics.
The screendump variable is optional; without it, the temporary capture is
removed after the test.

`graphical_vm::real_jpeg_pixels_reach_qemu_display` uses the same guest and
monitor harness with the real `seebensee-2384369-810x540.jpg` media fixture.
Set `WORKSPACE_JPEG_FIXTURE` to its absolute path; the test pins its byte length
and FNV-1a checksum before ingress. It then requires a natural-size 810 × 540
rectangle on the guest's black desktop and checks the FNV-1a checksum of all
437,400 displayed RGB pixels against the decoded source fixture. This detects
scaling and content changes in the controlled test guest. `WORKSPACE_GRAPHICAL_DUMP` can save the last PPM frame for
visual inspection. Run this single test with
`--test graphical_vm real_jpeg_pixels_reach_qemu_display -- --ignored --nocapture`.
Running both image probes together also requires `WORKSPACE_JPEG_FIXTURE`.
The opt-in graphical probes need QEMU built with the SDL display module;
`qemu-system-x86_64 -display help` must list `sdl`.

Additional ignored graphical probes open the TXT, JSON, CSV, PDF, XLSX, DOCX,
ODT and ZIP corpus files. They require a visible document window with text
pixels, beyond the guest's launch acknowledgement. Run them with the same
variables above and `--test graphical_vm -- --ignored --nocapture`.
The PDF interaction probes use `fixture-two-pages.pdf`: one sends Page Down,
another searches for `second`, and both require the second page's blue pixels
to replace the first page's red pixels in the guest display.

## Linux real mpv video adapter probe

`real_mpv_adapter_vm::real_mpv_adapter_caches_and_opens_mp4_and_webm` checks
the signed, on-demand video application. The base guest has no mpv. The test
downloads and verifies the package, opens the checked-in H.264 MP4 and VP9
WebM in separate 384 MiB VMs, checks captured video pixels, then reopens MP4
from the verified adapter cache with the downloader offline. Audio is muted.
It requires a local KVM/X11-capable test host and matching guest-built package:

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/guest/kernel \
WORKSPACE_INITRAMFS=/absolute/path/to/guest/rootfs.cpio.gz \
WORKSPACE_MPV_ADAPTER_IMAGE=/absolute/path/to/mpv.ext4 \
WORKSPACE_MPV_ADAPTER_MANIFEST=/absolute/path/to/mpv.manifest \
WORKSPACE_MPV_ADAPTER_SIGNATURE=/absolute/path/to/mpv.sig \
WORKSPACE_ADAPTER_PUBLIC_KEY_PEM=/absolute/path/to/signing-public.pem \
WORKSPACE_MP4_FIXTURE="$PWD/apps/inheriti-workspace/tests/fixtures/sample-video.mp4" \
WORKSPACE_WEBM_FIXTURE="$PWD/apps/inheriti-workspace/tests/fixtures/sample-video.webm" \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test real_mpv_adapter_vm real_mpv_adapter_caches_and_opens_mp4_and_webm \
  -- --ignored --nocapture
```

`WORKSPACE_MPV_MP4_SCREENSHOT` and `WORKSPACE_MPV_WEBM_SCREENSHOT` optionally
save raw PPM frames. This probe verifies Linux guest playback and cache reuse;
it does not exercise the authorized `.inheriti` handoff or native Windows/macOS.

## Linux real WordCraft document adapter probe

`real_wordcraft_adapter_vm::real_wordcraft_adapter_caches_and_opens_docx` is
the opt-in probe for the signed, on-demand WordCraft document adapter. The
base guest does not contain WordCraft. The test resolves it through the
production document registry, verifies the signed package on a cache miss,
opens the DOCX fixture in a VirGL guest, starts a second session from the
verified cache, and finally repeats the resolution with the test transport
offline. It uses a 512 MiB guest and grants WordCraft a 1 GiB virtual address
space limit. The package and guest image are local
test inputs and are not stored in this repository.

The test captures the SDL window using X11/Xwayland `xwininfo`, `xwd` and
ImageMagick `convert` because QEMU monitor screendump does not contain the
VirGL display. The visual assertion proves a non-blank rendered frame; the
fixture text must also be checked in the saved screenshot. It is Linux-only
and has not been run natively on Windows or macOS.

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/guest/kernel \
WORKSPACE_INITRAMFS=/absolute/path/to/virgl-guest/rootfs.cpio.gz \
WORKSPACE_WORDCRAFT_ADAPTER_IMAGE=/absolute/path/to/wordcraft.ext4 \
WORKSPACE_WORDCRAFT_ADAPTER_MANIFEST=/absolute/path/to/wordcraft.manifest \
WORKSPACE_WORDCRAFT_ADAPTER_SIGNATURE=/absolute/path/to/wordcraft.sig \
WORKSPACE_ADAPTER_PUBLIC_KEY_PEM=/absolute/path/to/signing-public.pem \
WORKSPACE_DOCX_FIXTURE="$PWD/apps/inheriti-workspace/tests/fixtures/sample-letter.docx" \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test real_wordcraft_adapter_vm real_wordcraft_adapter_caches_and_opens_docx \
  -- --ignored --nocapture
```

`WORKSPACE_WORDCRAFT_DOCX_SCREENSHOT` and
`WORKSPACE_WORDCRAFT_SECOND_DOCX_SCREENSHOT` optionally save raw PPM frames.

## Linux controller death probe

`parent_death_vm::parent_death_kills_real_qemu` starts a graphical 384 MiB guest
through `LinuxQemuRuntime`, kills the controller process with `SIGKILL`, and
waits for that exact QEMU process (PID plus `/proc` start time) to disappear or
become a zombie. It is opt-in and uses the same local guest image variables,
an SDL-capable QEMU, and a desktop display:

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/guest/kernel \
WORKSPACE_INITRAMFS=/absolute/path/to/guest/rootfs.cpio.gz \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test parent_death_vm parent_death_kills_real_qemu -- --ignored --nocapture
```

This probes Linux parent-death behavior only; it is not a hostile-guest
containment or Windows/macOS lifecycle test. The helper test stays ignored
unless invoked by its parent test.

## Linux guest-root device probe

`compromised_guest_vm::root_shell_sees_no_network_or_block_device` boots the
same product kernel and initramfs with a test-only root shell in place of the
workspace agent. It starts from `QemuSpec::command()` and changes only the
serial endpoint and kernel `rdinit` argument. From that shell, it mounts sysfs
and requires root access, only the loopback network interface, and no guest
block devices. The test kills and reaps QEMU and removes its private socket
directory. It uses one 384 MiB VM, local KVM and no external network.

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/guest/kernel \
WORKSPACE_INITRAMFS=/absolute/path/to/guest/rootfs.cpio.gz \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test compromised_guest_vm root_shell_sees_no_network_or_block_device -- --ignored --nocapture
```

This measures devices visible to a fully privileged process inside the guest.
It does not test hypervisor escape or guarantee protection from every host
resource side channel.

## Linux unexpected-network probe

`network_rejection_vm::injected_nic_is_rejected_before_authorization` boots the
graphical guest normally and opens a benign text file as a positive baseline.
It then boots the same image with a test-only QEMU wrapper. The wrapper replaces the
production `-nic none` argument with a virtio NIC on a restricted user-mode
backend (no external network). The test requires guest startup to fail before
the authorization callback, checks that QEMU exits, and checks that the private
socket directory is empty. The guest kernel must include the virtio-net driver;
otherwise this probe cannot establish that the guest detected the NIC.

```sh
WORKSPACE_QEMU=/absolute/path/to/qemu-system-x86_64 \
WORKSPACE_KERNEL=/absolute/path/to/guest/kernel \
WORKSPACE_INITRAMFS=/absolute/path/to/guest/rootfs.cpio.gz \
CARGO_BUILD_JOBS=1 cargo test --locked --offline \
  --manifest-path apps/inheriti-workspace/src-tauri/Cargo.toml \
  --test network_rejection_vm injected_nic_is_rejected_before_authorization -- --ignored --nocapture
```
