use super::{
    platform,
    protocol::{HostRequest, HostResponse},
    startup_file::StartupFile,
};
use serde::Deserialize;
use std::{
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI32, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const MAX_REQUEST: usize = 8192;

pub(super) fn pairing_code<'a>(
    value: &'a serde_json::Value,
    op: &str,
) -> Result<Option<&'a str>, String> {
    if value.get("event").is_none() {
        return Ok(None);
    }
    let object = value.as_object().ok_or("invalid host response")?;
    let code = value
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or("invalid host response")?;
    if op != "openStartupFileFromReveal" && op != "openStartupFileFromRevealInGuest"
        || object.len() != 3
        || value.get("id").and_then(|v| v.as_str()) != Some("viewer")
        || value.get("event").and_then(|v| v.as_str()) != Some("pairingCode")
        || code.len() != 12
        || !code.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("invalid host response".into());
    }
    Ok(Some(code))
}

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

pub struct HostState {
    pub(super) guest: super::guest_session::GuestSession,
    pub(super) child: Mutex<Option<Child>>,
    pub(super) child_pid: AtomicI32,
    pub(super) opening_active: AtomicBool,
    pub(super) resetting: AtomicBool,
    pub(super) reset_active: AtomicBool,
    pub(super) cancel_requested: Arc<AtomicBool>,
    pub(super) opening_gate: Mutex<()>,
    pub(super) startup_file: Mutex<Result<Option<StartupFile>, String>>,
    #[cfg(target_os = "linux")]
    pub(super) pdf: Mutex<Option<PdfSession>>,
}
#[cfg(target_os = "linux")]
pub(super) struct PdfSession {
    pub(super) id: String,
    pub(super) bytes: Vec<u8>,
    pub(super) page_count: u32,
    pub(super) deadline: Instant,
}
#[cfg(target_os = "linux")]
impl Drop for PdfSession {
    fn drop(&mut self) {
        self.bytes.fill(0);
    }
}
impl HostState {
    pub fn new() -> Self {
        Self {
            guest: super::guest_session::GuestSession::new(),
            child: Mutex::new(None),
            child_pid: AtomicI32::new(0),
            opening_active: AtomicBool::new(false),
            resetting: AtomicBool::new(false),
            reset_active: AtomicBool::new(false),
            cancel_requested: Arc::new(AtomicBool::new(false)),
            opening_gate: Mutex::new(()),
            startup_file: Mutex::new(StartupFile::from_args(std::env::args_os().skip(1))),
            #[cfg(target_os = "linux")]
            pdf: Mutex::new(None),
        }
    }

    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    pub(crate) fn open_test_pdf(&self) -> Result<(), String> {
        self.guest.open_test_pdf()
    }

    pub(crate) fn close_guest(&self) -> Result<(), String> {
        self.guest.shutdown()
    }

    pub(super) fn cancel_host_process(&self) {
        self.cancel_requested.store(true, Ordering::Release);
        let gate = match self.opening_gate.try_lock() {
            Ok(gate) => gate,
            Err(std::sync::TryLockError::WouldBlock) => {
                platform::cancel_child(self.child_pid.load(Ordering::Acquire));
                match self.opening_gate.lock() {
                    Ok(gate) => gate,
                    Err(_) => return,
                }
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                platform::cancel_child(self.child_pid.load(Ordering::Acquire));
                return;
            }
        };
        self.cancel_requested.store(true, Ordering::Release);
        platform::cancel_child(self.child_pid.load(Ordering::Acquire));
        drop(gate);
    }

