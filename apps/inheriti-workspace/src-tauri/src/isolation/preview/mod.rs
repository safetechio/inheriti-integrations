//! Legacy bounded preview-helper sandbox for supported previews.
//!
//! Separate from the disposable QEMU guest; it does not provide a general
//! workspace session for arbitrary files.

#[cfg(target_os = "linux")]
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(unix)]
mod process;
#[cfg(windows)]
pub(crate) mod windows;
#[cfg(target_os = "linux")]
use process::{run_bounded, run_bounded_with_limit};
#[cfg(target_os = "linux")]
mod pdf;
#[cfg(target_os = "linux")]
pub(crate) use pdf::{preview_pdf_linux, preview_synthetic_pdf_linux};

#[cfg(target_os = "linux")]
fn runtime_libraries(helper: &Path) -> Result<BTreeSet<PathBuf>, String> {
    let mut command = Command::new("ldd");
    command.arg(helper);
    let (status, output) = run_bounded(command, None)?;
    if !status.success() {
        return Err("helper dependencies unresolved".into());
    }
    let listing = String::from_utf8(output).map_err(|_| "invalid dependency listing")?;
    if listing.contains("not found") {
        return Err("helper dependencies unresolved".into());
    }
    let libraries: BTreeSet<_> = listing
        .split_whitespace()
        .filter(|token| token.starts_with('/'))
        .map(PathBuf::from)
        .collect();
    if libraries.is_empty() || libraries.iter().any(|path| !path.is_file()) {
        return Err("helper dependencies unresolved".into());
    }
    Ok(libraries)
}

#[cfg(target_os = "linux")]
fn sandbox_args(helper: &Path, libraries: &BTreeSet<PathBuf>) -> Result<Vec<String>, String> {
    if !helper.is_file() || libraries.is_empty() {
        return Err("preview helper unavailable".into());
    }
    let mut directories = BTreeSet::from([PathBuf::from("/app")]);
    for library in libraries {
        if !library.is_absolute() || !library.is_file() {
            return Err("invalid runtime library".into());
        }
        for ancestor in library
            .parent()
            .ok_or("invalid runtime library")?
            .ancestors()
        {
            if ancestor != Path::new("/") {
                directories.insert(ancestor.to_path_buf());
            }
        }
    }
    let mut args = vec![
        "--unshare-net",
        "--unshare-pid",
        "--unshare-ipc",
        "--clearenv",
        "--die-with-parent",
        "--new-session",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    let mut directories = directories.into_iter().collect::<Vec<_>>();
    directories.sort_by_key(|path| {
        (
            path.components().count(),
            path.to_string_lossy().to_string(),
        )
    });
    for directory in directories {
        args.extend(["--dir".into(), directory.display().to_string()]);
    }
    args.extend([
        "--proc".into(),
        "/proc".into(),
        "--dev".into(),
        "/dev".into(),
        "--ro-bind".into(),
        helper.display().to_string(),
        "/app/preview-helper".into(),
    ]);
    for library in libraries {
        args.extend([
            "--ro-bind".into(),
            library.display().to_string(),
            library.display().to_string(),
        ]);
    }
    args.push("/app/preview-helper".into());
    Ok(args)
}

#[cfg(target_os = "linux")]
pub(crate) fn preview_synthetic_linux() -> Result<String, String> {
    preview_text_linux(b"Synthetic safe text\n", "text/plain")
}

#[cfg(target_os = "linux")]
pub(crate) fn preview_text_linux(bytes: &[u8], mime: &str) -> Result<String, String> {
    let helper = std::env::current_exe()
        .map_err(|_| "viewer executable unavailable")?
        .with_file_name("preview-helper");
    preview_text_linux_with_helper(bytes, mime, &helper)
}

#[cfg(target_os = "linux")]
fn preview_text_linux_with_helper(
    bytes: &[u8],
    mime: &str,
    helper: &Path,
) -> Result<String, String> {
    if mime != "text/plain" || bytes.is_empty() || bytes.len() > inheriti_workspace::MAX_INPUT_BYTES
    {
        return Err("unsupported preview input".into());
    }
    let libraries = runtime_libraries(helper)?;
    let args = sandbox_args(helper, &libraries)?;
    let mut command = Command::new("bwrap");
    command.args(args);
    let (status, output) = run_bounded(command, Some(bytes))?;
    if !status.success() {
        return Err("sandbox rejected preview".into());
    }
    String::from_utf8(output).map_err(|_| "invalid sandbox output".into())
}

#[cfg(target_os = "linux")]
pub(crate) fn preview_webp_linux(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let helper = std::env::current_exe()
        .map_err(|_| "viewer executable unavailable")?
        .with_file_name("preview-helper");
    preview_webp_linux_with_helper(bytes, &helper)
}

#[cfg(target_os = "linux")]
fn preview_webp_linux_with_helper(
    bytes: &[u8],
    helper: &Path,
) -> Result<(u32, u32, Vec<u8>), String> {
    if bytes.is_empty() || bytes.len() > inheriti_workspace::MAX_WEBP_INPUT_BYTES {
        return Err("unsupported preview input".into());
    }
    let libraries = runtime_libraries(helper)?;
    let args = sandbox_args(helper, &libraries)?;
    let mut command = Command::new("bwrap");
    command.args(args).arg("--webp");
    let (status, output) = run_bounded_with_limit(
        command,
        Some(bytes),
        inheriti_workspace::MAX_WEBP_OUTPUT_BYTES,
    )?;
    if !status.success() || output.len() < 8 {
        return Err("sandbox rejected preview".into());
    }
    let width = u32::from_le_bytes(output[0..4].try_into().unwrap());
    let height = u32::from_le_bytes(output[4..8].try_into().unwrap());
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or("invalid sandbox output")?;
    if width == 0
        || height == 0
        || pixels > inheriti_workspace::MAX_WEBP_PIXELS
        || output.len() != pixels * 4 + 8
    {
        return Err("invalid sandbox output".into());
    }
    Ok((width, height, output[8..].to_vec()))
}

#[cfg(all(test, target_os = "linux"))]
#[path = "../../../../tests/preview-unit/sandbox_tests.rs"]
mod tests;
