//! Tauri ownership of the disposable graphical guest session.

use inheriti_workspace::access::handoff::HandoffError;
#[cfg(all(feature = "workspace-test-harness", debug_assertions))]
use inheriti_workspace::isolation::guest::{
    platform::prepare_runtime_with_display, qemu_spec::DisplayMode,
};
#[cfg(all(feature = "workspace-test-harness", debug_assertions))]
use inheriti_workspace::session::WorkspaceError;
use inheriti_workspace::{
    isolation::guest::platform::PlatformRuntime,
    session::{GuestRuntime, Workspace},
};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
    thread::{self, JoinHandle},
};

type Reply = mpsc::Sender<Result<(), String>>;

enum Request {
    Open {
        runtime: PlatformRuntime,
        name: &'static str,
        authorize: Box<dyn FnOnce() -> Result<Vec<u8>, String> + Send>,
        reply: Reply,
    },
    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    OpenTestPdf(Reply),
    Close(Reply),
    Shutdown(Reply),
}

struct Worker {
    sender: mpsc::Sender<Request>,
    thread: JoinHandle<()>,
}

pub(super) struct GuestSession {
    worker: Mutex<Option<Worker>>,
    generation: AtomicU64,
}

impl GuestSession {
    pub(super) fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("workspace-guest-owner".into())
            .spawn(move || run_guest_owner(receiver))
            .ok()
            .map(|thread| Worker { sender, thread });
        Self {
            worker: Mutex::new(thread),
            generation: AtomicU64::new(0),
        }
    }

    fn request(&self, make_request: impl FnOnce(Reply) -> Request) -> Result<(), String> {
        let guard = self.worker.lock().map_err(|_| "workspace unavailable")?;
        let worker = guard.as_ref().ok_or("workspace unavailable")?;
        let (reply, response) = mpsc::channel();
        worker
            .sender
            .send(make_request(reply))
            .map_err(|_| "workspace unavailable")?;
        let result = response.recv().map_err(|_| "workspace unavailable")?;
        if result.is_ok() {
            self.generation.fetch_add(1, Ordering::AcqRel);
        }
        result
    }

    pub(super) fn close(&self) -> Result<(), String> {
        self.request(Request::Close)
    }

    pub(super) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub(super) fn close_if_current(&self, generation: u64) -> Result<(), String> {
        let guard = self.worker.lock().map_err(|_| "workspace unavailable")?;
        if self.generation.load(Ordering::Acquire) != generation {
            return Ok(());
        }
        let worker = guard.as_ref().ok_or("workspace unavailable")?;
        let (reply, response) = mpsc::channel();
        worker
            .sender
            .send(Request::Close(reply))
            .map_err(|_| "workspace unavailable")?;
        response.recv().map_err(|_| "workspace unavailable")??;
        self.generation.fetch_add(1, Ordering::AcqRel);
        Ok(())
    }

    pub(super) fn open(
        &self,
        runtime: PlatformRuntime,
        name: &'static str,
        authorize: impl FnOnce() -> Result<Vec<u8>, String> + Send + 'static,
    ) -> Result<(), String> {
        self.request(|reply| Request::Open {
            runtime,
            name,
            authorize: Box::new(authorize),
            reply,
        })
    }

    /// Called when Tauri exits. The owner thread stays alive after a failed cleanup.
    pub(super) fn shutdown(&self) -> Result<(), String> {
        let mut worker = self.worker.lock().map_err(|_| "workspace unavailable")?;
        let Some(current) = worker.as_ref() else {
            return Ok(());
        };
        let (reply, response) = mpsc::channel();
        current
            .sender
            .send(Request::Shutdown(reply))
            .map_err(|_| "workspace unavailable")?;
        response.recv().map_err(|_| "workspace unavailable")??;
        let current = worker.take().ok_or("workspace unavailable")?;
        current
            .thread
            .join()
            .map_err(|_| "workspace unavailable".into())
    }

    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    pub(super) fn open_test_pdf(&self) -> Result<(), String> {
        self.request(Request::OpenTestPdf)
    }
}

