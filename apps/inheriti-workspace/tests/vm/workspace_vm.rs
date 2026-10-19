//! Opt-in local KVM test of the post-decryption Workspace boundary.
//! The opt-in renderer initramfs adds bounded in-guest PDF/JPEG parsing.
#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires local KVM, QEMU, and PDF/JPEG fixtures"]
fn post_decrypt_pdf_and_image_lifecycle_in_real_guest() {
    use inheriti_workspace::workspace::linux_qemu::{LinuxQemuConfig, LinuxQemuRuntime};
    use inheriti_workspace::workspace::qemu_spec::{DisplayMode, GuestArch};
    use inheriti_workspace::workspace::{Workspace, WorkspaceError};
    use std::os::unix::fs::DirBuilderExt;
    use std::{env, fs, path::PathBuf};

    struct SocketRoot(PathBuf);
    impl Drop for SocketRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let qemu = env::var("WORKSPACE_QEMU").expect("WORKSPACE_QEMU required");
    let kernel = PathBuf::from(env::var("WORKSPACE_KERNEL").expect("WORKSPACE_KERNEL required"));
    let initramfs =
        PathBuf::from(env::var("WORKSPACE_INITRAMFS").expect("WORKSPACE_INITRAMFS required"));
    let pdf = fs::read(env::var("WORKSPACE_PDF_FIXTURE").expect("WORKSPACE_PDF_FIXTURE required"))
        .expect("read PDF fixture");
    let image =
        fs::read(env::var("WORKSPACE_IMAGE_FIXTURE").expect("WORKSPACE_IMAGE_FIXTURE required"))
            .expect("read image fixture");
    let socket_root =
        env::temp_dir().join(format!("inheriti-workspace-rust-{}", std::process::id()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&socket_root)
        .expect("create private socket directory");
    let root_guard = SocketRoot(socket_root.clone());
    let config = LinuxQemuConfig {
        qemu: PathBuf::from(qemu),
        kernel,
        initramfs,
        application_image: None,
        application_attestation: None,
        socket_directory: socket_root.clone(),
        memory_mib: 384,
        arch: match std::env::consts::ARCH {
            "x86_64" => GuestArch::X86_64,
            "aarch64" => GuestArch::Aarch64,
            arch => panic!("unsupported test host architecture: {arch}"),
        },
        display: DisplayMode::Headless,
    };
    for (name, bytes) in [
        ("document.pdf", pdf.as_slice()),
        ("photo.jpg", image.as_slice()),
    ] {
        let mut workspace = Workspace::new(LinuxQemuRuntime::new(config.clone()));
        workspace.open(name, bytes).expect("open in Linux guest");
        workspace.close().expect("destroy Linux guest");
    }
    if env::var_os("WORKSPACE_RENDER_PROBE").is_some() {
        let mut workspace = Workspace::new(LinuxQemuRuntime::new(config));
        assert!(matches!(
            workspace.open("invalid.pdf", b"%PDF-1.7\nnot a PDF"),
            Err(WorkspaceError::Runtime(error)) if error.kind() == std::io::ErrorKind::InvalidData
        ));
        workspace.close().expect("destroy rejected guest");
    }
    assert_eq!(fs::read_dir(&socket_root).unwrap().count(), 0);
    drop(root_guard);
    assert!(!socket_root.exists());
}

/// Run the checked-in post-decryption corpus through the same native guest
/// boundary on every host. Each file receives a fresh disposable session.
#[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
#[test]
#[cfg_attr(
    target_os = "linux",
    ignore = "requires a staged workspace-vm resource directory and host acceleration"
)]
fn packaged_runtime_synthetic_file_session() {
    use inheriti_workspace::workspace::{
        handoff::{HandoffError, HandoffFailure},
        platform::prepare_runtime_with_display,
        qemu_spec::DisplayMode,
        Workspace,
    };
    use std::{cell::Cell, collections::BTreeSet, env, fs, io, path::PathBuf};

    let resource_dir = match env::var_os("WORKSPACE_VM_RESOURCE_DIR") {
        Some(path) => PathBuf::from(path),
        None => {
            #[cfg(target_os = "linux")]
            panic!("set WORKSPACE_VM_RESOURCE_DIR to a staged workspace-vm directory");
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            {
                eprintln!("skipped: WORKSPACE_VM_RESOURCE_DIR is not set");
                return;
            }
        }
    };
    #[cfg(target_os = "macos")]
    let _supervisor_guard = stage_test_supervisor();

    let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(fixture_dir.join("manifest.json")).expect("read fixture manifest"),
    )
    .expect("parse fixture manifest");
    assert_eq!(manifest["schema"], 1);
    let files = manifest["files"].as_array().expect("fixture list");
    assert!(!files.is_empty(), "native corpus must contain fixtures");
    let mut names = BTreeSet::new();

    #[cfg(target_os = "linux")]
    let socket_dir =
        PathBuf::from(env::var_os("XDG_RUNTIME_DIR").expect("XDG_RUNTIME_DIR required"))
            .join("inheriti-workspace");
    #[cfg(target_os = "linux")]
    let sockets_before: std::collections::BTreeSet<_> = match std::fs::read_dir(&socket_dir) {
        Ok(entries) => entries
            .map(|entry| entry.expect("read socket entry").file_name())
            .collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => BTreeSet::new(),
        Err(error) => panic!("read private socket directory: {error}"),
    };

    for entry in files {
        let name = entry["file"].as_str().expect("fixture filename");
        assert!(names.insert(name), "duplicate fixture: {name}");
        assert_eq!(
            PathBuf::from(name)
                .file_name()
                .and_then(|part| part.to_str()),
            Some(name),
            "fixture names must be basenames"
        );
        let bytes = fs::read(fixture_dir.join(name)).expect("read corpus file");
        assert_eq!(
            bytes.len() as u64,
            entry["bytes"].as_u64().expect("fixture size")
        );
        let admitted = entry["expected"]["guestAdmission"]
            .as_bool()
            .expect("guest admission expectation");
        let should_ack_launch = entry["expected"]["guestLaunchAck"]
            .as_bool()
            .expect("guest launch acknowledgement expectation");
        assert!(
            admitted || !should_ack_launch,
            "{name}: rejected file cannot launch"
        );
        let runtime = prepare_runtime_with_display(&resource_dir, 384, DisplayMode::GraphicalSdl)
            .unwrap_or_else(|error| {
                panic!(
                    "cannot prepare packaged guest assets at {}: {error}",
                    resource_dir.display()
                )
            });
        let mut workspace = Workspace::new(runtime);
        let authorization_called = Cell::new(false);
        let result = workspace.open_authorized(name, || {
            authorization_called.set(true);
            Ok::<Vec<u8>, ()>(bytes)
        });
        assert!(
            authorization_called.get(),
            "{name}: guest was not ready before authorization: {result:?}"
        );
        // The VM protocol ACK proves ingress and viewer launch only. It does
        // not prove that the application displayed pixels or document content.
        if should_ack_launch {
            assert!(
                result.is_ok(),
                "{name}: expected guest launch acknowledgement, got {result:?}"
            );
        } else {
            assert!(
                matches!(
                    &result,
                    Err(HandoffError::Failure(HandoffFailure::Runtime(error)))
                        if error.kind() == io::ErrorKind::InvalidData
                ),
                "{name}: expected guest admission or launch rejection, got {result:?}"
            );
        }
        workspace.close().expect("guest teardown must succeed");
    }
    #[cfg(target_os = "linux")]
    {
        let sockets_after: std::collections::BTreeSet<_> = std::fs::read_dir(&socket_dir)
            .expect("read private socket directory after close")
            .map(|entry| entry.expect("read socket entry").file_name())
            .collect();
        assert_eq!(
            sockets_after, sockets_before,
            "guest socket residue after close"
        );
    }
}

