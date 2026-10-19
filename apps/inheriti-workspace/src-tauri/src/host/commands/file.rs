//! File access inspection before a protected opening.

use super::super::bridge::{invoke, HostState};
use super::super::protocol::valid_uuid;
use serde::{Deserialize, Serialize};
use tauri::Manager;

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
