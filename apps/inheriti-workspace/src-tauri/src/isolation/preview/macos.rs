use std::{path::PathBuf, process::Command};

use super::process::run_bounded;

const HELPER_ID: &str = "com.safetech.inheriti.workspace.preview";

fn paths() -> Result<(PathBuf, PathBuf), String> {
    let executable = std::env::current_exe().map_err(|_| "viewer executable unavailable")?;
    let app = executable
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .ok_or("viewer bundle unavailable")?;
    if app.extension() != Some(std::ffi::OsStr::new("app")) {
        return Err("viewer bundle unavailable".into());
    }
    let helper = app.join("Contents/Helpers/Inheriti® Preview.app/Contents/MacOS/preview-helper");
    Ok((app.to_path_buf(), helper))
}

fn verified_helper() -> Result<PathBuf, String> {
    let (app, helper) = paths()?;
    if !helper.is_file() || helper.is_symlink() {
        return Err("isolated preview unavailable".into());
    }
    let mut verify = Command::new("/usr/bin/codesign");
    verify
        .args([
            "--verify",
            "--strict",
            "--deep",
            "-R",
            &format!(
                "anchor apple generic and identifier \"com.safetech.inheriti.workspace.{}\"",
                env!("INHERITI_WORKSPACE_DEPLOYMENT")
            ),
        ])
        .arg(&app);
    if !run_bounded(verify, None)?.0.success() {
        return Err("viewer signature invalid".into());
    }
    let mut requirement = Command::new("/usr/bin/codesign");
    requirement
        .args([
            "--verify",
            "--strict",
            "-R",
            &format!("anchor apple generic and identifier \"{HELPER_ID}\""),
        ])
        .arg(&helper);
    if !run_bounded(requirement, None)?.0.success() {
        return Err("preview helper signature invalid".into());
    }
    let mut entitlement = Command::new("/usr/bin/codesign");
    entitlement
        .args(["-d", "--entitlements", "-", "--xml"])
        .arg(&helper);
    let (status, plist) = run_bounded(entitlement, None)?;
    if !status.success() {
        return Err("preview helper sandbox unavailable".into());
    }
    let xml = std::str::from_utf8(&plist).map_err(|_| "invalid preview helper entitlements")?;
    if xml.matches("<key>").count() != 1
        || !xml.contains("<key>com.apple.security.app-sandbox</key>")
    {
        return Err("preview helper sandbox unavailable".into());
    }
    let mut sandbox = Command::new("/usr/bin/plutil");
    sandbox.args([
        "-extract",
        r"com\.apple\.security\.app-sandbox",
        "raw",
        "-o",
        "-",
        "-",
    ]);
    let (status, value) = run_bounded(sandbox, Some(&plist))?;
    if !status.success() || value != b"true\n" && value != b"true" {
        return Err("preview helper sandbox unavailable".into());
    }
    Ok(helper)
}

pub(crate) fn ensure_preview_available() -> Result<(), String> {
    let helper = verified_helper()?;
    let (status, output) = run_bounded(Command::new(helper), Some(b"Synthetic safe text\n"))?;
    if !status.success() || output != b"Synthetic safe text\n" {
        return Err("isolated preview unavailable".into());
    }
    Ok(())
}

pub(crate) fn preview_text(bytes: &[u8], mime: &str) -> Result<String, String> {
    if mime != "text/plain" || bytes.is_empty() || bytes.len() > inheriti_workspace::MAX_INPUT_BYTES
    {
        return Err("unsupported preview input".into());
    }
    let helper = verified_helper()?;
    let command = Command::new(helper);
    let (status, output) = run_bounded(command, Some(bytes))?;
    if !status.success() {
        return Err("sandbox rejected preview".into());
    }
    String::from_utf8(output).map_err(|_| "invalid sandbox output".into())
}
