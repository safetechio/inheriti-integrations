//! Opt-in Linux VM proof for the signed, on-demand wordcraft document adapter.
//!
//! The probe keeps wordcraft out of the base guest image. It stages the signed
//! package as a read-only adapter, resolves it through the production document
//! registry, and opens the local DOCX fixture in separate sessions.
//! It requires a graphical Linux host and is intentionally serialized because
//! the VM is limited to 512 MiB.

#![cfg(target_os = "linux")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use inheriti_workspace::{
    isolation::guest::{
        adapter_cache::{AdapterCacheProgress, AdapterDownload, AdapterDownloader, CacheError},
        platform::prepare_runtime_for_document,
    },
    session::{GuestRuntime, Workspace},
};
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
        if env::var_os("WORKSPACE_KEEP_VM").is_none() {
            let _ = fs::remove_dir_all(&self.0);
        } else {
            eprintln!("preserving VM probe root: {}", self.0.display());
        }
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
    let serial_log = root.join("serial.log");
    let wrapper = resources.join("qemu-system-x86_64");
    fs::write(&wrapper, format!(
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' \"$@\" > {}\na=()\nwhile (($#)); do\n  if [[ $1 == -monitor && ${{2-}} == none ]]; then a+=(-monitor {}); shift 2; elif [[ $1 == -serial && ${{2-}} == none ]]; then a+=(-serial file:{}); shift 2; else a+=(\"$1\"); shift; fi\ndone\nexec {} \"${{a[@]}}\"\n",
        quote(&qemu_args),
        quote(Path::new(&format!("unix:{},server=on,wait=off", monitor.display()))),
        quote(&serial_log),
        quote(qemu)
    )).expect("write QEMU wrapper");
    fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).expect("chmod QEMU wrapper");
    fs::copy(kernel, resources.join("vmlinuz")).expect("stage kernel");
    fs::copy(initramfs, resources.join("initramfs")).expect("stage initramfs");
    fs::copy(initramfs, resources.join("initramfs-virgl")).expect("stage VirGL initramfs");
    let catalog = resources.join("adapters/document/wordcraft/x86_64");
    fs::create_dir_all(&catalog).expect("create document adapter catalog");
    fs::write(catalog.join("manifest"), manifest).expect("stage adapter manifest");
    fs::write(catalog.join("manifest.sig"), signature).expect("stage adapter signature");
    fs::write(catalog.join("release.pub"), public).expect("stage adapter public key");
    (resources, qemu_args)
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

