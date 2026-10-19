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
        Mutex,
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
    if op != "openStartupFileFromReveal"
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

    pub(super) fn opened_file(&self, path: PathBuf) -> Result<bool, String> {
        let file = StartupFile::from_path(path)?;
        let mut child = self.child.lock().map_err(|_| "host unavailable")?;
        if self.opening_active.load(Ordering::Acquire) {
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
    let mut guard = state.child.lock().map_err(|_| "host unavailable")?;
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
    let outcome = (|| {
        child
            .stdin
            .as_mut()
            .ok_or("host unavailable")?
            .write_all(&bytes)
            .map_err(|_| "host unavailable")?;
        let stdout = child.stdout.as_mut().ok_or("host unavailable")?;
        let deadline = Instant::now()
            + if op == "tryBrowserSignIn" {
                Duration::from_secs(35)
            } else if op == "signIn" || op == "openStartupFile" || op == "openStartupFileFromReveal"
            {
                Duration::from_secs(310)
            } else {
                Duration::from_secs(15)
            };
        let response: HostResponse<T> = loop {
            let line = platform::read_host_line(stdout, deadline)?;
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
        response
            .result
            .ok_or_else(|| "invalid host response".into())
    })();
    if matches!(&outcome, Err(error) if error == "host unavailable" || error == "host timed out" || error == "host response too large" || error == "invalid host response")
    {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            state.child_pid.store(0, Ordering::Release);
        }
    }
    outcome
}