    pub(super) fn opened_file(&self, path: PathBuf) -> Result<bool, String> {
        let file = StartupFile::from_path(path)?;
        let mut child = self.child.lock().map_err(|_| "host unavailable")?;
        if self.resetting.load(Ordering::Acquire) || self.opening_active.load(Ordering::Acquire) {
            return Err("opening_in_progress".into());
        }
        let mut current = self.startup_file.lock().map_err(|_| "host unavailable")?;
        if matches!(&*current, Ok(Some(existing)) if existing.as_path() == file.as_path()) {
            return Ok(false);
        }
        if let Some(mut running) = child.take() {
            let _ = running.kill();
            let _ = running.wait();
            self.child_pid.store(0, Ordering::Release);
        }
        *current = Ok(Some(file));
        #[cfg(target_os = "linux")]
        {
            self.pdf.lock().map_err(|_| "host unavailable")?.take();
        }
        if self.resetting.load(Ordering::Acquire) {
            return Err("opening_in_progress".into());
        }
        Ok(true)
    }
}
impl Drop for HostState {
    fn drop(&mut self) {
        let _ = self.guest.shutdown();
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let dev = std::env::current_exe()
            .map_err(|_| "host unavailable")?
            .with_file_name("workspace-host");
        if dev.join(node_binary_name()).is_file() && dev.join("host.cjs").is_file() {
            return Ok(dev);
        }
    }
    app.path()
        .resource_dir()
        .map_err(|_| "host unavailable".into())
}

pub(super) fn invoke<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    state: &HostState,
    op: &str,
    organization_id: Option<&str>,
    copy_id: Option<&str>,
) -> Result<T, String> {
    invoke_inner(
        app,
        state,
        op,
        organization_id,
        copy_id,
        Some(&state.cancel_requested),
    )
}

pub(super) fn invoke_cancelable<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    state: &HostState,
    op: &str,
) -> Result<T, String> {
    invoke_inner(app, state, op, None, None, Some(&state.cancel_requested))
}

fn lock_child<'a>(
    state: &'a HostState,
    cancel: Option<&AtomicBool>,
) -> Result<MutexGuard<'a, Option<Child>>, String> {
    let mut guard = state.child.lock().map_err(|_| "host unavailable")?;
    if let Err(error) = check_cancel(cancel) {
        discard_child(state, &mut guard);
        return Err(error);
    }
    Ok(guard)
}

fn discard_child(state: &HostState, guard: &mut Option<Child>) {
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        state.child_pid.store(0, Ordering::Release);
    }
}

fn check_cancel(cancel: Option<&AtomicBool>) -> Result<(), String> {
    if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
        Err("opening_cancelled".into())
    } else {
        Ok(())
    }
}

fn must_restart_host(error: &str) -> bool {
    matches!(
        error,
        "host unavailable"
            | "host timed out"
            | "host response too large"
            | "invalid host response"
            | "opening_cancelled"
    )
}

