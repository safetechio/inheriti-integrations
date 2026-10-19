//! Opt-in Linux VM proof for the signed, on-demand Gnumeric adapter.
//!
//! This test intentionally uses a separate VM for CSV, XLSX, and the failing
//! launcher control. It proves that spreadsheet files reach the selected
//! optional application and that a later session can use the verified cache.

#![cfg(target_os = "linux")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use inheriti_workspace::{
    isolation::guest::{
        adapter_cache::{AdapterDownloader, CacheError},
        platform::prepare_runtime_for_signed_adapter,
        qemu_spec::DisplayMode,
    },
    session::Workspace,
};
use ring::signature::Ed25519KeyPair;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{Read, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

static VM_LOCK: Mutex<()> = Mutex::new(());

struct TempRoot(PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct LocalDownloader {
    image: PathBuf,
    offline: AtomicBool,
    calls: AtomicUsize,
}
impl LocalDownloader {
    fn new(image: PathBuf) -> Self {
        Self {
            image,
            offline: AtomicBool::new(false),
            calls: AtomicUsize::new(0),
        }
    }
    fn offline(&self) {
        self.offline.store(true, Ordering::SeqCst);
    }
}
impl AdapterDownloader for LocalDownloader {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError> {
        assert!(url.starts_with("https://"));
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.offline.load(Ordering::SeqCst) {
            return Err(CacheError::Download("offline test transport".into()));
        }
        Ok(Box::new(
            fs::File::open(&self.image).map_err(CacheError::Io)?,
        ))
    }
}

fn required(name: &str) -> PathBuf {
    let path = PathBuf::from(env::var_os(name).unwrap_or_else(|| panic!("set {name}")));
    let meta = fs::symlink_metadata(&path).unwrap_or_else(|e| panic!("invalid {name}: {e}"));
    assert!(
        meta.file_type().is_file() && meta.len() > 0,
        "invalid {name}"
    );
    path
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn stage_runtime(
    root: &Path,
    qemu: &Path,
    kernel: &Path,
    initramfs: &Path,
) -> (PathBuf, PathBuf, PathBuf) {
    let resources = root.join("workspace-vm");
    fs::create_dir(&resources).expect("create VM resources");
    let monitor = root.join("monitor.sock");
    let screen = root.join("screen.ppm");
    let wrapper = resources.join("qemu-system-x86_64");
    fs::write(&wrapper, format!(
        "#!/usr/bin/env bash\nset -euo pipefail\na=()\nwhile (($#)); do\n  if [[ $1 == -display && ${{2-}} == sdl,* ]]; then a+=(-display none); shift 2; elif [[ $1 == -monitor && ${{2-}} == none ]]; then a+=(-monitor {}); shift 2; else a+=(\"$1\"); shift; fi\ndone\nexec {} \"${{a[@]}}\"\n",
        quote(Path::new(&format!("unix:{},server=on,wait=off", monitor.display()))), quote(qemu)
    )).expect("write QEMU wrapper");
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).expect("chmod QEMU wrapper");
    fs::copy(kernel, resources.join("vmlinuz")).expect("stage kernel");
    fs::copy(initramfs, resources.join("initramfs")).expect("stage initramfs");
    (resources, monitor, screen)
}

fn screenshot(monitor: &Path, screen: &Path) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut stream = loop {
        match std::os::unix::net::UnixStream::connect(monitor) {
            Ok(s) => break s,
            Err(e) if Instant::now() < deadline => {
                let _ = e;
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => panic!("QEMU monitor unavailable: {e}"),
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .expect("monitor timeout");
    let mut greeting = [0_u8; 512];
    let _ = stream.read(&mut greeting);
    let _ = fs::remove_file(screen);
    writeln!(stream, "screendump {}", screen.display()).expect("screendump");
    stream.flush().expect("flush screendump");
    while Instant::now() < deadline {
        if let Ok(bytes) = fs::read(screen) {
            return bytes;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("QEMU produced no screendump")
}

fn has_spreadsheet_pixels(ppm: &[u8]) -> bool {
    let Some(header) = ppm.windows(5).position(|p| p == b"\n255\n") else {
        return false;
    };
    let pixels = &ppm[header + 5..];
    let white = pixels
        .chunks_exact(3)
        .filter(|p| p.iter().all(|v| *v >= 245))
        .count();
    let grid = pixels
        .chunks_exact(3)
        .filter(|p| p.iter().all(|v| *v >= 185 && *v <= 215))
        .count();
    let dark = pixels
        .chunks_exact(3)
        .filter(|p| p.iter().all(|v| *v <= 90))
        .count();
    white > 50_000 && grid > 5_000 && dark > 500
}

fn public_key(path: &Path) -> [u8; 32] {
    let body = fs::read_to_string(path)
        .expect("read public key")
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>();
    let der = STANDARD.decode(body).expect("decode public key");
    let mut key = [0_u8; 32];
    key.copy_from_slice(&der[der.len() - 32..]);
    key
}

fn private_key(path: &Path, public: &[u8; 32]) -> Ed25519KeyPair {
    let body = fs::read_to_string(path)
        .expect("read private key")
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>();
    let der = STANDARD.decode(body).expect("decode private key");
    Ed25519KeyPair::from_seed_and_public_key(&der[der.len() - 32..], public)
        .expect("private/public key pair")
}

fn failing_adapter(
    root: &Path,
    source: &Path,
    manifest: &[u8],
    private: &Path,
    public: &[u8; 32],
) -> (PathBuf, Vec<u8>, Vec<u8>) {
    let image = root.join("gnumeric-fail.ext4");
    fs::copy(source, &image).expect("copy adapter");
    let launcher = root.join("fail-launch");
    fs::write(&launcher, b"#!/bin/sh\nexit 73\n").expect("write failing launcher");
    assert!(Command::new("debugfs")
        .args(["-w", "-R", "rm /bin/launch"])
        .arg(&image)
        .status()
        .expect("debugfs rm")
        .success());
    let command = format!("write {} /bin/launch", launcher.display());
    assert!(Command::new("debugfs")
        .args(["-w", "-R", &command])
        .arg(&image)
        .status()
        .expect("debugfs write")
        .success());
    let digest = Sha256::digest(fs::read(&image).expect("read failing image"));
    let hex = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let text = String::from_utf8(manifest.to_vec()).expect("manifest UTF-8");
    let mut text = text
        .lines()
        .map(|line| {
            if line.starts_with("id=") {
                "id=gnumeric-fail".to_owned()
            } else if line.starts_with("sha256=") {
                format!("sha256={hex}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    text.push('\n');
    let manifest = text.into_bytes();
    let signature = private_key(private, public)
        .sign(&manifest)
        .as_ref()
        .to_vec();
    (image, manifest, signature)
}

#[test]
#[ignore = "requires signed Gnumeric adapter, KVM, QEMU, and the bounded spreadsheet guest"]
fn real_gnumeric_adapter_caches_and_opens_csv_and_xlsx() {
    let _lock = VM_LOCK.lock().expect("VM lock");
    let qemu = required("WORKSPACE_QEMU");
    let kernel = required("WORKSPACE_KERNEL");
    let initramfs = required("WORKSPACE_INITRAMFS");
    let image = required("WORKSPACE_GNUMERIC_ADAPTER_IMAGE");
    let manifest = fs::read(required("WORKSPACE_GNUMERIC_ADAPTER_MANIFEST")).expect("manifest");
    let signature = fs::read(required("WORKSPACE_GNUMERIC_ADAPTER_SIGNATURE")).expect("signature");
    let public_path = required("WORKSPACE_ADAPTER_PUBLIC_KEY_PEM");
    let private_path = required("WORKSPACE_ADAPTER_PRIVATE_KEY_PEM");
    let public = public_key(&public_path);
    let csv = fs::read(required("WORKSPACE_CSV_FIXTURE")).expect("CSV fixture");
    let xlsx = fs::read(required("WORKSPACE_XLSX_FIXTURE")).expect("XLSX fixture");
    let root = env::temp_dir().join(format!("inheriti-real-gnumeric-{}", std::process::id()));
    fs::create_dir(&root).expect("test root");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("protect root");
    let _guard = TempRoot(root.clone());
    let (resources, monitor, screen) = stage_runtime(&root, &qemu, &kernel, &initramfs);
    let cache = root.join("adapter-cache");
    fs::create_dir(&cache).expect("cache");
    let downloader = LocalDownloader::new(image.clone());
    let first_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "gnumeric",
        &manifest,
        &signature,
        &public,
        &downloader,
        384,
        DisplayMode::GraphicalSdl,
    )
    .expect("resolve Gnumeric cache miss");
    let mut first = Workspace::new(first_runtime);
    first
        .open("sample-table.csv", &csv)
        .expect("open CSV with Gnumeric");
    let first_screen = screenshot(&monitor, &screen);
    assert!(
        has_spreadsheet_pixels(&first_screen),
        "CSV did not render a spreadsheet"
    );
    if let Some(path) = env::var_os("WORKSPACE_GNUMERIC_SCREENSHOT") {
        fs::write(path, &first_screen).expect("write screenshot");
    }
    first.close().expect("close CSV guest");
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);
    let cached = fs::read_dir(&cache)
        .expect("read cache")
        .map(|e| e.expect("cache entry").path())
        .collect::<Vec<_>>();
    assert_eq!(cached.len(), 1);
    assert_eq!(
        fs::read(&cached[0]).expect("cached image"),
        fs::read(&image).expect("source image")
    );

    downloader.offline();
    let second_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "gnumeric",
        &manifest,
        &signature,
        &public,
        &downloader,
        384,
        DisplayMode::GraphicalSdl,
    )
    .expect("resolve offline cache hit");
    let mut second = Workspace::new(second_runtime);
    second
        .open("sample-spreadsheet.xlsx", &xlsx)
        .expect("open XLSX from cache");
    let second_screen = screenshot(&monitor, &screen);
    assert!(
        has_spreadsheet_pixels(&second_screen),
        "XLSX did not render a spreadsheet"
    );
    second.close().expect("close XLSX guest");
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);

    let (fail_image, fail_manifest, fail_signature) =
        failing_adapter(&root, &image, &manifest, &private_path, &public);
    let fail_downloader = LocalDownloader::new(fail_image);
    let _ = fs::remove_file(&monitor);
    let fail_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "gnumeric-fail",
        &fail_manifest,
        &fail_signature,
        &public,
        &fail_downloader,
        384,
        DisplayMode::GraphicalSdl,
    )
    .expect("resolve failing signed adapter");
    let mut fail = Workspace::new(fail_runtime);
    assert!(
        fail.open("sample-table.csv", &csv).is_err(),
        "built-in spreadsheet fallback masked failing optional adapter"
    );
}
