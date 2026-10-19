//! Opening, bounded preview decoding, and short-lived PDF preview sessions.

use super::super::{
    bridge::{invoke, invoke_cancelable, HostState},
    platform,
};
use base64::Engine;
use inheriti_workspace::isolation::guest::{
    adapter_cache::{
        AdapterCacheProgress, AdapterDownload, AdapterDownloader, CacheError, HttpsDownloader,
    },
    platform::{
        prepare_runtime_for_document, prepare_runtime_for_spreadsheet,
        prepare_runtime_with_display, PlatformRuntime,
    },
    qemu_spec::DisplayMode,
};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

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

pub(crate) fn guest_name(mime: &str) -> Option<&'static str> {
    match mime {
        "application/pdf" => Some("document.pdf"),
        "text/plain" => Some("document.txt"),
        "text/csv" => Some("document.csv"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some("document.docx")
        }
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            Some("document.xlsx")
        }
        _ => None,
    }
}

pub(crate) fn guest_application(mime: &str) -> Option<&'static str> {
    match mime {
        "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            Some("GridCraft")
        }
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            Some("WordCraft")
        }
        _ => None,
    }
}

pub(crate) fn decode_guest(opened: &OpenedFile) -> Result<Vec<u8>, String> {
    if guest_name(&opened.mime_type).is_none() {
        return Err("unsupported guest input".into());
    }
    if guest_application(&opened.mime_type).is_none() {
        return decode_preview(opened);
    }
    const MAX_GUEST_INPUT: usize = 1024 * 1024;
    if opened.content_base64.len() > (MAX_GUEST_INPUT + 2) / 3 * 4 {
        return Err("unsupported guest input".into());
    }
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(&opened.content_base64)
        .map_err(|_| "invalid host response")?;
    if bytes.is_empty() || bytes.len() > MAX_GUEST_INPUT {
        bytes.fill(0);
        return Err("unsupported guest input".into());
    }
    Ok(bytes)
}

pub(crate) struct CancelableDownloader<'a> {
    pub(crate) inner: &'a dyn AdapterDownloader,
    pub(crate) cancelled: Arc<AtomicBool>,
}

impl AdapterDownloader for CancelableDownloader<'_> {
    fn open(&self, url: &str) -> Result<Box<dyn Read>, CacheError> {
        Ok(self.open_with_length(url)?.reader)
    }

    fn open_with_length(&self, url: &str) -> Result<AdapterDownload, CacheError> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(CacheError::Download("opening_cancelled".into()));
        }
        // shortcut: an active HTTPS read may wait for its timeout; use abortable I/O for instant cancel.
        let download = self.inner.open_with_length(url)?;
        if self.cancelled.load(Ordering::Acquire) {
            return Err(CacheError::Download("opening_cancelled".into()));
        }
        Ok(AdapterDownload {
            reader: Box::new(CancelableReader {
                inner: download.reader,
                cancelled: self.cancelled.clone(),
            }),
            total_bytes: download.total_bytes,
        })
    }
}

struct CancelableReader {
    inner: Box<dyn Read>,
    cancelled: Arc<AtomicBool>,
}

impl Read for CancelableReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "opening_cancelled",
            ));
        }
        self.inner.read(buffer)
    }
}

fn remaining_guest_time(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now())
}

fn begin_guest_opening(state: &HostState) -> Result<(), String> {
    let _gate = state.opening_gate.lock().map_err(|_| "host unavailable")?;
    if state.opening_active.swap(true, Ordering::AcqRel) {
        return Err("opening_in_progress".into());
    }
    state.cancel_requested.store(false, Ordering::Release);
    Ok(())
}

fn cancel_active_opening(state: &HostState) {
    let pid = {
        let Ok(_gate) = state.opening_gate.lock() else {
            return;
        };
        if !state.opening_active.load(Ordering::Acquire) {
            return;
        }
        state.cancel_requested.store(true, Ordering::Release);
        state.child_pid.load(Ordering::Acquire)
    };
    platform::cancel_child(pid);
}

