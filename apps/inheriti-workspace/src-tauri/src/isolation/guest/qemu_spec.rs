//! Platform-neutral QEMU argv for the isolated guest transport.
//! Inputs are trusted installation paths and a private transport endpoint only.

use base64::Engine;
use std::path::PathBuf;

const PORT_NAME: &str = "org.inheriti.workspace";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostPlatform {
    Linux,
    Windows,
    MacOs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GuestArch {
    X86_64,
    Aarch64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum DisplayMode {
    #[default]
    Headless,
    /// The packaged QEMU must include SDL and the guest must provide a graphical session.
    GraphicalSdl,
    /// Explicit playback-only video session; requires a guest with VirtIO Sound and ALSA.
    GraphicalSdlPlayback,
    /// The packaged QEMU must include SDL and VirGL support.
    GraphicalVirgl,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QemuSpec {
    pub host: HostPlatform,
    pub arch: GuestArch,
    pub executable: PathBuf,
    pub kernel: PathBuf,
    pub initramfs: PathBuf,
    /// Verified application image exposed as a read-only virtio block device.
    pub application_image: Option<PathBuf>,
    pub application_attestation: Option<SignedApplicationAttestation>,
    /// A private Unix socket path or a Windows pipe name (without `\\.\pipe\`).
    /// QEMU creates the Windows pipe from this name.
    pub endpoint: String,
    pub memory_mib: u16,
    pub display: DisplayMode,
}

/// Signed package identity passed to the guest for verification before mounting.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedApplicationAttestation {
    pub manifest_b64: String,
    pub signature_b64: String,
}

impl SignedApplicationAttestation {
    pub fn validate(&self) -> Result<(), SpecError> {
        let engine = base64::engine::general_purpose::STANDARD;
        let manifest = engine
            .decode(&self.manifest_b64)
            .map_err(|_| SpecError::InvalidAttestation)?;
        let signature = engine
            .decode(&self.signature_b64)
            .map_err(|_| SpecError::InvalidAttestation)?;
        if manifest.is_empty()
            || manifest.len() > 1024
            || signature.len() != 64
            || engine.encode(&manifest) != self.manifest_b64
            || engine.encode(&signature) != self.signature_b64
        {
            return Err(SpecError::InvalidAttestation);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QemuCommand {
    pub executable: PathBuf,
    pub args: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecError {
    InvalidPath,
    InvalidEndpoint,
    InvalidMemory,
    InvalidAttestation,
}

impl QemuSpec {
    pub fn command(&self) -> Result<QemuCommand, SpecError> {
        for path in [&self.executable, &self.kernel, &self.initramfs] {
            let value = path.to_str().ok_or(SpecError::InvalidPath)?;
            if !valid_absolute_path(value, self.host) || invalid_qemu_value(value) {
                return Err(SpecError::InvalidPath);
            }
        }
        if let Some(path) = &self.application_image {
            let value = path.to_str().ok_or(SpecError::InvalidPath)?;
            if !valid_absolute_path(value, self.host) || invalid_qemu_value(value) {
                return Err(SpecError::InvalidPath);
            }
        }
        match (&self.application_image, &self.application_attestation) {
            (Some(_), Some(attestation)) => attestation.validate()?,
            (None, None) => (),
            _ => return Err(SpecError::InvalidAttestation),
        }
        if !(128..=4096).contains(&self.memory_mib) {
            return Err(SpecError::InvalidMemory);
        }
        if invalid_qemu_value(&self.endpoint)
            || !match self.host {
                HostPlatform::Windows => {
                    self.endpoint.len() <= 80
                        && self.endpoint.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
                        })
                }
                HostPlatform::Linux | HostPlatform::MacOs => {
                    self.endpoint.starts_with('/') && self.endpoint.len() > 1
                }
            }
        {
            return Err(SpecError::InvalidEndpoint);
        }

        let (machine, device, console) = match self.arch {
            GuestArch::X86_64 => ("q35", "virtio-serial-pci", "ttyS0"),
            GuestArch::Aarch64 => ("virt", "virtio-serial-device", "ttyAMA0"),
        };
        let accel = match self.host {
            HostPlatform::Linux => "kvm",
            HostPlatform::Windows => "whpx",
            HostPlatform::MacOs => "hvf",
        };
        let chardev = match self.host {
            HostPlatform::Windows => format!("pipe,id=ingress,path={}", self.endpoint),
            HostPlatform::Linux | HostPlatform::MacOs => {
                format!(
                    "socket,id=ingress,path={},server=on,wait=off",
                    self.endpoint
                )
            }
        };
        let mut args = vec![
            "-nodefaults".into(),
            "-no-user-config".into(),
            "-name".into(),
            "Inheriti® Workspace".into(),
            "-machine".into(),
            format!("{machine},accel={accel},dump-guest-core=off"),
            "-cpu".into(),
            "host".into(),
            "-smp".into(),
            "1".into(),
            "-m".into(),
            self.memory_mib.to_string(),
            "-display".into(),
            match self.display {
                DisplayMode::Headless => "none",
                DisplayMode::GraphicalSdl | DisplayMode::GraphicalSdlPlayback => "sdl,gl=off",
                DisplayMode::GraphicalVirgl => "sdl,gl=on",
            }
            .into(),
            "-monitor".into(),
            "none".into(),
            "-serial".into(),
            "none".into(),
            "-nic".into(),
            "none".into(),
            "-kernel".into(),
            self.kernel.to_str().unwrap().into(),
            "-initrd".into(),
            self.initramfs.to_str().unwrap().into(),
            "-append".into(),
            match &self.application_attestation {
                Some(attestation) => format!(
                    "console={console} panic=1 workspace.adapter.manifest={} workspace.adapter.signature={}",
                    attestation.manifest_b64, attestation.signature_b64
                ),
                None => format!("console={console} panic=1"),
            },
            "-chardev".into(),
            chardev,
            "-device".into(),
            device.into(),
            "-device".into(),
            format!("virtserialport,chardev=ingress,name={PORT_NAME}"),
        ];
        if matches!(
            self.display,
            DisplayMode::GraphicalSdl
                | DisplayMode::GraphicalSdlPlayback
                | DisplayMode::GraphicalVirgl
        ) {
            // ARM virt requires an explicit PCI GPU. Use the same devices on x86.
            // Virtio input stays inside the guest; no host folder or clipboard device.
            args.extend([
                "-device".into(),
                match self.display {
                    DisplayMode::GraphicalVirgl => "virtio-gpu-gl",
                    _ => "virtio-gpu-pci",
                }
                .into(),
                "-device".into(),
                "virtio-keyboard-pci".into(),
                "-device".into(),
                "virtio-tablet-pci".into(),
            ]);
        }
        if self.display == DisplayMode::GraphicalSdlPlayback {
            // A single VirtIO Sound stream is playback; the second would expose capture.
            args.extend([
                "-audiodev".into(),
                "sdl,id=workspace_audio".into(),
                "-device".into(),
                "virtio-sound-pci,audiodev=workspace_audio,streams=1".into(),
            ]);
        }
        if let Some(path) = &self.application_image {
            args.extend([
                "-drive".into(),
                format!(
                    "media=disk,if=none,id=workspace_apps,file={},format=raw,readonly=on",
                    path.to_str().unwrap()
                ),
                "-device".into(),
                "virtio-blk-pci,drive=workspace_apps".into(),
            ]);
        }
        Ok(QemuCommand {
            executable: self.executable.clone(),
            args,
        })
    }
}

fn valid_absolute_path(value: &str, host: HostPlatform) -> bool {
    match host {
        HostPlatform::Windows => {
            let bytes = value.as_bytes();
            bytes.len() > 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && bytes[2] == b'\\'
        }
        HostPlatform::Linux | HostPlatform::MacOs => value.starts_with('/') && value.len() > 1,
    }
}

fn invalid_qemu_value(value: &str) -> bool {
    value.is_empty() || value.contains(',') || value.chars().any(char::is_control)
}

#[cfg(test)]
#[path = "../../../../tests/workspace-unit/qemu_spec_tests.rs"]
mod tests;
