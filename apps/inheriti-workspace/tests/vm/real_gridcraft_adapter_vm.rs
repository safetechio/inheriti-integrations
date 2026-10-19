//! Opt-in Linux VM proof for the signed, on-demand GridCraft adapter.
//!
//! The test deliberately uses two disposable guests: the first verifies and
//! caches the signed adapter while opening CSV; the second is offline and must
//! open XLSX from that verified cache. A signed launcher that exits is used as
//! a negative control so a built-in spreadsheet viewer cannot mask a bad
//! optional adapter.

#![cfg(target_os = "linux")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use inheriti_workspace::{
    isolation::guest::{
        adapter_cache::{AdapterCacheProgress, AdapterDownload, AdapterDownloader, CacheError},
        adapter_registry::SpreadsheetApplication,
        platform::{prepare_runtime_for_signed_adapter, prepare_runtime_for_spreadsheet},
        qemu_spec::DisplayMode,
    },
    session::Workspace,
};
use ring::signature::Ed25519KeyPair;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Read,
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

    fn open_with_length(&self, url: &str) -> Result<AdapterDownload, CacheError> {
        let reader = self.open(url)?;
        let total_bytes = fs::metadata(&self.image).map_err(CacheError::Io)?.len();
        Ok(AdapterDownload {
            reader,
            total_bytes: Some(total_bytes),
        })
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
    manifest: &[u8],
    signature: &[u8],
    public: &[u8; 32],
) -> (PathBuf, PathBuf) {
    let resources = root.join("workspace-vm");
    fs::create_dir(&resources).expect("create VM resources");
    let monitor = root.join("monitor.sock");
    let qemu_args = root.join("qemu-args.txt");
    let wrapper = resources.join("qemu-system-x86_64");
    fs::write(&wrapper, format!(
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' \"$@\" > {}\na=()\nwhile (($#)); do\n  if [[ $1 == -monitor && ${{2-}} == none ]]; then a+=(-monitor {}); shift 2; else a+=(\"$1\"); shift; fi\ndone\nexec {} \"${{a[@]}}\"\n",
        quote(&qemu_args),
        quote(Path::new(&format!("unix:{},server=on,wait=off", monitor.display()))), quote(qemu)
    )).expect("write QEMU wrapper");
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).expect("chmod QEMU wrapper");
    fs::copy(kernel, resources.join("vmlinuz")).expect("stage kernel");
    fs::copy(initramfs, resources.join("initramfs")).expect("stage initramfs");
    fs::copy(initramfs, resources.join("initramfs-virgl")).expect("stage VirGL initramfs");
    let catalog = resources.join("adapters/spreadsheet/gridcraft/x86_64");
    fs::create_dir_all(&catalog).expect("create spreadsheet adapter catalog");
    fs::write(catalog.join("manifest"), manifest).expect("stage adapter manifest");
    fs::write(catalog.join("manifest.sig"), signature).expect("stage adapter signature");
    fs::write(catalog.join("release.pub"), public).expect("stage adapter public key");
    (resources, qemu_args)
}

fn require_capture_tools() {
    assert!(
        env::var_os("DISPLAY").is_some(),
        "GridCraft VirGL capture requires DISPLAY (X11/Xwayland)"
    );
    for tool in ["xwininfo", "xwd", "convert"] {
        let found = env::var_os("PATH")
            .into_iter()
            .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
            .map(|dir| dir.join(tool))
            .any(|path| path.is_file());
        assert!(found, "GridCraft VirGL capture requires {tool} on PATH");
    }
}