fn guest_runtime(
    app: &tauri::AppHandle,
    mime: &str,
    opening_id: &str,
    cancelled: &Arc<AtomicBool>,
) -> Result<PlatformRuntime, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| "workspace VM resources unavailable")?;
    let vm = resources.join("workspace-vm");
    ensure_opening_not_cancelled(cancelled)?;
    let application = guest_application(mime);
    let downloader = CancelableDownloader {
        inner: &HttpsDownloader,
        cancelled: cancelled.clone(),
    };
    if let Some(application) = application {
        let _ = app.emit(
            "workspace-adapter-progress",
            serde_json::json!({
                "openingId": opening_id, "application": application, "phase": "checking",
            }),
        );
    }
    let mut progress = |event| {
        if let Some(application) = application {
            let (phase, received_bytes, total_bytes) = match event {
                AdapterCacheProgress::CacheHit => ("cache-hit", None, None),
                AdapterCacheProgress::Downloading {
                    received_bytes,
                    total_bytes,
                } => ("downloading", Some(received_bytes), total_bytes),
                AdapterCacheProgress::Verifying => ("verifying", None, None),
                AdapterCacheProgress::Complete => ("preparing", None, None),
                AdapterCacheProgress::Failed => ("failed", None, None),
            };
            let _ = app.emit(
                "workspace-adapter-progress",
                serde_json::json!({
                    "openingId": opening_id, "application": application, "phase": phase,
                    "receivedBytes": received_bytes, "totalBytes": total_bytes,
                }),
            );
        }
    };
    let runtime = match application {
        Some("WordCraft") => prepare_runtime_for_document(
            &vm,
            &app.path()
                .app_cache_dir()
                .map_err(|_| "workspace cache unavailable")?,
            &downloader,
            512,
            &mut progress,
        )
        .map_err(|_| "approved application unavailable".into()),
        Some("GridCraft") => prepare_runtime_for_spreadsheet(
            &vm,
            &app.path()
                .app_cache_dir()
                .map_err(|_| "workspace cache unavailable")?,
            None,
            &downloader,
            512,
            &mut progress,
        )
        .map_err(|_| "approved application unavailable".into()),
        _ => prepare_runtime_with_display(&vm, 384, DisplayMode::GraphicalSdl)
            .map_err(|_| "workspace VM resources unavailable".into()),
    };
    if runtime.is_err() {
        if let Some(application) = application {
            let _ = app.emit(
                "workspace-adapter-progress",
                serde_json::json!({
                    "openingId": opening_id, "application": application, "phase": "failed",
                }),
            );
        }
    }
    runtime
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestPreflight {
    supported: bool,
}

#[tauri::command]
pub async fn viewer_guest_preflight(app: tauri::AppHandle) -> Result<GuestPreflight, String> {
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
        let mime: String = invoke(&app, &state, "inspectStartupFileMime", None, None)?;
        if guest_name(&mime).is_none() {
            return Ok(GuestPreflight { supported: false });
        }
        if guest_application(&mime).is_none() {
            guest_runtime(&app, &mime, "", &Arc::new(AtomicBool::new(false)))?;
        }
        Ok(GuestPreflight { supported: true })
    })
    .await
    .map_err(|_| "preflight task failed".to_owned())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestOpen {
    expires_at: Option<String>,
}