/// Cargo places integration tests in `target/debug/deps`, whereas the packaged
/// app places the supervisor beside its executable. Stage a signed copy for
/// this one native test without changing the production lookup rule.
#[cfg(target_os = "macos")]
struct TestSupervisorGuard(Option<std::path::PathBuf>);

#[cfg(target_os = "macos")]
impl Drop for TestSupervisorGuard {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(target_os = "macos")]
fn stage_test_supervisor() -> TestSupervisorGuard {
    use std::{env, fs, io, os::unix::fs::OpenOptionsExt, path::PathBuf, process::Command};

    let source = PathBuf::from(
        env::var_os("WORKSPACE_TEST_SUPERVISOR")
            .expect("set WORKSPACE_TEST_SUPERVISOR to a signed workspace-supervisor binary"),
    );
    let source = source.canonicalize().expect("resolve test supervisor");
    assert!(
        fs::symlink_metadata(&source)
            .expect("test supervisor metadata")
            .file_type()
            .is_file(),
        "test supervisor must be a regular file"
    );
    let target = env::current_exe()
        .expect("test executable")
        .with_file_name("workspace-supervisor");
    if source == target {
        assert!(
            Command::new("codesign")
                .args(["--verify", "--strict"])
                .arg(&target)
                .status()
                .expect("verify test supervisor signature")
                .success(),
            "test supervisor signature invalid"
        );
        return TestSupervisorGuard(None);
    }
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o700)
        .open(&target)
        .expect("stage test supervisor beside cargo test executable; remove stale copy if needed");
    let guard = TestSupervisorGuard(Some(target.clone()));
    let copy_result = io::copy(
        &mut fs::File::open(&source).expect("read test supervisor"),
        &mut output,
    );
    if let Err(error) = copy_result {
        panic!("copy test supervisor: {error}");
    }
    output.sync_all().expect("sync staged test supervisor");
    assert!(
        Command::new("codesign")
            .args(["--verify", "--strict"])
            .arg(&target)
            .status()
            .expect("verify staged supervisor signature")
            .success(),
        "staged supervisor signature invalid"
    );
    guard
}
