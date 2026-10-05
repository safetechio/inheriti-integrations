use std::io::{self, BufRead};
use std::sync::{Arc, Mutex};
use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{Manager, WebviewUrl};
use url::Url;

fn local_page(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    let path = url.path().strip_prefix('/')?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || path.len() != 48
        || !path.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(url)
}

fn main() {
    let allowed = Arc::new(Mutex::new(Vec::<Url>::new()));
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let allowed = allowed.clone();
            std::thread::spawn(move || {
                let mut hold = false;
                for line in io::stdin().lock().lines() {
                    let Ok(raw) = line else { break };
                    if raw == "HOLD" {
                        hold = true;
                        break;
                    }
                    let Some(url) = local_page(&raw) else { break };
                    allowed.lock().unwrap().push(url.clone());
                    let handle = handle.clone();
                    let allowed = allowed.clone();
                    let _ = handle.clone().run_on_main_thread(move || {
                        if let Some(window) = handle.get_webview_window("session") {
                            if window.navigate(url).is_err() {
                                handle.exit(1);
                            }
                            return;
                        }
                        let origins = allowed.clone();
                        let builder = WebviewWindowBuilder::new(
                            &handle,
                            "session",
                            WebviewUrl::External(url),
                        )
                        .title("Inheriti · Protected session")
                        .inner_size(780.0, 720.0)
                        .incognito(true)
                        .browser_extensions_enabled(false);
                        #[cfg(target_os = "linux")]
                        let builder = builder.initialization_script(
                            "document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('native-linux-fonts'), { once: true });",
                        );
                        let built = builder.on_new_window(|_, _| NewWindowResponse::Deny)
                        .on_navigation(move |next| {
                            origins.lock().unwrap().iter().any(|page| {
                                next.scheme() == "http"
                                    && next.host_str() == Some("127.0.0.1")
                                    && next.port() == page.port()
                                    && (next.path() == page.path()
                                        || next.path().starts_with(&format!("{}/", page.path())))
                            })
                        })
                        .build();
                        if built.is_err() {
                            handle.exit(1);
                        }
                    });
                }
                if hold {
                    std::thread::sleep(std::time::Duration::from_secs(300));
                }
                handle.exit(0);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("could not open the Inheriti window");
}

#[cfg(test)]
mod tests {
    use super::local_page;

    #[test]
    fn accepts_only_capability_pages_on_loopback() {
        let token = "a".repeat(48);
        assert!(local_page(&format!("http://127.0.0.1:3123/{token}")).is_some());
        assert!(local_page(&format!("http://localhost:3123/{token}")).is_none());
        assert!(local_page(&format!("http://127.0.0.1:3123/{token}?x=1")).is_none());
        assert!(local_page("https://example.com/").is_none());
    }
}