fn window_id() -> Option<String> {
    let output = Command::new("xwininfo")
        .args(["-root", "-tree"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.contains("\"QEMU") || line.contains("Inheriti"))
        .and_then(|line| line.split_whitespace().find(|word| word.starts_with("0x")))
        .map(str::to_owned)
}

fn capture_window(root: &Path, screen: &Path) -> Option<Vec<u8>> {
    let id = window_id()?;
    let xwd = root.join("window.xwd");
    let _ = fs::remove_file(&xwd);
    let xwd_status = Command::new("xwd")
        .args(["-silent", "-id", &id, "-out"])
        .arg(&xwd)
        .status()
        .ok()?;
    if !xwd_status.success() {
        return None;
    }
    let output = Command::new("convert")
        .arg(&xwd)
        .arg(format!("ppm:{}", screen.display()))
        .output()
        .ok()?;
    let _ = fs::remove_file(&xwd);
    output
        .status
        .success()
        .then(|| fs::read(screen).ok())
        .flatten()
}

fn ppm_pixels(ppm: &[u8]) -> Option<&[u8]> {
    if !ppm.starts_with(b"P6") {
        return None;
    }
    let mut cursor = 2;
    let mut values = [0usize; 3];
    for value in &mut values {
        loop {
            while ppm.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                cursor += 1;
            }
            if ppm.get(cursor) != Some(&b'#') {
                break;
            }
            while ppm.get(cursor).is_some_and(|byte| *byte != b'\n') {
                cursor += 1;
            }
        }
        let start = cursor;
        while ppm.get(cursor).is_some_and(|byte| byte.is_ascii_digit()) {
            cursor += 1;
        }
        if start == cursor {
            return None;
        }
        *value = std::str::from_utf8(&ppm[start..cursor])
            .ok()?
            .parse()
            .ok()?;
    }
    if values[0] == 0 || values[1] == 0 || values[2] != 255 {
        return None;
    }
    while ppm.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    let expected = values[0].checked_mul(values[1])?.checked_mul(3)?;
    (ppm.len() == cursor.checked_add(expected)?).then_some(&ppm[cursor..])
}

fn has_spreadsheet_pixels(ppm: &[u8]) -> bool {
    let Some(pixels) = ppm_pixels(ppm) else {
        return false;
    };
    let white = pixels
        .chunks_exact(3)
        .filter(|p| p.iter().all(|v| *v >= 245))
        .count();
    let grid = pixels
        .chunks_exact(3)
        .filter(|p| p.iter().all(|v| *v >= 170 && *v <= 225))
        .count();
    let dark = pixels
        .chunks_exact(3)
        .filter(|p| p.iter().all(|v| *v <= 100))
        .count();
    white > 50_000 && grid > 2_000 && dark > 500
}

