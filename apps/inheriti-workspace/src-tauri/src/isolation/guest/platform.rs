//! Host composition for the packaged, headless workspace guest.
//! The caller resolves Tauri's resource directory; this module has no Tauri dependency.

use super::{
    adapter_cache::{self, AdapterCacheProgress, AdapterDownloader},
    adapter_registry::{self, SpreadsheetApplication},
    qemu_spec::{DisplayMode, GuestArch, SignedApplicationAttestation},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[cfg(target_os = "linux")]
pub type PlatformRuntime = super::linux_qemu::LinuxQemuRuntime;
#[cfg(target_os = "macos")]
pub type PlatformRuntime = super::macos_qemu::MacOsQemuRuntime;
#[cfg(target_os = "windows")]
pub type PlatformRuntime = super::windows_qemu::WindowsQemuRuntime;

/// Resource layout: workspace-vm/{qemu-system-<arch>[.exe],vmlinuz,initramfs}.
/// VirGL applications use a separate `initramfs-virgl` guest image.
/// QEMU's DLL/share files and licenses are packaged alongside these components.
#[derive(Debug)]
struct GuestAssets {
    qemu: PathBuf,
    kernel: PathBuf,
    initramfs: PathBuf,
}

impl GuestAssets {
    fn from_resource_dir(resource_dir: &Path, display: DisplayMode) -> io::Result<Self> {
        if !resource_dir.is_absolute() || !resource_dir.is_dir() {
            return Err(invalid("workspace VM resources unavailable"));
        }
        let arch = current_arch()?;
        let executable = match arch {
            GuestArch::X86_64 => "qemu-system-x86_64",
            GuestArch::Aarch64 => "qemu-system-aarch64",
        };
        let qemu = resource_dir.join(format!("{executable}{}", std::env::consts::EXE_SUFFIX));
        let kernel = resource_dir.join("vmlinuz");
        let initramfs = resource_dir.join(match display {
            DisplayMode::GraphicalVirgl => "initramfs-virgl",
            DisplayMode::Headless
            | DisplayMode::GraphicalSdl
            | DisplayMode::GraphicalSdlPlayback => "initramfs",
        });
        for path in [&qemu, &kernel, &initramfs] {
            // No guest byte may be sent to a missing or redirected package component.
            let metadata = fs::symlink_metadata(path)?;
            if !metadata.file_type().is_file() || metadata.len() == 0 {
                return Err(invalid("invalid workspace VM component"));
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if qemu.metadata()?.permissions().mode() & 0o111 == 0 {
                return Err(invalid("workspace VM executable is not executable"));
            }
        }
        Ok(Self {
            qemu,
            kernel,
            initramfs,
        })
    }
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn current_arch() -> io::Result<GuestArch> {
    match std::env::consts::ARCH {
        "x86_64" => Ok(GuestArch::X86_64),
        "aarch64" => Ok(GuestArch::Aarch64),
        _ => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "unsupported host architecture",
        )),
    }
}

/// Prepare the local guest runtime. Actual accelerator and guest boot checks occur on `start`.
pub fn prepare_runtime(resource_dir: &Path, memory_mib: u16) -> io::Result<PlatformRuntime> {
    prepare_runtime_with_display(resource_dir, memory_mib, DisplayMode::Headless)
}

/// Explicit opt-in for a packaged graphical guest. The default factory stays headless.
pub fn prepare_runtime_with_display(
    resource_dir: &Path,
    memory_mib: u16,
    display: DisplayMode,
) -> io::Result<PlatformRuntime> {
    prepare_runtime_with_application_image(resource_dir, memory_mib, display, None)
}

/// Attach a verified optional application image as a read-only guest block device.
/// The caller owns download and integrity verification before invoking this factory.
pub fn prepare_runtime_with_application_image(
    resource_dir: &Path,
    memory_mib: u16,
    display: DisplayMode,
    application_image: Option<PathBuf>,
) -> io::Result<PlatformRuntime> {
    if application_image.is_some() {
        return Err(invalid("application image requires signed attestation"));
    }
    prepare_runtime_with_image_and_attestation(resource_dir, memory_mib, display, None, None)
}

/// Attach a verified image and its signed identity for guest-side verification.
pub fn prepare_runtime_with_signed_application_image(
    resource_dir: &Path,
    memory_mib: u16,
    display: DisplayMode,
    image: PathBuf,
    manifest_b64: String,
    signature_b64: String,
) -> io::Result<PlatformRuntime> {
    prepare_runtime_with_image_and_attestation(
        resource_dir,
        memory_mib,
        display,
        Some(image),
        Some(SignedApplicationAttestation {
            manifest_b64,
            signature_b64,
        }),
    )
}

fn prepare_runtime_with_image_and_attestation(
    resource_dir: &Path,
    memory_mib: u16,
    display: DisplayMode,
    application_image: Option<PathBuf>,
    application_attestation: Option<SignedApplicationAttestation>,
) -> io::Result<PlatformRuntime> {
    match (&application_image, &application_attestation) {
        (None, None) => (),
        (Some(_), Some(attestation)) => attestation
            .validate()
            .map_err(|_| invalid("invalid application attestation"))?,
        _ => return Err(invalid("application image requires signed attestation")),
    }
    if !(128..=4096).contains(&memory_mib) {
        return Err(invalid("invalid workspace VM memory"));
    }
    let assets = GuestAssets::from_resource_dir(resource_dir, display)?;
    if let Some(path) = &application_image {
        validate_application_image(path)?;
    }
    #[cfg(target_os = "linux")]
    {
        let socket_directory = private_socket_directory()?;
        Ok(super::linux_qemu::LinuxQemuRuntime::new(
            super::linux_qemu::LinuxQemuConfig {
                qemu: assets.qemu,
                kernel: assets.kernel,
                initramfs: assets.initramfs,
                application_image,
                application_attestation,
                arch: current_arch()?,
                socket_directory,
                memory_mib,
                display,
            },
        ))
    }
    #[cfg(target_os = "macos")]
    {
        Ok(super::macos_qemu::MacOsQemuRuntime::new(
            super::macos_qemu::MacOsQemuConfig {
                qemu: assets.qemu,
                kernel: assets.kernel,
                initramfs: assets.initramfs,
                application_image,
                application_attestation,
                arch: current_arch()?,
                memory_mib,
                display,
            },
        ))
    }
    #[cfg(target_os = "windows")]
    {
        Ok(super::windows_qemu::WindowsQemuRuntime::new(
            super::windows_qemu::WindowsQemuConfig {
                qemu: assets.qemu,
                kernel: assets.kernel,
                initramfs: assets.initramfs,
                application_image,
                application_attestation,
                arch: current_arch()?,
                memory_mib,
                display,
            },
        ))
    }
}

/// Verify a signed application, resolve its cache entry, then attach it to a fresh guest.
/// The caller supplies the release public key from trusted packaged resources.
pub fn prepare_runtime_for_signed_adapter(
    resource_dir: &Path,
    cache_dir: &Path,
    adapter_id: &str,
    manifest: &[u8],
    signature: &[u8],
    release_public_key: &[u8; 32],
    downloader: &dyn AdapterDownloader,
    memory_mib: u16,
    display: DisplayMode,
) -> io::Result<PlatformRuntime> {
    prepare_runtime_for_signed_adapter_with_progress(
        resource_dir,
        cache_dir,
        adapter_id,
        manifest,
        signature,
        release_public_key,
        downloader,
        memory_mib,
        display,
        &mut |_| {},
    )
}

pub fn prepare_runtime_for_signed_adapter_with_progress(
    resource_dir: &Path,
    cache_dir: &Path,
    adapter_id: &str,
    manifest: &[u8],
    signature: &[u8],
    release_public_key: &[u8; 32],
    downloader: &dyn AdapterDownloader,
    memory_mib: u16,
    display: DisplayMode,
    on_progress: &mut dyn FnMut(AdapterCacheProgress),
) -> io::Result<PlatformRuntime> {
    let arch = match current_arch()? {
        GuestArch::X86_64 => "x86_64",
        GuestArch::Aarch64 => "aarch64",
    };
    let verified = adapter_cache::resolve_signed_with_progress(
        cache_dir,
        adapter_id,
        arch,
        manifest,
        signature,
        release_public_key,
        downloader,
        on_progress,
    )
    .map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("approved application unavailable: {error:?}"),
        )
    })?;
    prepare_runtime_with_signed_application_image(
        resource_dir,
        memory_mib,
        display,
        verified.image,
        STANDARD.encode(verified.manifest),
        STANDARD.encode(verified.signature),
    )
}

