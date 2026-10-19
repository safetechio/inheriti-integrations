use super::*;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn fixture(application: SpreadsheetApplication, arch: &str) -> PathBuf {
    signed_fixture("spreadsheet", application.id(), arch)
}

fn signed_fixture(family: &str, id: &str, arch: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "workspace-registry-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let dir = root.join(family).join(id).join(arch);
    fs::create_dir_all(&dir).unwrap();
    let manifest = format!("workspace-adapter-v1\nid={id}\nversion=1.0\narch={arch}\nfamily={family}\nsha256={}\nmax_bytes=1024\nurl=https://example.invalid/adapter.bundle\n", "a".repeat(64));
    let keypair = Ed25519KeyPair::from_pkcs8(
        Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
            .unwrap()
            .as_ref(),
    )
    .unwrap();
    fs::write(dir.join("manifest"), manifest.as_bytes()).unwrap();
    fs::write(
        dir.join("manifest.sig"),
        keypair.sign(manifest.as_bytes()).as_ref(),
    )
    .unwrap();
    fs::write(dir.join("release.pub"), keypair.public_key().as_ref()).unwrap();
    root
}

#[test]
fn video_requires_signed_mpv_and_matching_family() {
    let root = signed_fixture("video", "mpv", "x86_64");
    let loaded = load_video_adapter(&root, GuestArch::X86_64).unwrap();
    assert_eq!(loaded.architecture, "x86_64");
    assert_eq!(loaded.display, DisplayMode::GraphicalSdl);
    assert!(load_video_adapter(&root, GuestArch::Aarch64).is_err());
    fs::write(root.join("video/mpv/x86_64/manifest.sig"), [0u8; 64]).unwrap();
    assert!(load_video_adapter(&root, GuestArch::X86_64).is_err());
    fs::remove_dir_all(root).unwrap();

    let root = signed_fixture("spreadsheet", "mpv", "x86_64");
    assert!(load_video_adapter(&root, GuestArch::X86_64).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn document_requires_signed_wordcraft_and_matching_family() {
    let root = signed_fixture("document", "wordcraft", "x86_64");
    let loaded = load_document_adapter(&root, GuestArch::X86_64).unwrap();
    assert_eq!(loaded.architecture, "x86_64");
    assert_eq!(loaded.display, DisplayMode::GraphicalVirgl);
    assert!(load_document_adapter(&root, GuestArch::Aarch64).is_err());
    fs::write(
        root.join("document/wordcraft/x86_64/manifest.sig"),
        [0u8; 64],
    )
    .unwrap();
    assert!(load_document_adapter(&root, GuestArch::X86_64).is_err());
    fs::remove_dir_all(root).unwrap();

    for (family, id) in [("spreadsheet", "wordcraft"), ("document", "gridcraft")] {
        let root = signed_fixture(family, id, "x86_64");
        assert!(load_document_adapter(&root, GuestArch::X86_64).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn preferred_order_and_display_policy() {
    assert_eq!(
        SpreadsheetApplication::PREFERRED_ORDER,
        [
            SpreadsheetApplication::GridCraft,
            SpreadsheetApplication::Gnumeric
        ]
    );
    assert!(!SpreadsheetApplication::GridCraft.deprecated());
    assert!(SpreadsheetApplication::Gnumeric.deprecated());
    assert_eq!(
        SpreadsheetApplication::GridCraft.display(),
        DisplayMode::GraphicalVirgl
    );
    assert_eq!(
        SpreadsheetApplication::Gnumeric.display(),
        DisplayMode::GraphicalSdl
    );
}

#[test]
fn default_requires_gridcraft_and_deprecated_choice_is_explicit() {
    let root = fixture(SpreadsheetApplication::Gnumeric, "x86_64");
    assert!(load_spreadsheet_adapter(&root, GuestArch::X86_64, None).is_err());
    let loaded = load_spreadsheet_adapter(
        &root,
        GuestArch::X86_64,
        Some(SpreadsheetApplication::Gnumeric),
    )
    .unwrap();
    assert_eq!(loaded.application, SpreadsheetApplication::Gnumeric);
    assert_eq!(loaded.display, DisplayMode::GraphicalSdl);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn architecture_and_signature_must_match() {
    let root = fixture(SpreadsheetApplication::GridCraft, "x86_64");
    assert!(load_spreadsheet_adapter(&root, GuestArch::Aarch64, None).is_err());
    let loaded = load_spreadsheet_adapter(&root, GuestArch::X86_64, None).unwrap();
    assert_eq!(loaded.architecture, "x86_64");
    fs::write(
        root.join("spreadsheet/gridcraft/x86_64/manifest.sig"),
        [0u8; 64],
    )
    .unwrap();
    assert!(load_spreadsheet_adapter(&root, GuestArch::X86_64, None).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn symlinked_resource_is_rejected() {
    use std::os::unix::fs::symlink;
    let root = fixture(SpreadsheetApplication::GridCraft, "x86_64");
    let link = root.with_extension("link");
    symlink(&root, &link).unwrap();
    assert!(load_spreadsheet_adapter(&link, GuestArch::X86_64, None).is_err());
    assert!(load_spreadsheet_adapter(
        &root.join("../").join(root.file_name().unwrap()),
        GuestArch::X86_64,
        None
    )
    .is_err());
    fs::remove_file(link).unwrap();
    fs::remove_dir_all(root).unwrap();
}
