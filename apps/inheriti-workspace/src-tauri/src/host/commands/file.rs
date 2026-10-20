//! File access inspection before a protected opening.

use super::super::bridge::{invoke, HostState};
use super::super::protocol::valid_uuid;
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn viewer_has_startup_file(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<HostState>();
    let current = state.startup_file.lock().map_err(|_| "host unavailable")?;
    Ok(current.as_ref().map_err(Clone::clone)?.is_some())
}

#[tauri::command]
pub async fn viewer_clear_startup_file(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<HostState>();
    if state.reset_active.swap(true, Ordering::AcqRel) {
        return Err("opening_in_progress".into());
    }
    state.resetting.store(true, Ordering::Release);
    state.cancel_host_process();
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<HostState>();
        {
            let mut child = state.child.lock().map_err(|_| "host unavailable")?;
            if let Some(mut running) = child.take() {
                let _ = running.kill();
                let _ = running.wait();
            }
            state.child_pid.store(0, Ordering::Release);
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        while state.opening_active.load(Ordering::Acquire) {
            if Instant::now() >= deadline {
                return Err("opening_in_progress".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        state.guest.close()?;
        #[cfg(target_os = "linux")]
        state.pdf.lock().map_err(|_| "host unavailable")?.take();
        let mut current = state.startup_file.lock().map_err(|_| "host unavailable")?;
        let had_file = matches!(&*current, Ok(Some(_)));
        *current = Ok(None);
        state.cancel_requested.store(false, Ordering::Release);
        state.resetting.store(false, Ordering::Release);
        Ok(had_file)
    })
    .await
    .map_err(|_| "host unavailable".to_owned());
    state.reset_active.store(false, Ordering::Release);
    result?
}

#[tauri::command]
pub async fn viewer_choose_file(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Inheriti® protected file", &["inheriti"])
            .blocking_pick_file()
        else {
            return Ok(false);
        };
        accept_file(&app, file.into_path().map_err(|_| "invalid_startup_file")?)
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}

#[tauri::command]
pub fn viewer_accept_file(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    accept_file(&app, path.into())
}

fn accept_file(app: &tauri::AppHandle, path: std::path::PathBuf) -> Result<bool, String> {
    let changed = app.state::<HostState>().opened_file(path)?;
    if changed {
        app.emit("viewer-startup-file", ())
            .map_err(|_| "host unavailable")?;
    }
    Ok(changed)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileAccess {
    copy_id: String,
    status: String,
    deployment: String,
    origin: String,
    recipient: String,
    expires_at: Option<String>,
    allowed_uses: Option<u32>,
}

#[tauri::command]
pub async fn viewer_file_access(
    app: tauri::AppHandle,
    copy_id: String,
) -> Result<FileAccess, String> {
    if !valid_uuid(&copy_id) {
        return Err("invalid_copy_id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        invoke(
            &app,
            &app.state::<HostState>(),
            "getFileAccess",
            None,
            Some(&copy_id),
        )
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}

#[tauri::command]
pub async fn viewer_inspect_startup_file(app: tauri::AppHandle) -> Result<FileAccess, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<HostState>();
        state
            .startup_file
            .lock()
            .map_err(|_| "host unavailable")?
            .as_ref()
            .map_err(Clone::clone)?
            .as_ref()
            .ok_or("no_startup_file")?;
        invoke(&app, &state, "inspectStartupFile", None, None)
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