/// Select an approved spreadsheet application before creating the disposable VM.
/// Gnumeric is retained for an explicit compatibility choice only.
pub fn prepare_runtime_for_spreadsheet(
    resource_dir: &Path,
    cache_dir: &Path,
    choice: Option<SpreadsheetApplication>,
    downloader: &dyn AdapterDownloader,
    memory_mib: u16,
    on_progress: &mut dyn FnMut(AdapterCacheProgress),
) -> io::Result<PlatformRuntime> {
    let approved = adapter_registry::load_spreadsheet_adapter(
        &resource_dir.join("adapters"),
        current_arch()?,
        choice,
    )?;
    prepare_runtime_for_signed_adapter_with_progress(
        resource_dir,
        cache_dir,
        approved.application.id(),
        &approved.manifest,
        &approved.signature,
        &approved.release_public_key,
        downloader,
        memory_mib,
        approved.display,
        on_progress,
    )
}

/// Resolve the approved DOCX application before creating the disposable VM.
/// An absent signed WordCraft package is an error, never a host application fallback.
pub fn prepare_runtime_for_document(
    resource_dir: &Path,
    cache_dir: &Path,
    downloader: &dyn AdapterDownloader,
    memory_mib: u16,
    on_progress: &mut dyn FnMut(AdapterCacheProgress),
) -> io::Result<PlatformRuntime> {
    let approved =
        adapter_registry::load_document_adapter(&resource_dir.join("adapters"), current_arch()?)?;
    prepare_runtime_for_signed_adapter_with_progress(
        resource_dir,
        cache_dir,
        "wordcraft",
        &approved.manifest,
        &approved.signature,
        &approved.release_public_key,
        downloader,
        memory_mib,
        approved.display,
        on_progress,
    )
}

