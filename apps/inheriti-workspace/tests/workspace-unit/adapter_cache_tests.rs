use super::*;
use base64::Engine as _;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::isolation::guest::qemu_spec::{DisplayMode, GuestArch, HostPlatform, QemuSpec};

const BODY: &[u8] = b"approved optional guest application bundle";

struct FixtureDownloader {
    calls: AtomicUsize,
    body: Vec<u8>,
    offline: bool,
}

struct LengthDownloader(FixtureDownloader);

impl AdapterDownloader for LengthDownloader {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError> {
        self.0.open(url)
    }

    fn open_with_length(&self, url: &str) -> Result<AdapterDownload, CacheError> {
        Ok(AdapterDownload {
            reader: self.open(url)?,
            total_bytes: Some(BODY.len() as u64),
        })
    }
}

impl AdapterDownloader for FixtureDownloader {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError> {
        assert_eq!(url, "https://example.invalid/approved.bundle");
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.offline {
            return Err(CacheError::Download("offline".into()));
        }
        Ok(Box::new(Cursor::new(self.body.clone())))
    }
}

fn entry() -> ApprovedAdapter<'static> {
    ApprovedAdapter {
        id: "fixture-viewer",
        version: "1.0",
        architecture: "x86_64",
        family: "text",
        url: "https://example.invalid/approved.bundle",
        sha256: Sha256::digest(BODY).into(),
        max_bytes: 1024,
    }
}

fn signed_manifest() -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    let digest = Sha256::digest(BODY)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let manifest = format!(
        "workspace-adapter-v1\nid=fixture-viewer\nversion=1.0\narch=x86_64\nfamily=text\nsha256={digest}\nmax_bytes=1024\nurl=https://example.invalid/approved.bundle\n"
    ).into_bytes();
    let random = SystemRandom::new();
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&random).unwrap();
    let keypair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
    let key: [u8; 32] = keypair.public_key().as_ref().try_into().unwrap();
    (
        manifest.clone(),
        keypair.sign(&manifest).as_ref().to_vec(),
        key,
    )
}

