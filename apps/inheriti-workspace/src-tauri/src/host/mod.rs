mod bridge;
pub(crate) mod commands;
pub(crate) mod guest_session;
mod platform;
mod protocol;
mod startup_file;
#[cfg(test)]
#[path = "../../../tests/host-rust/host_tests.rs"]
mod tests;

pub use bridge::HostState;

pub fn forwarded_file(app: &tauri::AppHandle, args: &[String], cwd: &str) -> Result<bool, String> {
    let Some(file) = startup_file::StartupFile::from_secondary_args(args, cwd)? else {
        return Ok(false);
    };
    use tauri::Manager;
    app.state::<HostState>()
        .opened_file(file.as_path().to_path_buf())
}

#[cfg(target_os = "macos")]
pub fn opened_file(app: &tauri::AppHandle, urls: Vec<tauri::Url>) -> Result<bool, String> {
    if urls.len() != 1 {
        return Err("invalid_startup_file".into());
    }
    let path = urls[0].to_file_path().map_err(|_| "invalid_startup_file")?;
    use tauri::Manager;
    app.state::<HostState>().opened_file(path)
}

const MAX_RESPONSE: usize = 1400 * 1024;
