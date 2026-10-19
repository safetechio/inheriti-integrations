//! Host policy for packaged optional document, spreadsheet, and video applications.
//!
//! A missing or invalid preferred package is an error, never permission to
//! select the deprecated compatibility application automatically.

use super::qemu_spec::{DisplayMode, GuestArch};
use ring::signature::{UnparsedPublicKey, ED25519};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpreadsheetApplication {
    GridCraft,
    Gnumeric,
}

impl SpreadsheetApplication {
    pub const PREFERRED_ORDER: [Self; 2] = [Self::GridCraft, Self::Gnumeric];

    pub fn id(self) -> &'static str {
        match self {
            Self::GridCraft => "gridcraft",
            Self::Gnumeric => "gnumeric",
        }
    }

    pub fn deprecated(self) -> bool {
        self == Self::Gnumeric
    }

    pub fn display(self) -> DisplayMode {
        match self {
            Self::GridCraft => DisplayMode::GraphicalVirgl,
            Self::Gnumeric => DisplayMode::GraphicalSdl,
        }
    }
}

pub struct SignedSpreadsheetAdapter {
    pub application: SpreadsheetApplication,
    pub architecture: &'static str,
    pub display: DisplayMode,
    pub manifest: Vec<u8>,
    pub signature: [u8; 64],
    pub release_public_key: [u8; 32],
}

/// Documents use a signed WordCraft package and the VirGL guest image.
pub struct SignedDocumentAdapter {
    pub architecture: &'static str,
    pub display: DisplayMode,
    pub manifest: Vec<u8>,
    pub signature: [u8; 64],
    pub release_public_key: [u8; 32],
}

/// Video playback uses an optional signed mpv package. No host player fallback.
pub struct SignedVideoAdapter {
    pub architecture: &'static str,
    pub display: DisplayMode,
    pub manifest: Vec<u8>,
    pub signature: [u8; 64],
    pub release_public_key: [u8; 32],
}

/// Load a caller-selected application from trusted packaged resources.
/// Expected layout: `<resource_dir>/spreadsheet/<id>/<arch>/` containing
/// `manifest`, `manifest.sig`, and `release.pub` as regular files. The resource
/// directory itself and every traversed component must not be a symlink.
pub fn load_spreadsheet_adapter(
    resource_dir: &Path,
    architecture: GuestArch,
    choice: Option<SpreadsheetApplication>,
) -> io::Result<SignedSpreadsheetAdapter> {
    let application = choice.unwrap_or(SpreadsheetApplication::GridCraft);
    let (arch, manifest, signature, release_public_key) =
        load_adapter(resource_dir, architecture, "spreadsheet", application.id())?;
    Ok(SignedSpreadsheetAdapter {
        application,
        architecture: arch,
        display: application.display(),
        manifest,
        signature,
        release_public_key,
    })
}

pub fn load_video_adapter(
    resource_dir: &Path,
    architecture: GuestArch,
) -> io::Result<SignedVideoAdapter> {
    let (architecture, manifest, signature, release_public_key) =
        load_adapter(resource_dir, architecture, "video", "mpv")?;
    Ok(SignedVideoAdapter {
        architecture,
        display: DisplayMode::GraphicalSdl,
        manifest,
        signature,
        release_public_key,
    })
}

pub fn load_document_adapter(
    resource_dir: &Path,
    architecture: GuestArch,
) -> io::Result<SignedDocumentAdapter> {
    let (architecture, manifest, signature, release_public_key) =
        load_adapter(resource_dir, architecture, "document", "wordcraft")?;
    Ok(SignedDocumentAdapter {
        architecture,
        display: DisplayMode::GraphicalVirgl,
        manifest,
        signature,
        release_public_key,
    })
}

fn load_adapter(
    resource_dir: &Path,
    architecture: GuestArch,
    family: &'static str,
    application_id: &'static str,
) -> io::Result<(&'static str, Vec<u8>, [u8; 64], [u8; 32])> {
    let arch = match architecture {
        GuestArch::X86_64 => "x86_64",
        GuestArch::Aarch64 => "aarch64",
    };
    if !resource_dir.is_absolute()
        || resource_dir
            .components()
            .enumerate()
            .any(|(index, component)| {
                !matches!(component, Component::RootDir | Component::Normal(_))
                    && !(index == 0 && matches!(component, Component::Prefix(_)))
            })
    {
        return Err(invalid("invalid adapter resource path"));
    }
    let mut directory = PathBuf::new();
    for component in resource_dir.components() {
        directory.push(component);
        // A Windows drive/UNC prefix is not a rooted directory until RootDir is appended.
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&directory)?;
        if !metadata.file_type().is_dir() {
            return Err(invalid("unsafe adapter resource directory"));
        }
    }
    for segment in [family, application_id, arch] {
        directory.push(segment);
        if !fs::symlink_metadata(&directory)?.file_type().is_dir() {
            return Err(invalid("unsafe adapter resource directory"));
        }
    }
    let manifest = read_regular(&directory.join("manifest"), 1024)?;
    let signature: [u8; 64] = read_regular(&directory.join("manifest.sig"), 64)?
        .try_into()
        .map_err(|_| invalid("invalid adapter signature length"))?;
    let release_public_key: [u8; 32] = read_regular(&directory.join("release.pub"), 32)?
        .try_into()
        .map_err(|_| invalid("invalid adapter public key length"))?;
    UnparsedPublicKey::new(&ED25519, &release_public_key)
        .verify(&manifest, &signature)
        .map_err(|_| invalid("invalid adapter signature"))?;
    let text = std::str::from_utf8(&manifest).map_err(|_| invalid("invalid adapter manifest"))?;
    if !text.ends_with('\n')
        || text.lines().next() != Some("workspace-adapter-v1")
        || text
            .lines()
            .filter(|line| *line == format!("id={application_id}"))
            .count()
            != 1
        || text
            .lines()
            .filter(|line| *line == format!("arch={arch}"))
            .count()
            != 1
        || text
            .lines()
            .filter(|line| *line == format!("family={family}"))
            .count()
            != 1
    {
        return Err(invalid("adapter identity does not match catalog"));
    }
    Ok((arch, manifest, signature, release_public_key))
}

fn read_regular(path: &Path, max_bytes: u64) -> io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(invalid("unsafe adapter resource"));
    }
    fs::read(path)
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
#[path = "../../../../tests/workspace-unit/adapter_registry_tests.rs"]
mod tests;
