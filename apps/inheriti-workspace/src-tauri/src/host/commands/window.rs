//! Native window controls and result sizing exposed to the UI.

use std::sync::Mutex;

#[tauri::command]
pub fn viewer_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn viewer_window_chrome() -> bool {
    cfg!(target_os = "linux")
}

#[tauri::command]
pub fn viewer_window_action(window: tauri::WebviewWindow, action: &str) -> Result<(), String> {
    let result = match action {
        "drag" => window.start_dragging(),
        "minimize" => window.minimize(),
        "toggleMaximize" => {
            if window.is_maximized().map_err(|_| "window unavailable")? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        _ => return Err("unsupported window action".into()),
    };
    result.map_err(|_| "window unavailable".into())
}

pub struct WorkspaceWindowState(pub Mutex<bool>);

#[tauri::command]
pub fn viewer_show_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WorkspaceWindowState>,
) -> Result<(), String> {
    let mut changed = state.0.lock().map_err(|_| "window unavailable")?;
    if !*changed && !window.is_maximized().map_err(|_| "window unavailable")? {
        window.maximize().map_err(|_| "window unavailable")?;
        *changed = true;
    }
    Ok(())
}

#[tauri::command]
pub fn viewer_close_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, WorkspaceWindowState>,
) -> Result<(), String> {
    let mut changed = state.0.lock().map_err(|_| "window unavailable")?;
    if *changed {
        window.unmaximize().map_err(|_| "window unavailable")?;
        *changed = false;
    }
    Ok(())
}