fn require_capture_tools() {
    assert!(
        env::var_os("DISPLAY").is_some(),
        "wordcraft guest requires DISPLAY (X11/Xwayland)"
    );
    for tool in ["xwininfo", "xwd", "convert"] {
        let found = env::var_os("PATH")
            .into_iter()
            .flat_map(|path| env::split_paths(&path).collect::<Vec<_>>())
            .map(|dir| dir.join(tool))
            .any(|path| path.is_file());
        assert!(found, "wordcraft VirGL capture requires {tool} on PATH");
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

fn has_document_pixels(ppm: &[u8]) -> bool {
    let Some(pixels) = ppm_pixels(ppm) else {
        return false;
    };
    let distinct = pixels
        .chunks_exact(3)
        .step_by(97)
        .map(|p| (p[0] / 16, p[1] / 16, p[2] / 16))
        .collect::<std::collections::HashSet<_>>();
    distinct.len() > 12
}

fn wait_for_document_frame(root: &Path, screen: &Path) -> Vec<u8> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if let Some(frame) = capture_window(root, screen) {
            if has_document_pixels(&frame) {
                return frame;
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
    panic!("wordcraft did not produce a non-blank document frame");
}

#[test]
#[ignore = "requires signed wordcraft adapter, KVM, QEMU, and graphical Linux guest"]
fn real_wordcraft_adapter_caches_and_opens_docx() {
    let _lock = VM_LOCK.lock().expect("VM lock");
    let qemu = required("WORKSPACE_QEMU");
    let kernel = required("WORKSPACE_KERNEL");
    let initramfs = required("WORKSPACE_INITRAMFS");
    let image = required("WORKSPACE_WORDCRAFT_ADAPTER_IMAGE");
    let manifest = fs::read(required("WORKSPACE_WORDCRAFT_ADAPTER_MANIFEST")).expect("manifest");
    let signature = fs::read(required("WORKSPACE_WORDCRAFT_ADAPTER_SIGNATURE")).expect("signature");
    let public = public_key(&required("WORKSPACE_ADAPTER_PUBLIC_KEY_PEM"));
    let docx = fs::read(required("WORKSPACE_DOCX_FIXTURE")).expect("DOCX fixture");
    let root = env::temp_dir().join(format!("inheriti-real-wordcraft-{}", std::process::id()));
    fs::create_dir(&root).expect("test root");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("protect root");
    let _guard = TempRoot(root.clone());
    require_capture_tools();
    let (resources, qemu_args) = stage_runtime(
        &root, &qemu, &kernel, &initramfs, &manifest, &signature, &public,
    );
    let cache = root.join("adapter-cache");
    fs::create_dir(&cache).expect("cache");
    let downloader = LocalDownloader::new(image.clone());
    let mut progress = Vec::new();
    let mut runtime =
        prepare_runtime_for_document(&resources, &cache, &downloader, 512, &mut |event| {
            progress.push(event)
        })
        .expect("resolve signed wordcraft adapter");
    assert!(progress.iter().any(|event| matches!(event,
        AdapterCacheProgress::Downloading { received_bytes, total_bytes: Some(total) }
            if *received_bytes == image.metadata().expect("image metadata").len() && *total == *received_bytes
    )));
    assert!(progress.contains(&AdapterCacheProgress::Verifying));
    assert_eq!(progress.last(), Some(&AdapterCacheProgress::Complete));
    let screen = root.join("screen.ppm");
    runtime.start().expect("start WordCraft guest");
    runtime
        .ingress("sample-document.docx", &docx)
        .expect("admit DOCX");
    if let Err(error) = runtime.launch("sample-document.docx") {
        let serial = fs::read_to_string(root.join("serial.log")).unwrap_or_default();
        let tail = serial
            .chars()
            .rev()
            .take(2000)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        panic!("launch DOCX with wordcraft: {error:?}; guest serial tail: {tail}");
    }
    let args = fs::read_to_string(&qemu_args).expect("read QEMU args");
    assert!(args
        .lines()
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| pair == ["-display", "sdl,gl=on"]));
    assert!(args
        .lines()
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| pair == ["-device", "virtio-gpu-gl"]));
    let docx_frame = wait_for_document_frame(&root, &screen);
    if let Some(path) = env::var_os("WORKSPACE_WORDCRAFT_DOCX_SCREENSHOT") {
        fs::write(path, &docx_frame).expect("write DOCX screenshot");
    }
    runtime.teardown().expect("close DOCX guest");
    let mut second_workspace = Workspace::new(
        prepare_runtime_for_document(&resources, &cache, &downloader, 512, &mut |_| {})
            .expect("resolve cached wordcraft adapter for second DOCX session"),
    );
    second_workspace
        .open("sample-document-second.docx", &docx)
        .expect("open second DOCX with wordcraft");
    let second_frame = wait_for_document_frame(&root, &screen);
    if let Some(path) = env::var_os("WORKSPACE_WORDCRAFT_SECOND_DOCX_SCREENSHOT") {
        fs::write(path, &second_frame).expect("write second DOCX screenshot");
    }
    second_workspace.close().expect("close second DOCX guest");
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);
    downloader.offline.store(true, Ordering::SeqCst);
    let mut cached_progress = Vec::new();
    let cached = prepare_runtime_for_document(&resources, &cache, &downloader, 512, &mut |event| {
        cached_progress.push(event)
    })
    .expect("resolve wordcraft from offline cache");
    assert_eq!(
        cached_progress,
        [
            AdapterCacheProgress::CacheHit,
            AdapterCacheProgress::Complete
        ]
    );
    let mut offline_workspace = Workspace::new(cached);
    offline_workspace
        .open("sample-document-cached.docx", &docx)
        .expect("open cached DOCX");
    let _ = wait_for_document_frame(&root, &screen);
    offline_workspace
        .close()
        .expect("close cached document guest");
    assert_eq!(downloader.calls.load(Ordering::SeqCst), 1);
}