impl Drop for GuestSession {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn run_guest_owner(receiver: mpsc::Receiver<Request>) {
    let mut session: Option<Workspace<PlatformRuntime>> = None;
    for request in receiver {
        match request {
            Request::Open {
                runtime,
                name,
                authorize,
                reply,
            } => {
                let _ = reply.send(open_authorized_session(
                    &mut session,
                    runtime,
                    name,
                    authorize,
                ));
            }
            #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
            Request::OpenTestPdf(reply) => {
                let _ = reply.send(open_test_pdf(&mut session));
            }
            Request::Close(reply) => {
                let _ = reply.send(close_session(&mut session));
            }
            Request::Shutdown(reply) => {
                let result = close_session(&mut session);
                let done = result.is_ok();
                let _ = reply.send(result);
                if done {
                    break;
                }
            }
        }
    }
}

fn open_authorized_session<R: GuestRuntime>(
    session: &mut Option<Workspace<R>>,
    runtime: R,
    name: &str,
    authorize: impl FnOnce() -> Result<Vec<u8>, String>,
) -> Result<(), String> {
    if session.is_some() {
        return Err("workspace already open".into());
    }
    let mut current = Workspace::new(runtime);
    match current.open_authorized(name, authorize) {
        Ok(()) => {
            *session = Some(current);
            Ok(())
        }
        Err(HandoffError::Cleanup { .. }) => {
            *session = Some(current);
            Err("workspace cleanup pending".into())
        }
        Err(HandoffError::Failure(
            inheriti_workspace::access::handoff::HandoffFailure::Authorization(error),
        )) => Err(error),
        Err(_) => Err("workspace open failed".into()),
    }
}

#[tauri::command]
pub(crate) fn viewer_close_guest_session(
    state: tauri::State<'_, super::HostState>,
) -> Result<(), String> {
    state.guest.close()
}

fn close_session<R: GuestRuntime>(session: &mut Option<Workspace<R>>) -> Result<(), String> {
    if let Some(current) = session.as_mut() {
        current.close().map_err(|_| "workspace close failed")?;
        session.take();
    }
    Ok(())
}

#[cfg(all(feature = "workspace-test-harness", debug_assertions))]
fn open_test_pdf(session: &mut Option<Workspace<PlatformRuntime>>) -> Result<(), String> {
    use std::path::PathBuf;

    const PDF: &[u8] = include_bytes!("../../../tests/vm/fixture-two-pages.pdf");
    if session.is_some() {
        return Err("workspace already open".into());
    }
    let resource_dir = std::env::var_os("INHERITI_WORKSPACE_TEST_VM_DIR")
        .map(PathBuf::from)
        .ok_or("workspace VM resources unavailable")?;
    let runtime = prepare_runtime_with_display(&resource_dir, 384, DisplayMode::GraphicalSdl)
        .map_err(|_| "workspace VM resources unavailable")?;
    let mut current = Workspace::new(runtime);
    match current.open("fixture-two-pages.pdf", PDF) {
        Ok(()) => {
            *session = Some(current);
            Ok(())
        }
        Err(WorkspaceError::Cleanup { .. }) => {
            *session = Some(current);
            Err("workspace cleanup pending".into())
        }
        Err(_) => Err("workspace open failed".into()),
    }
}

#[cfg(all(feature = "workspace-test-harness", debug_assertions))]
#[tauri::command]
pub(crate) fn workspace_test_open_pdf(
    state: tauri::State<'_, super::HostState>,
) -> Result<(), String> {
    state.guest.open_test_pdf()
}

#[cfg(all(feature = "workspace-test-harness", debug_assertions))]
#[tauri::command]
pub(crate) fn workspace_test_close_guest(
    state: tauri::State<'_, super::HostState>,
) -> Result<(), String> {
    state.guest.close()
}

#[cfg(test)]
#[path = "../../../tests/workspace-unit/guest_session_tests.rs"]
mod tests;
