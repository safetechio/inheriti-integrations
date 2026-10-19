//! Opt-in Linux VM proof for the first real signed optional adapter.
//!
//! The adapter image, manifest, signature, and public key are built outside
//! the repository. This test only wires those release-shaped artifacts into
//! the same cache and runtime path used by Workspace.

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

struct LocalAdapterDownloader {
    image: PathBuf,
    offline: AtomicBool,
    calls: AtomicUsize,
}

impl LocalAdapterDownloader {
    fn new(image: PathBuf) -> Self {
        Self {
            image,
            offline: AtomicBool::new(false),
            calls: AtomicUsize::new(0),
        }
    }

    fn go_offline(&self) {
        self.offline.store(true, Ordering::SeqCst);
    }
}

impl AdapterDownloader for LocalAdapterDownloader {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError> {
        assert!(
            url.starts_with("https://"),
            "signed manifest must retain HTTPS URL"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.offline.load(Ordering::SeqCst) {
            return Err(CacheError::Download("offline test transport".into()));
        }
        Ok(Box::new(
            fs::File::open(&self.image).map_err(CacheError::Io)?,
        ))
    }
}

fn required_file(name: &str) -> PathBuf {
    let path = PathBuf::from(env::var_os(name).unwrap_or_else(|| panic!("set {name}")));
    let metadata = fs::symlink_metadata(&path)
        .unwrap_or_else(|error| panic!("invalid {name} {}: {error}", path.display()));
    assert!(
        metadata.file_type().is_file() && metadata.len() > 0,
        "invalid {name}"
    );
    path
}

fn copy_regular(source: &Path, destination: &Path, executable: bool) {
    fs::copy(source, destination).unwrap_or_else(|error| {
        panic!(
            "copy {} to {}: {error}",
            source.display(),
            destination.display()
        )
    });
    if executable {
        fs::set_permissions(destination, fs::Permissions::from_mode(0o700))
            .expect("make staged QEMU wrapper executable");
    }
}

fn shell_quote(value: &Path) -> String {
    format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
}

fn stage_runtime(
    root: &Path,
    qemu: &Path,
    kernel: &Path,
    initramfs: &Path,
) -> (PathBuf, PathBuf, PathBuf) {
    let resources = root.join("workspace-vm");
    fs::create_dir(&resources).expect("create staged resource directory");
    let wrapper = resources.join("qemu-system-x86_64");
    let monitor = root.join("monitor.sock");
    let screen = root.join("screen.ppm");
    // Keep the probe usable on hosts where QEMU has no SDL display module. The
    // guest still receives its virtio GPU and the protocol launch ACK remains
    // the assertion; no host display or clipboard is exposed.
    fs::write(
        &wrapper,
        format!(
            "#!/usr/bin/env bash\nset -euo pipefail\nargs=()\nwhile (($#)); do\n  if [[ $1 == -display && ${{2-}} == sdl,* ]]; then args+=(-display none); shift 2; elif [[ $1 == -monitor && ${{2-}} == none ]]; then args+=(-monitor {}); shift 2; else args+=(\"$1\"); shift; fi\ndone\nexec {} \"${{args[@]}}\"\n",
            shell_quote(Path::new(&format!("unix:{},server=on,wait=off", monitor.display()))),
            shell_quote(qemu),
        ),
    )
    .expect("write QEMU wrapper");
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700))
        .expect("make QEMU wrapper executable");
    copy_regular(kernel, &resources.join("vmlinuz"), false);
    copy_regular(initramfs, &resources.join("initramfs"), false);
    (resources, monitor, screen)
}

