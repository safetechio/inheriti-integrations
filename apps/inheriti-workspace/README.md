# Inheriti® Workspace

Inheriti® Workspace opens protected `.inheriti` files after checking that you are allowed to access them. A saved protected file remains encrypted between openings.

## How opening a file works

```text
Business plan with a file
  → protected .inheriti download
  → open in Workspace
  → access check (SafeKey Mobile if required)
  → isolated opening of supported content
```

Double-click the saved file and choose **Inheriti® Workspace** if your computer asks which app to use. Workspace checks your access for each opening and requests SafeKey Mobile approval when needed.

The virtual machine is a disposable computer running inside your computer. Its viewer and temporary file live together in one session:

```text
Your computer → Workspace → disposable virtual machine → viewer + file
```

Closing that session discards its temporary content. Workspace does not open the decrypted file in an app installed on your computer.

## Machine requirements

Workspace uses a disposable Linux virtual machine for an isolated opening. The current graphical Linux test assigns it one virtual CPU and 384 MiB of RAM. **8 GB of computer RAM is a recommended evaluation target**, not a measured minimum. A 64-bit processor with hardware virtualization is required for the accelerated VM path. Modern optional applications may need more guest RAM or a capable graphics backend; their requirements are checked separately.

| Computer | OS version | Virtualization and display | Validation |
|---|---|---|---|
| Linux x86_64 | Ubuntu 22.04.5 LTS was tested; no minimum for other distributions is established. | KVM access through `/dev/kvm` and a graphical session for visual applications. | Real VM openings, including Gnumeric CSV/XLSX. |
| Linux ARM64 | Minimum distribution version not established. | ARM virtualization with accessible `/dev/kvm` and a graphical session. | Guest build configuration prepared; native opening pending. |
| Windows x86_64 | Windows 10 version 2004 or newer is the [QEMU WHPX baseline](https://qemu.readthedocs.io/en/v11.0.0/system/whpx.html); Workspace's minimum is not yet confirmed. | Hardware virtualization and Windows Hypervisor Platform (WHPX) enabled. | Runtime code prepared; native opening pending. |
| Windows ARM64 | Windows 11 24H2 with the April 2025 optional update or May 2025 security update is the [QEMU WHPX baseline](https://qemu.readthedocs.io/en/v11.0.0/system/whpx.html); Workspace's minimum is not yet confirmed. | ARM virtualization and WHPX enabled. | Runtime code prepared; native opening pending. |
| macOS Intel | Workspace's minimum macOS version is not yet confirmed. | Intel virtualization with [Hypervisor.framework](https://developer.apple.com/documentation/Hypervisor) and a graphical session. | Runtime code prepared; native opening pending. |
| macOS Apple silicon | Workspace's minimum macOS version is not yet confirmed. | Apple silicon virtualization with [Hypervisor.framework](https://developer.apple.com/documentation/Hypervisor) and a graphical session. | Runtime code prepared; native opening pending. |

The optional GridCraft graphics experiment is separate from these baseline requirements. CSV and XLSX opened in a Linux VM using an experimental VirGL graphics path; GridCraft still needs installed, security and cross-platform validation before it can be selected in Workspace.

## File support

The `.inheriti` format can protect file bytes regardless of extension, including JSON, archives and executables, within its size limit. Business offers protected download where that option is enabled.

The virtual machine selects a viewer from the file's validated content. Its built-in viewers cover PNG/JPEG images, PDF pages, UTF-8 text/JSON/CSV, text from DOCX/ODT, and spreadsheet cells from XLSX. ZIP opens as a file-name and size index; archive members are not extracted. These viewers are packaged with Workspace, so the person does not install them. Uploaded programs and scripts do not run.

Additional application families can be delivered as signed, versioned downloads. Workspace verifies and caches the application, then attaches it read-only to a fresh virtual machine. A cached application can be reused without another download. The protected file is never part of that persistent application cache.

The optional application map includes WordCraft for DOCX documents, GridCraft for spreadsheets and mpv for MP4/WebM playback. These applications need their signed guest packages and installed validation before they are available to everyone. Gnumeric remains an explicit compatibility choice for spreadsheets.

### Limitations

The built-in viewers show document content without the full editing features of desktop applications. The installed `.inheriti` handoff to this virtual machine is verified separately. Video audio output also requires guest-device validation. If a compatible isolated viewer is unavailable, Workspace keeps the saved `.inheriti` copy encrypted.

The native ownership and platform boundaries are described in [Architecture](ARCHITECTURE.md).
