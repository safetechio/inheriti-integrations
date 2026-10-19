//! Verified, persistent cache for optional guest applications.
//!
//! Signed manifests authorize optional application packages. The cache stores
//! packages, never a member's decrypted file. The VM mounts packages read-only.

use ring::signature::{UnparsedPublicKey, ED25519};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

#[derive(Clone, Copy, Debug)]
pub struct ApprovedAdapter<'a> {
    pub id: &'a str,
    pub version: &'a str,
    pub architecture: &'a str,
    pub family: &'a str,
    pub url: &'a str,
    pub sha256: [u8; 32],
    pub max_bytes: u64,
}

pub const MAX_MANIFEST_BYTES: usize = 1024;

/// Keep the exact signed bytes with the image for guest-side verification.
pub struct VerifiedAdapter {
    pub image: PathBuf,
    pub manifest: Vec<u8>,
    pub signature: [u8; 64],
}

#[derive(Debug)]
pub enum CacheError {
    NotApproved,
    InvalidManifest,
    InvalidSignature,
    UnsafeCache,
    TooLarge,
    DigestMismatch,
    Download(String),
    Io(io::Error),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdapterCacheProgress {
    CacheHit,
    Downloading {
        received_bytes: u64,
        total_bytes: Option<u64>,
    },
    Verifying,
    Complete,
    Failed,
}

pub struct AdapterDownload {
    pub reader: Box<dyn Read>,
    pub total_bytes: Option<u64>,
}

impl From<io::Error> for CacheError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub trait AdapterDownloader {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError>;

    fn open_with_length(&self, url: &str) -> Result<AdapterDownload, CacheError> {
        Ok(AdapterDownload {
            reader: self.open(url)?,
            total_bytes: None,
        })
    }
}

pub struct HttpsDownloader;

impl AdapterDownloader for HttpsDownloader {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError> {
        Ok(self.open_with_length(url)?.reader)
    }

    fn open_with_length(&self, url: &str) -> Result<AdapterDownload, CacheError> {
        if !valid_https_url(url) {
            return Err(CacheError::InvalidManifest);
        }
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| CacheError::Download(error.to_string()))?;
        let response = client
            .get(url)
            .send()
            .map_err(|error| CacheError::Download(error.to_string()))?;
        if !response.status().is_success() {
            return Err(CacheError::Download(format!("HTTP {}", response.status())));
        }
        let total_bytes = response.content_length();
        Ok(AdapterDownload {
            reader: Box::new(response),
            total_bytes,
        })
    }
}

/// Resolve only after authenticating the full, canonical manifest. The key is
/// supplied by the trusted application package, never by the manifest source.
pub fn resolve_signed(
    cache_dir: &Path,
    id: &str,
    architecture: &str,
    manifest: &[u8],
    signature: &[u8],
    public_key: &[u8; 32],
    downloader: &dyn AdapterDownloader,
) -> Result<VerifiedAdapter, CacheError> {
    resolve_signed_with_progress(
        cache_dir,
        id,
        architecture,
        manifest,
        signature,
        public_key,
        downloader,
        &mut |_| {},
    )
}

pub fn resolve_signed_with_progress(
    cache_dir: &Path,
    id: &str,
    architecture: &str,
    manifest: &[u8],
    signature: &[u8],
    public_key: &[u8; 32],
    downloader: &dyn AdapterDownloader,
    on_progress: &mut dyn FnMut(AdapterCacheProgress),
) -> Result<VerifiedAdapter, CacheError> {
    let entry = parse_manifest(manifest)?;
    if entry.id != id || entry.architecture != architecture {
        return Err(CacheError::NotApproved);
    }
    let signature: [u8; 64] = signature
        .try_into()
        .map_err(|_| CacheError::InvalidSignature)?;
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(manifest, &signature)
        .map_err(|_| CacheError::InvalidSignature)?;
    let image = match resolve_entry_with_progress(cache_dir, &entry, downloader, on_progress) {
        Ok(image) => image,
        Err(error) => {
            on_progress(AdapterCacheProgress::Failed);
            return Err(error);
        }
    };
    on_progress(AdapterCacheProgress::Complete);
    Ok(VerifiedAdapter {
        image,
        manifest: manifest.to_vec(),
        signature,
    })
}

fn parse_manifest(bytes: &[u8]) -> Result<ApprovedAdapter<'_>, CacheError> {
    if bytes.len() > MAX_MANIFEST_BYTES || bytes.is_empty() || *bytes.last().unwrap() != b'\n' {
        return Err(CacheError::InvalidManifest);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| CacheError::InvalidManifest)?;
    let mut lines = text.split_terminator('\n');
    if lines.next() != Some("workspace-adapter-v1") {
        return Err(CacheError::InvalidManifest);
    }
    fn field<'a>(line: Option<&'a str>, prefix: &str) -> Result<&'a str, CacheError> {
        line.and_then(|value| value.strip_prefix(prefix))
            .ok_or(CacheError::InvalidManifest)
    }
    let id = field(lines.next(), "id=")?;
    let version = field(lines.next(), "version=")?;
    let architecture = field(lines.next(), "arch=")?;
    let family = field(lines.next(), "family=")?;
    let digest = field(lines.next(), "sha256=")?;
    let max_text = field(lines.next(), "max_bytes=")?;
    if max_text.is_empty()
        || (max_text.len() > 1 && max_text.starts_with('0'))
        || !max_text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(CacheError::InvalidManifest);
    }
    let max_bytes = max_text
        .parse::<u64>()
        .map_err(|_| CacheError::InvalidManifest)?;
    let url = field(lines.next(), "url=")?;
    if lines.next().is_some()
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(CacheError::InvalidManifest);
    }
    let mut sha256 = [0u8; 32];
    for (index, byte) in sha256.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&digest[index * 2..index * 2 + 2], 16)
            .map_err(|_| CacheError::InvalidManifest)?;
    }
    let entry = ApprovedAdapter {
        id,
        version,
        architecture,
        family,
        url,
        sha256,
        max_bytes,
    };
    validate(&entry)?;
    Ok(entry)
}

