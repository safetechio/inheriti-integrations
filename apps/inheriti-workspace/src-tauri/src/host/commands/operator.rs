//! Sign-in and organisation commands forwarded to the local host.

use super::super::bridge::{invoke, HostState};
use super::super::protocol::valid_uuid;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthStatus {
    signed_in: bool,
    #[serde(default)]
    selected_organization_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Organization {
    id: String,
    name: String,
}

#[tauri::command]
pub async fn viewer_status(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        invoke(&app, &app.state::<HostState>(), "status", None, None)
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
#[tauri::command]
pub async fn viewer_sign_in(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        invoke(&app, &app.state::<HostState>(), "signIn", None, None)
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
#[tauri::command]
pub async fn viewer_sign_out(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    super::file::viewer_clear_startup_file(app.clone()).await?;
    tauri::async_runtime::spawn_blocking(move || {
        invoke(&app, &app.state::<HostState>(), "signOut", None, None)
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
#[tauri::command]
pub async fn viewer_try_browser_sign_in(app: tauri::AppHandle) -> Result<AuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        invoke(
            &app,
            &app.state::<HostState>(),
            "tryBrowserSignIn",
            None,
            None,
        )
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
#[tauri::command]
pub async fn viewer_organizations(app: tauri::AppHandle) -> Result<Vec<Organization>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        invoke(&app, &app.state::<HostState>(), "organizations", None, None)
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
#[tauri::command]
pub async fn viewer_select_organization(
    app: tauri::AppHandle,
    organization_id: String,
) -> Result<AuthStatus, String> {
    if !valid_uuid(&organization_id) {
        return Err("invalid_organization_id".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        invoke(
            &app,
            &app.state::<HostState>(),
            "selectOrganization",
            Some(&organization_id),
            None,
        )
    })
    .await
    .map_err(|_| "host unavailable".to_owned())?
}