fn invoke_inner<T: for<'de> Deserialize<'de>>(
    app: &tauri::AppHandle,
    state: &HostState,
    op: &str,
    organization_id: Option<&str>,
    copy_id: Option<&str>,
    cancel: Option<&AtomicBool>,
) -> Result<T, String> {
    let mut guard = lock_child(state, cancel)?;
    if guard.is_none() {
        let runtime = runtime_dir(app)?;
        let node = runtime.join(node_binary_name());
        let host = runtime.join("host.cjs");
        if !node.is_file() || !host.is_file() {
            return Err("host unavailable".into());
        }
        let mut command = Command::new(node);
        command.arg(host).arg(env!("INHERITI_WORKSPACE_DEPLOYMENT"));
        let startup_file = state.startup_file.lock().map_err(|_| "host unavailable")?;
        if let Ok(Some(path)) = &*startup_file {
            command.arg(path.as_path());
        }
        let child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "host unavailable")?;
        state.child_pid.store(child.id() as i32, Ordering::Release);
        *guard = Some(child);
    }
    let child = guard.as_mut().ok_or("host unavailable")?;
    let request = HostRequest {
        id: "viewer",
        op,
        organization_id,
        copy_id,
    };
    let mut bytes = serde_json::to_vec(&request).map_err(|_| "invalid request")?;
    bytes.push(b'\n');
    if bytes.len() > MAX_REQUEST {
        return Err("invalid request".into());
    }
    let outcome: Result<T, String> = (|| {
        {
            let _opening = state.opening_gate.lock().map_err(|_| "host unavailable")?;
            check_cancel(cancel)?;
            child
                .stdin
                .as_mut()
                .ok_or("host unavailable")?
                .write_all(&bytes)
                .map_err(|_| "host unavailable")?;
        }
        let stdout = child.stdout.as_mut().ok_or("host unavailable")?;
        let deadline = Instant::now()
            + if op == "tryBrowserSignIn" {
                Duration::from_secs(35)
            } else if op == "signIn"
                || op == "openStartupFile"
                || op == "openStartupFileFromReveal"
                || op == "openStartupFileInGuest"
                || op == "openStartupFileFromRevealInGuest"
            {
                Duration::from_secs(310)
            } else {
                Duration::from_secs(15)
            };
        let response: HostResponse<T> = loop {
            let mut line = platform::read_host_line(stdout, deadline)?;
            if check_cancel(cancel).is_err() {
                line.fill(0);
                return Err("opening_cancelled".into());
            }
            let value: serde_json::Value =
                serde_json::from_slice(&line).map_err(|_| "invalid host response")?;
            if let Some(code) = pairing_code(&value, op)? {
                app.emit("viewer-pairing-code", code)
                    .map_err(|_| "host unavailable")?;
                continue;
            }
            break serde_json::from_value(value).map_err(|_| "invalid host response")?;
        };
        if response.id != "viewer" {
            return Err("invalid host response".into());
        }
        check_cancel(cancel)?;
        if !response.ok {
            return Err(match response.code.as_deref() {
                Some("sign_in_required") => "sign_in_required",
                Some("organization_required") => "organization_required",
                Some("organization_access_denied") => "organization_access_denied",
                Some("invalid_copy_id") => "invalid_copy_id",
                Some("invalid_startup_file") => "invalid_startup_file",
                Some("file_binding_mismatch") => "file_binding_mismatch",
                Some("reveal_delivery_unavailable") => "reveal_delivery_unavailable",
                _ => "host request failed",
            }
            .into());
        }
        let result = response
            .result
            .ok_or_else(|| "invalid host response".to_owned())?;
        check_cancel(cancel)?;
        Ok(result)
    })();
    if matches!(&outcome, Err(error) if must_restart_host(error)) {
        discard_child(state, &mut guard);
    }
    outcome
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    use std::sync::{mpsc, Arc};

    #[test]
    fn cancellation_waiting_for_sidecar_lock_never_writes_request() {
        let state = Arc::new(HostState::new());
        let child = state.child.lock().unwrap();
        let (ready, waiting) = mpsc::channel();
        let pending = state.clone();
        let thread = std::thread::spawn(move || {
            ready.send(()).unwrap();
            lock_child(&pending, Some(&pending.cancel_requested)).map(|_| ())
        });
        waiting.recv().unwrap();
        state.cancel_requested.store(true, Ordering::Release);
        drop(child);
        assert_eq!(thread.join().unwrap(), Err("opening_cancelled".into()));
    }

    #[test]
    fn cancelled_response_discards_sidecar_before_retry() {
        assert!(must_restart_host("opening_cancelled"));
        assert!(!must_restart_host("organization_required"));
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_terminates_non_opening_host_process() {
        let state = HostState::new();
        let mut process = Command::new("sleep").arg("30").spawn().unwrap();
        state
            .child_pid
            .store(process.id() as i32, Ordering::Release);
        state.cancel_host_process();
        assert!(state.cancel_requested.load(Ordering::Acquire));
        assert!(!process.wait().unwrap().success());
    }

    #[test]
    fn cancellation_cannot_be_cleared_by_opening_while_gate_is_held() {
        let state = Arc::new(HostState::new());
        let gate = state.opening_gate.lock().unwrap();
        let pending = state.clone();
        let thread = std::thread::spawn(move || pending.cancel_host_process());
        let deadline = Instant::now() + Duration::from_secs(2);
        while !state.cancel_requested.load(Ordering::Acquire) {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        state.cancel_requested.store(false, Ordering::Release);
        drop(gate);
        thread.join().unwrap();
        assert!(state.cancel_requested.load(Ordering::Acquire));
    }
}
