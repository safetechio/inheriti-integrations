//! Opening, bounded preview decoding, and short-lived PDF preview sessions.

use super::super::{
    bridge::{invoke, HostState},
    platform,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
#[cfg(target_os = "linux")]
use std::{
    io::Read,
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenedFile {
    pub(crate) mime_type: String,
    pub(crate) content_base64: String,
    pub(crate) expires_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    text: Option<String>,
    image: Option<PreviewImage>,
    pdf: Option<PreviewPdf>,
    expires_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewImage {
    width: u32,
    height: u32,
    rgba_base64: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewPdf {
    session_id: String,
    page_count: u32,
    page: PreviewImage,
}

pub(crate) fn decode_preview(opened: &OpenedFile) -> Result<Vec<u8>, String> {
    let max = match opened.mime_type.as_str() {
        "text/plain" => inheriti_workspace::MAX_INPUT_BYTES,
        "image/webp" => inheriti_workspace::MAX_WEBP_INPUT_BYTES,
        "application/pdf" => 1024 * 1024,
        _ => return Err("unsupported preview input".into()),
    };
    if opened.content_base64.len() > (max + 2) / 3 * 4 {
        return Err("unsupported preview input".into());
    }
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(&opened.content_base64)
        .map_err(|_| "invalid host response")?;
    if bytes.is_empty() || bytes.len() > max {
        bytes.fill(0);
        return Err("unsupported preview input".into());
    }
    Ok(bytes)
}

#[cfg(target_os = "linux")]
pub(crate) fn pdf_expiration(expiration: Option<&str>) -> Result<(Duration, String), String> {
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};
    let now = OffsetDateTime::now_utc();
    let session_end = now + time::Duration::minutes(5);
    let until = match expiration {
        Some(value) => OffsetDateTime::parse(value, &Rfc3339)
            .map_err(|_| "invalid file expiration")?
            .min(session_end),
        None => session_end,
    };
    let remaining = until - now;
    if !remaining.is_positive() {
        return Err("file expired".into());
    }
    Ok((
        remaining
            .try_into()
            .map_err(|_| "invalid file expiration")?,
        until
            .format(&Rfc3339)
            .map_err(|_| "invalid file expiration")?,
    ))
}

#[tauri::command]
pub async fn viewer_open_startup_file(app: tauri::AppHandle) -> Result<Preview, String> {
    open_startup_file(app, "openStartupFile").await
}

#[tauri::command]
pub async fn viewer_open_startup_file_from_reveal(
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    open_startup_file(app, "openStartupFileFromReveal").await
}

async fn open_startup_file(
    app: tauri::AppHandle,
    operation: &'static str,
) -> Result<Preview, String> {
    let state = app.state::<HostState>();
    let child = state.child.lock().map_err(|_| "host unavailable")?;
    if state.opening_active.swap(true, Ordering::AcqRel) {
        return Err("opening_in_progress".into());
    }
    drop(child);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<HostState>();
        let result = (|| {
            state
                .startup_file
                .lock()
                .map_err(|_| "host unavailable")?
                .as_ref()
                .map_err(Clone::clone)?
                .as_ref()
                .ok_or("no_startup_file")?;
            #[cfg(target_os = "linux")]
            state.pdf.lock().map_err(|_| "host unavailable")?.take();
            platform::ensure_preview_available()?;
            let opened: OpenedFile = invoke(&app, &state, operation, None, None)?;
            let mut bytes = decode_preview(&opened)?;
            #[cfg(target_os = "linux")]
            if opened.mime_type == "application/pdf" {
                let raster = platform::preview_pdf(&bytes, 1, 1200);
                let (page_count, width, height, rgba) = match raster {
                    Ok(value) => value,
                    Err(error) => {
                        bytes.fill(0);
                        return Err(error);
                    }
                };
                let mut random = [0_u8; 16];
                if std::fs::File::open("/dev/urandom")
                    .and_then(|mut file| file.read_exact(&mut random))
                    .is_err()
                {
                    bytes.fill(0);
                    return Err("session unavailable".into());
                }
                let session_id = random
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                let (ttl, effective_expiration) = match pdf_expiration(opened.expires_at.as_deref())
                {
                    Ok(value) => value,
                    Err(error) => {
                        bytes.fill(0);
                        return Err(error);
                    }
                };
                let page = PreviewImage {
                    width,
                    height,
                    rgba_base64: base64::engine::general_purpose::STANDARD.encode(rgba),
                };
                let session = super::super::bridge::PdfSession {
                    id: session_id.clone(),
                    bytes,
                    page_count,
                    deadline: Instant::now() + ttl,
                };
                *state.pdf.lock().map_err(|_| "host unavailable")? = Some(session);
                let timer_app = app.clone();
                let timer_id = session_id.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(ttl);
                    let state = timer_app.state::<HostState>();
                    if let Ok(mut guard) = state.pdf.lock() {
                        if guard.as_ref().is_some_and(|session| session.id == timer_id) {
                            guard.take();
                        }
                    };
                });
                return Ok(Preview {
                    text: None,
                    image: None,
                    pdf: Some(PreviewPdf {
                        session_id,
                        page_count,
                        page,
                    }),
                    expires_at: Some(effective_expiration),
                });
            }
            let preview = match opened.mime_type.as_str() {
                "text/plain" => {
                    platform::preview_text(&bytes, &opened.mime_type).map(|text| (Some(text), None))
                }
                "image/webp" => {
                    #[cfg(target_os = "linux")]
                    {
                        platform::preview_webp(&bytes).map(|(width, height, rgba)| {
                            (
                                None,
                                Some(PreviewImage {
                                    width,
                                    height,
                                    rgba_base64: base64::engine::general_purpose::STANDARD
                                        .encode(rgba),
                                }),
                            )
                        })
                    }
                    #[cfg(not(target_os = "linux"))]
                    {
                        Err("isolated WebP preview unavailable on this platform".into())
                    }
                }
                _ => Err("unsupported preview input".into()),
            };
            bytes.fill(0);
            let (text, image) = preview?;
            Ok(Preview {
                text,
                image,
                pdf: None,
                expires_at: opened.expires_at,
            })
        })();
        state.opening_active.store(false, Ordering::Release);
        result
    })
    .await
    .map_err(|_| "preview task failed".to_owned())?
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn viewer_render_pdf_page(
    app: tauri::AppHandle,
    session_id: String,
    page: u32,
    fit_px: u32,
) -> Result<PreviewImage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<HostState>();
        let mut guard = state.pdf.lock().map_err(|_| "session unavailable")?;
        if guard
            .as_ref()
            .is_some_and(|session| Instant::now() >= session.deadline)
        {
            guard.take();
        }
        let session = guard.as_ref().ok_or("session unavailable")?;
        if session.id != session_id
            || page == 0
            || page > session.page_count
            || !(1..=1600).contains(&fit_px)
        {
            return Err("invalid PDF page".into());
        }
        let (_, width, height, rgba) = platform::preview_pdf(&session.bytes, page, fit_px)?;
        Ok(PreviewImage {
            width,
            height,
            rgba_base64: base64::engine::general_purpose::STANDARD.encode(rgba),
        })
    })
    .await
    .map_err(|_| "preview task failed".to_owned())?
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn viewer_close_pdf_session(
    state: tauri::State<'_, HostState>,
    session_id: String,
) -> Result<(), String> {
    let mut guard = state.pdf.lock().map_err(|_| "session unavailable")?;
    if guard
        .as_ref()
        .is_some_and(|session| session.id == session_id)
    {
        guard.take();
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn viewer_render_pdf_page(
    _session_id: String,
    _page: u32,
    _fit_px: u32,
) -> Result<PreviewImage, String> {
    Err("isolated PDF preview unavailable on this platform".into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn viewer_close_pdf_session(_session_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn viewer_cancel_opening(state: tauri::State<'_, HostState>) {
    if state.opening_active.load(Ordering::Acquire) {
        platform::cancel_child(state.child_pid.load(Ordering::Acquire));
    }
}
