use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
static FIXTURE_ID: AtomicU64 = AtomicU64::new(0);

#[test]
fn missing_resources_fail_before_runtime_creation() {
    let missing = std::env::temp_dir().join(format!("missing-workspace-vm-{}", std::process::id()));
    assert!(prepare_runtime(&missing, 512).is_err());
    assert!(
        matches!(prepare_runtime(&missing, 0), Err(error) if error.kind() == io::ErrorKind::InvalidInput)
    );
}

#[test]
fn unsigned_optional_application_is_rejected_before_guest_boot() {
    let missing = std::env::temp_dir().join(format!("missing-workspace-vm-{}", std::process::id()));
    let result = prepare_runtime_with_application_image(
        &missing,
        512,
        DisplayMode::Headless,
        Some(PathBuf::from("/cache/apps.img")),
    );
    assert!(matches!(result, Err(error) if error.kind() == io::ErrorKind::InvalidInput));
}

#[test]
fn malformed_signed_application_is_rejected_before_guest_boot() {
    let missing = std::env::temp_dir().join(format!("missing-workspace-vm-{}", std::process::id()));
    let result = prepare_runtime_with_signed_application_image(
        &missing,
        512,
        DisplayMode::Headless,
        PathBuf::from("/cache/apps.img"),
        "bad value".into(),
        "bad value".into(),
    );
    assert!(matches!(result, Err(error) if error.kind() == io::ErrorKind::InvalidInput));
}

#[test]
fn packaged_assets_require_regular_nonempty_components() {
    let dir = std::env::temp_dir().join(format!(
        "workspace-assets-{}-{}",
        std::process::id(),
        FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&dir).unwrap();
    let executable = match current_arch().unwrap() {
        GuestArch::X86_64 => "qemu-system-x86_64",
        GuestArch::Aarch64 => "qemu-system-aarch64",
    };
    let qemu = dir.join(format!("{executable}{}", std::env::consts::EXE_SUFFIX));
    fs::write(&qemu, b"qemu").unwrap();
    fs::write(dir.join("vmlinuz"), b"kernel").unwrap();
    fs::write(dir.join("initramfs"), b"initrd").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&qemu, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let assets = GuestAssets::from_resource_dir(&dir, DisplayMode::Headless).unwrap();
    assert_eq!(assets.qemu, qemu);
    assert!(GuestAssets::from_resource_dir(&dir, DisplayMode::GraphicalVirgl).is_err());
    fs::write(dir.join("initramfs-virgl"), b"virgl guest").unwrap();
    let virgl_assets = GuestAssets::from_resource_dir(&dir, DisplayMode::GraphicalVirgl).unwrap();
    assert_eq!(virgl_assets.initramfs, dir.join("initramfs-virgl"));
    fs::write(dir.join("initramfs"), b"").unwrap();
    assert!(GuestAssets::from_resource_dir(&dir, DisplayMode::Headless).is_err());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn application_image_must_be_absolute_nonempty_regular_and_not_a_symlink() {
    let dir = std::env::temp_dir().join(format!(
        "workspace-app-image-{}-{}",
        std::process::id(),
        FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&dir).unwrap();
    let image = dir.join("apps.img");
    assert!(validate_application_image(Path::new("relative.img")).is_err());
    assert!(validate_application_image(&dir).is_err());
    fs::write(&image, b"").unwrap();
    assert!(validate_application_image(&image).is_err());
    fs::write(&image, b"image").unwrap();
    assert!(validate_application_image(&image).is_ok());
    #[cfg(unix)]
    {
        let link = dir.join("link.img");
        std::os::unix::fs::symlink(&image, &link).unwrap();
        assert!(validate_application_image(&link).is_err());
    }
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn macos_factory_constructs_only_with_valid_assets() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!(
        "workspace-macos-gate-{}-{}",
        std::process::id(),
        FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&dir).unwrap();
    let executable = match current_arch().unwrap() {
        GuestArch::X86_64 => "qemu-system-x86_64",
        GuestArch::Aarch64 => "qemu-system-aarch64",
    };
    let qemu = dir.join(executable);
    fs::write(&qemu, b"qemu").unwrap();
    fs::set_permissions(&qemu, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(dir.join("vmlinuz"), b"kernel").unwrap();
    fs::write(dir.join("initramfs"), b"initrd").unwrap();
    let _: PlatformRuntime = prepare_runtime(&dir, 512).unwrap();
    let _: PlatformRuntime =
        prepare_runtime_with_display(&dir, 512, DisplayMode::GraphicalSdl).unwrap();
    fs::remove_file(dir.join("initramfs")).unwrap();
    assert!(prepare_runtime(&dir, 512).is_err());
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn private_directory_rejects_world_access_and_symlink() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = std::env::temp_dir().join(format!(
        "workspace-dir-test-{}-{}",
        std::process::id(),
        std::thread::current().name().unwrap_or("test")
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(validate_private_dir(&root).is_ok());
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(validate_private_dir(&root).is_err());
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let link = root.with_extension("link");
    let _ = fs::remove_file(&link);
    symlink(&root, &link).unwrap();
    assert!(validate_private_dir(&link).is_err());
    fs::remove_file(link).unwrap();
    fs::remove_dir(root).unwrap();
}