/// Resolve the approved video player before starting the disposable VM.
/// An absent signed mpv package is an error, never a host playback fallback.
pub fn prepare_runtime_for_video(
    resource_dir: &Path,
    cache_dir: &Path,
    downloader: &dyn AdapterDownloader,
    memory_mib: u16,
    on_progress: &mut dyn FnMut(AdapterCacheProgress),
) -> io::Result<PlatformRuntime> {
    let approved =
        adapter_registry::load_video_adapter(&resource_dir.join("adapters"), current_arch()?)?;
    prepare_runtime_for_signed_adapter_with_progress(
        resource_dir,
        cache_dir,
        "mpv",
        &approved.manifest,
        &approved.signature,
        &approved.release_public_key,
        downloader,
        memory_mib,
        approved.display,
        on_progress,
    )
}

pub(super) fn validate_application_image(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(invalid("invalid application image path"));
    }
    let value = path
        .to_str()
        .ok_or_else(|| invalid("invalid application image path"))?;
    if value.contains(',') || value.chars().any(char::is_control) {
        return Err(invalid("invalid application image path"));
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return Err(invalid("invalid application image"));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn private_socket_directory() -> io::Result<PathBuf> {
    use std::os::unix::fs::DirBuilderExt;
    let parent = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "private runtime directory unavailable",
            )
        })?;
    validate_private_dir(&parent)?;
    let directory = parent.join("inheriti-workspace");
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    match builder.create(&directory) {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error),
    }
    validate_private_dir(&directory)?;
    if directory.as_os_str().len() > 64 || directory.to_string_lossy().contains(',') {
        return Err(invalid("workspace socket directory too long"));
    }
    Ok(directory)
}

#[cfg(target_os = "linux")]
fn validate_private_dir(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let metadata = fs::symlink_metadata(path)?;
    if !path.is_absolute()
        || !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(invalid("insecure workspace socket directory"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../../tests/workspace-unit/platform_tests.rs"]
mod tests;