fn monitor_screendump(monitor: &Path, screen: &Path) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut stream = loop {
        match std::os::unix::net::UnixStream::connect(monitor) {
            Ok(stream) => break stream,
            Err(error) if Instant::now() < deadline => {
                let _ = error;
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => panic!("QEMU monitor unavailable: {error}"),
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .expect("set monitor timeout");
    let mut greeting = [0_u8; 512];
    let _ = stream.read(&mut greeting);
    let _ = fs::remove_file(screen);
    writeln!(stream, "screendump {}", screen.display()).expect("send QEMU screendump");
    stream.flush().expect("flush QEMU screendump");
    while Instant::now() < deadline {
        if let Ok(bytes) = fs::read(screen) {
            return bytes;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("QEMU did not produce a screendump")
}

fn has_pdf_pixels(ppm: &[u8]) -> bool {
    let Some(header_end) = ppm.windows(5).position(|part| part == b"\n255\n") else {
        return false;
    };
    let pixels = &ppm[header_end + 5..];
    let red = pixels
        .chunks_exact(3)
        .filter(|pixel| *pixel == [229, 25, 25])
        .count();
    let white = pixels
        .chunks_exact(3)
        .filter(|pixel| pixel.iter().all(|channel| *channel >= 245))
        .count();
    red >= 10_000 && white >= 10_000
}

fn public_key_from_pem(path: &Path) -> [u8; 32] {
    let pem = fs::read_to_string(path).expect("read adapter public PEM");
    let body = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>();
    let der = STANDARD.decode(body).expect("decode adapter public PEM");
    assert!(der.len() >= 32, "public PEM is too short");
    let mut key = [0u8; 32];
    key.copy_from_slice(&der[der.len() - 32..]);
    key
}

fn private_key_from_pem(path: &Path, public_key: &[u8; 32]) -> Ed25519KeyPair {
    let pem = fs::read_to_string(path).expect("read adapter private PEM");
    let body = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<String>();
    let der = STANDARD.decode(body).expect("decode adapter private PEM");
    let seed = &der[der.len() - 32..];
    Ed25519KeyPair::from_seed_and_public_key(seed, public_key).expect("decode adapter private key")
}

fn make_failing_adapter(
    root: &Path,
    source: &Path,
    manifest: &[u8],
    private_key: &Path,
    public_key: &[u8; 32],
) -> (PathBuf, Vec<u8>, Vec<u8>) {
    let image = root.join("mupdf-fail.ext4");
    fs::copy(source, &image).expect("copy MuPDF adapter for negative control");
    let launcher = root.join("failing-launch");
    fs::write(&launcher, b"#!/bin/sh\nexit 73\n").expect("write failing adapter launcher");
    let remove = Command::new("debugfs")
        .args(["-w", "-R", "rm /bin/launch"])
        .arg(&image)
        .status()
        .expect("run debugfs remove");
    assert!(
        remove.success(),
        "debugfs could not remove adapter launcher"
    );
    let command = format!("write {} /bin/launch", launcher.display());
    let write = Command::new("debugfs")
        .args(["-w", "-R", &command])
        .arg(&image)
        .status()
        .expect("run debugfs write");
    assert!(
        write.success(),
        "debugfs could not install failing launcher"
    );

    let digest = Sha256::digest(fs::read(&image).expect("read failing adapter"));
    let digest = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut failing_manifest = String::from_utf8(manifest.to_vec()).expect("UTF-8 manifest");
    failing_manifest = failing_manifest
        .lines()
        .map(|line| {
            if line.starts_with("id=") {
                "id=mupdf-fail".to_owned()
            } else if line.starts_with("sha256=") {
                format!("sha256={digest}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    failing_manifest.push('\n');
    let failing_manifest = failing_manifest.into_bytes();
    let keypair = private_key_from_pem(private_key, public_key);
    let signature = keypair.sign(&failing_manifest).as_ref().to_vec();
    (image, failing_manifest, signature)
}

fn read_or_default(name: &str, fallback: &Path) -> PathBuf {
    env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback.to_owned())
}

#[test]
#[ignore = "requires a signed MuPDF adapter, KVM, QEMU, and a built guest"]
fn real_mupdf_adapter_downloads_caches_and_opens_pdf() {
    let _lock = VM_LOCK.lock().expect("VM test lock");
    let qemu = required_file("WORKSPACE_QEMU");
    let kernel = required_file("WORKSPACE_KERNEL");
    let initramfs = required_file("WORKSPACE_INITRAMFS");
    let adapter_image = required_file("WORKSPACE_MUPDF_ADAPTER_IMAGE");
    let manifest = fs::read(required_file("WORKSPACE_MUPDF_ADAPTER_MANIFEST"))
        .expect("read signed MuPDF manifest");
    let signature = fs::read(required_file("WORKSPACE_MUPDF_ADAPTER_SIGNATURE"))
        .expect("read signed MuPDF signature");
    let public_key = public_key_from_pem(&required_file("WORKSPACE_ADAPTER_PUBLIC_KEY_PEM"));
    let private_key = required_file("WORKSPACE_ADAPTER_PRIVATE_KEY_PEM");
    let fixture = read_or_default(
        "WORKSPACE_PDF_FIXTURE",
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/vm/fixture-two-pages.pdf")
            .as_path(),
    );
    let pdf = fs::read(&fixture).expect("read PDF fixture");
    assert!(pdf.starts_with(b"%PDF-"), "fixture must be a PDF");

    let root = env::temp_dir().join(format!("inheriti-real-mupdf-{}", std::process::id()));
    fs::create_dir(&root).expect("create private test directory");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("protect test directory");
    let _root_guard = TempRoot(root.clone());
    let (resources, monitor, screen) = stage_runtime(&root, &qemu, &kernel, &initramfs);
    let cache = root.join("adapter-cache");
    fs::create_dir(&cache).expect("create adapter cache");
    fs::set_permissions(&cache, fs::Permissions::from_mode(0o700)).expect("protect adapter cache");
    let downloader = LocalAdapterDownloader::new(adapter_image.clone());

    let first_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "mupdf",
        &manifest,
        &signature,
        &public_key,
        &downloader,
        384,
        DisplayMode::GraphicalSdl,
    )
    .expect("resolve signed MuPDF adapter on cache miss");
    let mut first = Workspace::new(first_runtime);
    first
        .open("fixture-two-pages.pdf", &pdf)
        .expect("open PDF with MuPDF adapter");
    let first_screen = monitor_screendump(&monitor, &screen);
    assert!(
        has_pdf_pixels(&first_screen),
        "first guest session did not render the PDF page"
    );
    if let Some(path) = env::var_os("WORKSPACE_MUPDF_SCREENSHOT") {
        fs::write(path, &first_screen).expect("write MuPDF screenshot evidence");
    }
    first.close().expect("tear down first guest");
    assert_eq!(
        downloader.calls.load(Ordering::SeqCst),
        1,
        "first session downloads once"
    );

    let cached: Vec<_> = fs::read_dir(&cache)
        .expect("read adapter cache")
        .map(|entry| entry.expect("cache entry").path())
        .collect();
    assert_eq!(cached.len(), 1, "one verified adapter should be cached");
    assert_eq!(
        fs::read(&cached[0]).expect("read cached adapter"),
        fs::read(required_file("WORKSPACE_MUPDF_ADAPTER_IMAGE")).expect("read source adapter")
    );

    downloader.go_offline();
    let second_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "mupdf",
        &manifest,
        &signature,
        &public_key,
        &downloader,
        384,
        DisplayMode::GraphicalSdl,
    )
    .expect("resolve signed MuPDF adapter from offline cache");
    let mut second = Workspace::new(second_runtime);
    second
        .open("fixture-two-pages.pdf", &pdf)
        .expect("open cached PDF with MuPDF adapter");
    let second_screen = monitor_screendump(&monitor, &screen);
    assert!(
        has_pdf_pixels(&second_screen),
        "offline cached guest session did not render the PDF page"
    );
    second.close().expect("tear down second guest");
    assert_eq!(
        downloader.calls.load(Ordering::SeqCst),
        1,
        "offline cache hit must not download"
    );

    // A validly signed adapter whose launcher exits must fail the open. If the
    // optional family selector silently fell back to the built-in PDF viewer,
    // this control would succeed and the assertion would fail.
    let (failing_image, failing_manifest, failing_signature) =
        make_failing_adapter(&root, &adapter_image, &manifest, &private_key, &public_key);
    let failing_downloader = LocalAdapterDownloader::new(failing_image);
    let _ = fs::remove_file(&monitor);
    let failing_runtime = prepare_runtime_for_signed_adapter(
        &resources,
        &cache,
        "mupdf-fail",
        &failing_manifest,
        &failing_signature,
        &public_key,
        &failing_downloader,
        384,
        DisplayMode::GraphicalSdl,
    )
    .expect("resolve signed failing adapter");
    let mut failing = Workspace::new(failing_runtime);
    assert!(
        failing.open("fixture-two-pages.pdf", &pdf).is_err(),
        "built-in PDF fallback masked a failing optional adapter"
    );
}
