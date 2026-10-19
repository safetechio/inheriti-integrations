//! Tauri ownership of the disposable graphical guest session.

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
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
};

type Reply = mpsc::Sender<Result<(), String>>;

enum Request {
    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    OpenTestPdf(Reply),
    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    Close(Reply),
    Shutdown(Reply),
}

struct Worker {
    sender: mpsc::Sender<Request>,
    thread: JoinHandle<()>,
}

pub(super) struct GuestSession(Mutex<Option<Worker>>);

impl GuestSession {
    pub(super) fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("workspace-guest-owner".into())
            .spawn(move || run_guest_owner(receiver))
            .ok()
            .map(|thread| Worker { sender, thread });
        Self(Mutex::new(thread))
    }

    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    fn request(&self, make_request: impl FnOnce(Reply) -> Request) -> Result<(), String> {
        let guard = self.0.lock().map_err(|_| "workspace unavailable")?;
        let worker = guard.as_ref().ok_or("workspace unavailable")?;
        let (reply, response) = mpsc::channel();
        worker
            .sender
            .send(make_request(reply))
            .map_err(|_| "workspace unavailable")?;
        response.recv().map_err(|_| "workspace unavailable")?
    }

    #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
    pub(super) fn close(&self) -> Result<(), String> {
        self.request(Request::Close)
    }

    /// Called when Tauri exits. The owner thread stays alive after a failed cleanup.
    pub(super) fn shutdown(&self) -> Result<(), String> {
        let mut worker = self.0.lock().map_err(|_| "workspace unavailable")?;
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
            #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
            Request::OpenTestPdf(reply) => {
                let _ = reply.send(open_test_pdf(&mut session));
            }
            #[cfg(all(feature = "workspace-test-harness", debug_assertions))]
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
