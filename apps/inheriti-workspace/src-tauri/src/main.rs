mod isolation {
    //! Tauri-side preview isolation adapter.
    pub(crate) mod preview;
}

mod host;

use tauri::{Emitter, Manager};

fn main() {
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if matches!(host::forwarded_file(app, &args, &cwd), Ok(true)) {
                let _ = app.emit("viewer-startup-file", ());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    let builder = builder
        .manage(host::HostState::new())
        .setup(|app| {
            #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
            if std::env::var_os("INHERITI_WORKSPACE_TEST_AUTOSTART").as_deref()
                == Some(std::ffi::OsStr::new("1"))
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let state = handle.state::<host::HostState>();
                    let _ = state.open_test_pdf();
                });
            }
            #[cfg(not(all(feature = "workspace-test-harness", debug_assertions)))]
            let _ = app;
            Ok(())
        })
        .manage(host::commands::WorkspaceWindowState(std::sync::Mutex::new(
            false,
        )))
        .invoke_handler(tauri::generate_handler![
            host::commands::viewer_status,
            host::commands::viewer_version,
            host::commands::viewer_window_chrome,
            host::commands::viewer_window_action,
            host::commands::viewer_show_result,
            host::commands::viewer_close_result,
            host::commands::viewer_sign_in,
            host::commands::viewer_sign_out,
            host::commands::viewer_try_browser_sign_in,
            host::commands::viewer_organizations,
            host::commands::viewer_select_organization,
            host::commands::viewer_file_access,
            host::commands::viewer_inspect_startup_file,
            host::commands::viewer_open_startup_file,
            host::commands::viewer_open_startup_file_from_reveal,
            host::commands::viewer_guest_preflight,
            host::commands::viewer_open_startup_file_in_guest,
            host::guest_session::viewer_close_guest_session,
            host::commands::viewer_cancel_opening,
            host::commands::viewer_render_pdf_page,
            host::commands::viewer_close_pdf_session,
            #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
            host::guest_session::workspace_test_open_pdf,
            #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
            host::guest_session::workspace_test_close_guest
        ]);
    builder
        .build(tauri::generate_context!())
        .expect("could not open Inheriti Workspace")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = &event
            {
                if label == "main" && app.state::<host::HostState>().close_guest().is_err() {
                    api.prevent_close();
                    let _ = app.emit("workspace-close-failed", ());
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if app.state::<host::HostState>().close_guest().is_err() {
                    api.prevent_exit();
                    let _ = app.emit("workspace-close-failed", ());
                }
            }
            if let tauri::RunEvent::Exit = event {
                let _ = app.state::<host::HostState>().close_guest();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                if matches!(host::opened_file(app, urls), Ok(true)) {
                    let _ = app.emit("viewer-startup-file", ());
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
#[path = "../../tests/preview-unit/app_identity_tests.rs"]
mod app_identity_tests;