/// Require a stable graphical frame instead of accepting the first ACK, a
/// partial PPM, or a transient blank/error window. This is a visual smoke
/// assertion; it does not identify individual fixture cell values.
fn wait_for_stable_spreadsheet(root: &Path, screen: &Path) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut previous = None;
    while Instant::now() < deadline {
        let Some(frame) = capture_window(root, screen) else {
            thread::sleep(Duration::from_millis(250));
            continue;
        };
        if has_spreadsheet_pixels(&frame) {
            if previous.as_ref() == Some(&frame) {
                return frame;
            }
            previous = Some(frame);
        } else {
            previous = None;
        }
        thread::sleep(Duration::from_millis(250));
    }
    panic!("GridCraft did not produce two stable spreadsheet frames")
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
    let image = root.join("gridcraft-fail.ext4");
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
    let mut text = String::from_utf8(manifest.to_vec())
        .expect("manifest UTF-8")
        .lines()
        .map(|line| {
            if line.starts_with("id=") {
                "id=gridcraft-fail".to_owned()
            } else if line.starts_with("sha256=") {
                format!("sha256={hex}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    text.push('\n');
    let signature = private_key(private, public)
        .sign(text.as_bytes())
        .as_ref()
        .to_vec();
    (image, text.into_bytes(), signature)
}

#[test]
#[ignore = "requires signed GridCraft adapter, KVM, QEMU, and the graphical spreadsheet guest"]
fn real_gridcraft_adapter_caches_and_opens_csv_and_xlsx() {
    let _lock = VM_LOCK.lock().expect("VM lock");
    let qemu = required("WORKSPACE_QEMU");
    let kernel = required("WORKSPACE_KERNEL");
    let initramfs = required("WORKSPACE_INITRAMFS");
    let image = required("WORKSPACE_GRIDCRAFT_ADAPTER_IMAGE");
    let manifest = fs::read(required("WORKSPACE_GRIDCRAFT_ADAPTER_MANIFEST")).expect("manifest");
    let signature = fs::read(required("WORKSPACE_GRIDCRAFT_ADAPTER_SIGNATURE")).expect("signature");
    let public_path = required("WORKSPACE_ADAPTER_PUBLIC_KEY_PEM");
    let private_path = required("WORKSPACE_ADAPTER_PRIVATE_KEY_PEM");
    let public = public_key(&public_path);
    let csv = fs::read(required("WORKSPACE_CSV_FIXTURE")).expect("CSV fixture");
    let xlsx = fs::read(required("WORKSPACE_XLSX_FIXTURE")).expect("XLSX fixture");
    let root = env::temp_dir().join(format!("inheriti-real-gridcraft-{}", std::process::id()));
    fs::create_dir(&root).expect("test root");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("protect root");
    let _guard = TempRoot(root.clone());
    require_capture_tools();
    let (resources, qemu_args) = stage_runtime(
        &root, &qemu, &kernel, &initramfs, &manifest, &signature, &public,
    );
    let screen = root.join("screen.ppm");
    let cache = root.join("adapter-cache");
    fs::create_dir(&cache).expect("cache");
    let downloader = LocalDownloader::new(image.clone());
    let mut first_progress = Vec::new();
    let first_runtime = prepare_runtime_for_spreadsheet(
        &resources,
        &cache,
        None,
        &downloader,
        384,
        &mut |progress| first_progress.push(progress),
    )
    .expect("resolve default GridCraft catalog cache miss");
    assert!(first_progress.iter().any(|progress| matches!(
        progress,
        AdapterCacheProgress::Downloading {
            received_bytes,
            total_bytes: Some(total),
        } if *received_bytes == image.metadata().expect("image metadata").len() && *total == image.metadata().expect("image metadata").len()
    )));
    assert!(first_progress.contains(&AdapterCacheProgress::Verifying));
    assert_eq!(first_progress.last(), Some(&AdapterCacheProgress::Complete));
    assert!(!first_progress.contains(&AdapterCacheProgress::CacheHit));
    let mut first = Workspace::new(first_runtime);
    first
        .open("sample-table.csv", &csv)
        .expect("open CSV with GridCraft");
    let qemu_args_text = fs::read_to_string(&qemu_args).expect("read QEMU args");
    assert!(qemu_args_text
        .lines()
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| pair == ["-display", "sdl,gl=on"]));
    assert!(qemu_args_text
        .lines()
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| pair == ["-device", "virtio-gpu-gl"]));
    let first_screen = wait_for_stable_spreadsheet(&root, &screen);
    if let Some(path) = env::var_os("WORKSPACE_GRIDCRAFT_SCREENSHOT") {
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
    downloader.offline.store(true, Ordering::SeqCst);
    let mut second_progress = Vec::new();
    let second_runtime = prepare_runtime_for_spreadsheet(
        &resources,
        &cache,
        Some(SpreadsheetApplication::GridCraft),
        &downloader,
        384,
        &mut |progress| second_progress.push(progress),
    )
    .expect("resolve offline cache hit");
    assert_eq!(
        second_progress,
        [
            AdapterCacheProgress::CacheHit,
            AdapterCacheProgress::Complete
        ]
    );
    let mut second = Workspace::new(second_runtime);
    second
        .open("sample-spreadsheet.xlsx", &xlsx)
        .expect("open XLSX from cache");
    let _second_screen = wait_for_stable_spreadsheet(&root, &screen);
    second.close().expect("close XLSX guest");
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);
    let (fail_image, fail_manifest, fail_signature) =
        failing_adapter(&root, &image, &manifest, &private_path, &public);
    let fail_downloader = LocalDownloader::new(fail_image);
    let fail_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "gridcraft-fail",
        &fail_manifest,
        &fail_signature,
        &public,
        &fail_downloader,
        384,
        DisplayMode::GraphicalVirgl,
    )
    .expect("resolve failing signed adapter");
    let mut fail = Workspace::new(fail_runtime);
    assert!(
        fail.open("sample-table.csv", &csv).is_err(),
        "built-in fallback masked failing GridCraft adapter"
    );
}