#[test]
fn signed_bundle_downloads_once_then_works_offline() {
    let directory = cache_dir();
    let (manifest, signature, key) = signed_manifest();
    let online = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let first = resolve_signed(
        &directory,
        "fixture-viewer",
        "x86_64",
        &manifest,
        &signature,
        &key,
        &online,
    )
    .unwrap();
    assert_eq!(fs::read(&first.image).unwrap(), BODY);
    assert_eq!(first.manifest, manifest);
    assert_eq!(first.signature.as_slice(), signature);
    let offline = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: vec![],
        offline: true,
    };
    let second = resolve_signed(
        &directory,
        "fixture-viewer",
        "x86_64",
        &manifest,
        &signature,
        &key,
        &offline,
    )
    .unwrap();
    assert_eq!(first.image, second.image);
    assert_eq!(online.calls.load(Ordering::SeqCst), 1);
    assert_eq!(offline.calls.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn progress_reports_real_download_bytes_and_cache_hit() {
    let directory = cache_dir();
    let (manifest, signature, key) = signed_manifest();
    let online = LengthDownloader(FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    });
    let mut events = Vec::new();
    resolve_signed_with_progress(
        &directory,
        "fixture-viewer",
        "x86_64",
        &manifest,
        &signature,
        &key,
        &online,
        &mut |event| events.push(event),
    )
    .unwrap();
    assert_eq!(
        events,
        vec![
            AdapterCacheProgress::Downloading {
                received_bytes: 0,
                total_bytes: Some(BODY.len() as u64)
            },
            AdapterCacheProgress::Downloading {
                received_bytes: BODY.len() as u64,
                total_bytes: Some(BODY.len() as u64)
            },
            AdapterCacheProgress::Verifying,
            AdapterCacheProgress::Complete,
        ]
    );

    events.clear();
    let offline = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: vec![],
        offline: true,
    };
    resolve_signed_with_progress(
        &directory,
        "fixture-viewer",
        "x86_64",
        &manifest,
        &signature,
        &key,
        &offline,
        &mut |event| events.push(event),
    )
    .unwrap();
    assert_eq!(
        events,
        vec![
            AdapterCacheProgress::CacheHit,
            AdapterCacheProgress::Complete
        ]
    );
    assert_eq!(offline.calls.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn progress_supports_unknown_length_and_never_completes_failed_download() {
    let directory = cache_dir();
    let (manifest, signature, key) = signed_manifest();
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: b"wrong bytes".to_vec(),
        offline: false,
    };
    let mut events = Vec::new();
    assert!(matches!(
        resolve_signed_with_progress(
            &directory,
            "fixture-viewer",
            "x86_64",
            &manifest,
            &signature,
            &key,
            &downloader,
            &mut |event| events.push(event),
        ),
        Err(CacheError::DigestMismatch)
    ));
    assert_eq!(
        events,
        vec![
            AdapterCacheProgress::Downloading {
                received_bytes: 0,
                total_bytes: None
            },
            AdapterCacheProgress::Downloading {
                received_bytes: 11,
                total_bytes: None
            },
            AdapterCacheProgress::Verifying,
            AdapterCacheProgress::Failed,
        ]
    );
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn invalid_signature_emits_no_progress() {
    let (manifest, mut signature, key) = signed_manifest();
    signature[0] ^= 1;
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let mut events = Vec::new();
    assert!(matches!(
        resolve_signed_with_progress(
            Path::new("/unused"),
            "fixture-viewer",
            "x86_64",
            &manifest,
            &signature,
            &key,
            &downloader,
            &mut |event| events.push(event),
        ),
        Err(CacheError::InvalidSignature)
    ));
    assert!(events.is_empty());
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn signed_cache_entry_becomes_read_only_qemu_attachment_without_host_bridges() {
    let directory = cache_dir();
    let (manifest, signature, key) = signed_manifest();
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let verified = resolve_signed(
        &directory,
        "fixture-viewer",
        "x86_64",
        &manifest,
        &signature,
        &key,
        &downloader,
    )
    .unwrap();
    let engine = base64::engine::general_purpose::STANDARD;
    let spec = QemuSpec {
        host: HostPlatform::Linux,
        arch: GuestArch::X86_64,
        executable: "/usr/bin/qemu-system-x86_64".into(),
        kernel: "/opt/workspace/vmlinuz".into(),
        initramfs: "/opt/workspace/initramfs".into(),
        application_image: Some(verified.image.clone()),
        application_attestation: Some(
            crate::isolation::guest::qemu_spec::SignedApplicationAttestation {
                manifest_b64: engine.encode(&verified.manifest),
                signature_b64: engine.encode(verified.signature),
            },
        ),
        endpoint: "/run/user/1000/workspace.sock".into(),
        memory_mib: 512,
        display: DisplayMode::Headless,
    };
    let command = spec.command().unwrap();
    let append = &command.args[command
        .args
        .iter()
        .position(|arg| arg == "-append")
        .unwrap()
        + 1];
    assert!(append.contains(&format!(
        "workspace.adapter.manifest={}",
        engine.encode(&manifest)
    )));
    assert!(append.contains(&format!(
        "workspace.adapter.signature={}",
        engine.encode(&signature)
    )));
    assert!(command.args.windows(2).any(|pair| {
        pair[0] == "-drive"
            && pair[1].contains("media=disk")
            && pair[1].contains("format=raw")
            && pair[1].contains("readonly=on")
    }));
    assert!(command.args.windows(2).any(|pair| pair == ["-nic", "none"]));
    assert!(!command.args.iter().any(|arg| {
        arg == "-fsdev" || arg == "-virtfs" || arg == "-netdev" || arg.contains("hostfwd=")
    }));
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn tampered_signature_or_manifest_cannot_download() {
    let (manifest, signature, key) = signed_manifest();
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let mut tampered = manifest.clone();
    let position = tampered
        .windows(4)
        .position(|part| part == b"text")
        .unwrap();
    tampered[position..position + 4].copy_from_slice(b"data");
    assert!(matches!(
        resolve_signed(
            Path::new("/unused"),
            "fixture-viewer",
            "x86_64",
            &tampered,
            &signature,
            &key,
            &downloader
        ),
        Err(CacheError::InvalidSignature)
    ));
    let mut bad_signature = signature.clone();
    bad_signature[0] ^= 1;
    assert!(matches!(
        resolve_signed(
            Path::new("/unused"),
            "fixture-viewer",
            "x86_64",
            &manifest,
            &bad_signature,
            &key,
            &downloader
        ),
        Err(CacheError::InvalidSignature)
    ));
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn manifest_is_canonical_and_matches_request() {
    let (manifest, signature, key) = signed_manifest();
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    assert!(matches!(
        resolve_signed(
            Path::new("/unused"),
            "fixture-viewer",
            "aarch64",
            &manifest,
            &signature,
            &key,
            &downloader
        ),
        Err(CacheError::NotApproved)
    ));
    let mut extra = manifest.clone();
    extra.extend_from_slice(b"id=other\n");
    assert!(matches!(
        resolve_signed(
            Path::new("/unused"),
            "fixture-viewer",
            "x86_64",
            &extra,
            &signature,
            &key,
            &downloader
        ),
        Err(CacheError::InvalidManifest)
    ));
    let mut missing_newline = manifest.clone();
    missing_newline.pop();
    assert!(matches!(
        parse_manifest(&missing_newline),
        Err(CacheError::InvalidManifest)
    ));
    let leading_zero = String::from_utf8(manifest.clone())
        .unwrap()
        .replace("max_bytes=1024", "max_bytes=01024");
    assert!(matches!(
        parse_manifest(leading_zero.as_bytes()),
        Err(CacheError::InvalidManifest)
    ));
    let insecure_url = String::from_utf8(manifest.clone())
        .unwrap()
        .replace("https://", "http://");
    assert!(matches!(
        parse_manifest(insecure_url.as_bytes()),
        Err(CacheError::InvalidManifest)
    ));
    let uppercase_scheme = String::from_utf8(manifest.clone())
        .unwrap()
        .replace("https://", "HTTPS://");
    assert!(matches!(
        parse_manifest(uppercase_scheme.as_bytes()),
        Err(CacheError::InvalidManifest)
    ));
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 0);
}

fn cache_dir() -> PathBuf {
    let directory = std::env::temp_dir().join(format!(
        "inheriti-adapter-cache-test-{}-{}",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory).unwrap();
    directory
}

#[test]
fn approved_bundle_downloads_once_then_works_offline() {
    let directory = cache_dir();
    let online = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let path = resolve_entry(&directory, &entry(), &online).unwrap();
    assert_eq!(fs::read(&path).unwrap(), BODY);
    assert_eq!(online.calls.load(Ordering::SeqCst), 1);
    let offline = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: vec![],
        offline: true,
    };
    assert_eq!(resolve_entry(&directory, &entry(), &offline).unwrap(), path);
    assert_eq!(offline.calls.load(Ordering::SeqCst), 0);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn corrupt_cache_is_replaced_only_with_verified_bytes() {
    let directory = cache_dir();
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let path = resolve_entry(&directory, &entry(), &downloader).unwrap();
    fs::write(&path, b"corrupt").unwrap();
    resolve_entry(&directory, &entry(), &downloader).unwrap();
    assert_eq!(fs::read(path).unwrap(), BODY);
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 2);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn wrong_digest_and_oversized_downloads_never_enter_cache() {
    let directory = cache_dir();
    let wrong = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: b"wrong".to_vec(),
        offline: false,
    };
    assert!(matches!(
        resolve_entry(&directory, &entry(), &wrong),
        Err(CacheError::DigestMismatch)
    ));
    let too_large = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: vec![1; 1025],
        offline: false,
    };
    assert!(matches!(
        resolve_entry(&directory, &entry(), &too_large),
        Err(CacheError::TooLarge)
    ));
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
    fs::remove_dir_all(directory).unwrap();
}

#[cfg(unix)]
#[test]
fn symlinked_cache_entry_is_rejected() {
    use std::os::unix::fs::symlink;
    let directory = cache_dir();
    let downloader = FixtureDownloader {
        calls: AtomicUsize::new(0),
        body: BODY.to_vec(),
        offline: false,
    };
    let path = resolve_entry(&directory, &entry(), &downloader).unwrap();
    fs::remove_file(&path).unwrap();
    symlink("/etc/passwd", &path).unwrap();
    assert!(matches!(
        resolve_entry(&directory, &entry(), &downloader),
        Err(CacheError::UnsafeCache)
    ));
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);
    fs::remove_dir_all(directory).unwrap();
}