fn validate(entry: &ApprovedAdapter<'_>) -> Result<(), CacheError> {
    let safe = |value: &str| {
        !value.is_empty()
            && value.len() <= 64
            && (value.as_bytes()[0].is_ascii_lowercase() || value.as_bytes()[0].is_ascii_digit())
            && value.bytes().all(|b| {
                b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
            })
    };
    if !safe(entry.id)
        || !safe(entry.version)
        || !safe(entry.architecture)
        || !matches!(entry.architecture, "x86_64" | "aarch64")
        || !safe(entry.family)
        || !valid_https_url(entry.url)
        || entry.max_bytes == 0
        || entry.max_bytes > 512 * 1024 * 1024
        || entry.sha256 == [0; 32]
    {
        return Err(CacheError::InvalidManifest);
    }
    Ok(())
}

fn valid_https_url(value: &str) -> bool {
    if !value.starts_with("https://") || !value.bytes().all(|byte| byte.is_ascii_graphic()) {
        return false;
    }
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
    })
}

fn verified_file(path: &Path, entry: &ApprovedAdapter<'_>) -> Result<bool, CacheError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_file() {
        return Err(CacheError::UnsafeCache);
    }
    if metadata.len() == 0 || metadata.len() > entry.max_bytes {
        return Err(CacheError::DigestMismatch);
    }
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let size = file.read(&mut buf)?;
        if size == 0 {
            break;
        }
        hash.update(&buf[..size]);
    }
    if hash.finalize().as_slice() != entry.sha256 {
        return Err(CacheError::DigestMismatch);
    }
    Ok(true)
}

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
fn resolve_entry(
    cache_dir: &Path,
    entry: &ApprovedAdapter<'_>,
    downloader: &dyn AdapterDownloader,
) -> Result<PathBuf, CacheError> {
    resolve_entry_with_progress(cache_dir, entry, downloader, &mut |_| {})
}

fn resolve_entry_with_progress(
    cache_dir: &Path,
    entry: &ApprovedAdapter<'_>,
    downloader: &dyn AdapterDownloader,
    on_progress: &mut dyn FnMut(AdapterCacheProgress),
) -> Result<PathBuf, CacheError> {
    validate(entry)?;
    fs::create_dir_all(cache_dir)?;
    if !fs::symlink_metadata(cache_dir)?.file_type().is_dir() {
        return Err(CacheError::UnsafeCache);
    }
    let digest = entry
        .sha256
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let destination = cache_dir.join(format!(
        "{}-{}-{}-{digest}.bundle",
        entry.id, entry.version, entry.architecture
    ));
    match verified_file(&destination, entry) {
        Ok(true) => {
            on_progress(AdapterCacheProgress::CacheHit);
            return Ok(destination);
        }
        Ok(false) => {}
        Err(CacheError::DigestMismatch) => {
            fs::remove_file(&destination)?;
        }
        Err(error) => return Err(error),
    }
    let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temporary = cache_dir.join(format!(".download-{}-{sequence}", std::process::id()));
    let result = (|| -> Result<(), CacheError> {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        let download = downloader.open_with_length(entry.url)?;
        let mut source = download.reader;
        on_progress(AdapterCacheProgress::Downloading {
            received_bytes: 0,
            total_bytes: download.total_bytes,
        });
        let mut hash = Sha256::new();
        let mut total = 0u64;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let size = source
                .read(&mut buf)
                .map_err(|error| CacheError::Download(error.to_string()))?;
            if size == 0 {
                break;
            }
            total = total.checked_add(size as u64).ok_or(CacheError::TooLarge)?;
            if total > entry.max_bytes {
                return Err(CacheError::TooLarge);
            }
            hash.update(&buf[..size]);
            output.write_all(&buf[..size])?;
            on_progress(AdapterCacheProgress::Downloading {
                received_bytes: total,
                total_bytes: download.total_bytes,
            });
        }
        on_progress(AdapterCacheProgress::Verifying);
        if total == 0 || hash.finalize().as_slice() != entry.sha256 {
            return Err(CacheError::DigestMismatch);
        }
        output.sync_all()?;
        // No overwrite: concurrent clients may have installed the same digest.
        match fs::hard_link(&temporary, &destination) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                verified_file(&destination, entry).and_then(|valid| {
                    if valid {
                        Ok(())
                    } else {
                        Err(CacheError::UnsafeCache)
                    }
                })
            }
            Err(error) => Err(error.into()),
        }
    })();
    let _ = fs::remove_file(&temporary);
    result?;
    Ok(destination)
}

#[cfg(test)]
#[path = "../../../../tests/workspace-unit/adapter_cache_tests.rs"]
mod tests;