#[tauri::command]
pub async fn viewer_open_startup_file_in_guest(
    app: tauri::AppHandle,
    from_reveal: bool,
    opening_id: String,
) -> Result<GuestOpen, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if opening_id.len() != 36
            || !opening_id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        {
            return Err("invalid opening id".into());
        }
        let state = app.state::<HostState>();
        begin_guest_opening(&state)?;
        let result = (|| {
            state
                .startup_file
                .lock()
                .map_err(|_| "host unavailable")?
                .as_ref()
                .map_err(Clone::clone)?
                .as_ref()
                .ok_or("no_startup_file")?;
            let mime: String = invoke(&app, &state, "inspectStartupFileMime", None, None)?;
            let name = guest_name(&mime).ok_or("unsupported_file_type")?;
            let runtime = guest_runtime(&app, &mime, &opening_id, &state.cancel_requested)?;
            ensure_opening_not_cancelled(&state.cancel_requested)?;
            let expiration = std::sync::Arc::new(std::sync::Mutex::new(None));
            let delivered = expiration.clone();
            let callback_app = app.clone();
            state.guest.open(runtime, name, move || {
                let callback_state = callback_app.state::<HostState>();
                ensure_opening_not_cancelled(&callback_state.cancel_requested)?;
                let opened: OpenedFile = invoke_cancelable(
                    &callback_app,
                    &callback_state,
                    if from_reveal {
                        "openStartupFileFromRevealInGuest"
                    } else {
                        "openStartupFileInGuest"
                    },
                )?;
                if opened.mime_type != mime {
                    return Err("invalid host response".into());
                }
                let mut bytes = decode_guest(&opened)?;
                if let Err(error) = ensure_opening_not_cancelled(&callback_state.cancel_requested) {
                    bytes.fill(0);
                    return Err(error);
                }
                let (ttl, effective_expiration) = match pdf_expiration(opened.expires_at.as_deref())
                {
                    Ok(value) => value,
                    Err(error) => {
                        bytes.fill(0);
                        return Err(error);
                    }
                };
                let Ok(mut guard) = delivered.lock() else {
                    bytes.fill(0);
                    return Err("workspace unavailable".into());
                };
                if let Err(error) = ensure_opening_not_cancelled(&callback_state.cancel_requested) {
                    bytes.fill(0);
                    return Err(error);
                }
                *guard = Some((Instant::now() + ttl, effective_expiration));
                Ok(bytes)
            })?;
            if state.cancel_requested.load(Ordering::Acquire) {
                state
                    .guest
                    .close()
                    .map_err(|_| "workspace cleanup pending")?;
                return Err("opening_cancelled".into());
            }
            let (deadline, expires_at) = expiration
                .lock()
                .map_err(|_| "workspace unavailable")?
                .clone()
                .ok_or("workspace unavailable")?;
            let timer_app = app.clone();
            let generation = state.guest.generation();
            let remaining = remaining_guest_time(deadline);
            if remaining.is_zero() {
                state
                    .guest
                    .close_if_current(generation)
                    .map_err(|_| "workspace cleanup pending")?;
                return Err("file expired".into());
            }
            std::thread::spawn(move || {
                std::thread::sleep(remaining_guest_time(deadline));
                let state = timer_app.state::<HostState>();
                if state.guest.close_if_current(generation).is_err() {
                    let _ = timer_app.emit("workspace-close-failed", ());
                }
            });
            Ok(GuestOpen {
                expires_at: Some(expires_at),
            })
        })();
        let finished = match state.opening_gate.lock() {
            Ok(_gate) => {
                let result = if result.is_ok() && state.cancel_requested.load(Ordering::Acquire) {
                    match state.guest.close() {
                        Ok(()) => Err("opening_cancelled".into()),
                        Err(_) => Err("workspace cleanup pending".into()),
                    }
                } else {
                    result
                };
                state.opening_active.store(false, Ordering::Release);
                result
            }
            Err(_) => {
                if result.is_ok() {
                    let _ = state.guest.close();
                }
                state.opening_active.store(false, Ordering::Release);
                Err("host unavailable".into())
            }
        };
        finished
    })
    .await
    .map_err(|_| "workspace task failed".to_owned())?
}

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
    cancel_active_opening(&state);
}

fn ensure_opening_not_cancelled(
    cancel_requested: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    if cancel_requested.load(Ordering::Acquire) {
        Err("opening_cancelled".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod guest_deadline_tests {
    use super::*;

    #[test]
    fn guest_deadline_does_not_restart_after_handoff() {
        let deadline = Instant::now() + Duration::from_millis(20);
        std::thread::sleep(Duration::from_millis(30));
        assert!(remaining_guest_time(deadline).is_zero());
    }

    #[test]
    fn cancelled_vm_startup_cannot_authorize_file() {
        let state = HostState::new();
        begin_guest_opening(&state).unwrap();
        assert!(ensure_opening_not_cancelled(&state.cancel_requested).is_ok());
        cancel_active_opening(&state);
        assert_eq!(
            ensure_opening_not_cancelled(&state.cancel_requested),
            Err("opening_cancelled".into())
        );
        assert_eq!(
            begin_guest_opening(&state),
            Err("opening_in_progress".into())
        );
        assert!(state.cancel_requested.load(Ordering::Acquire));
    }
}
