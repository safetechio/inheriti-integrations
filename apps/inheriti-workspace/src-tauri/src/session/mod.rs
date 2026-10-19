//! Session lifecycle and admission policy for disposable files.
//!
//! This layer owns names, byte limits, and cleanup state. It talks only to
//! [`GuestRuntime`]; guest processes and preview helpers live in `isolation`.

mod policy;
pub(crate) use policy::safe_basename;
pub use policy::{MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES};

pub trait GuestRuntime {
    type Error;

    // Adapters must keep ingress inside the guest and make teardown idempotent and retryable.
    // Drop is only best effort: real adapters also need OS-level kill-on-parent-death
    // and a recovery sweep for orphaned guests after a crash or failed teardown.
    fn start(&mut self) -> Result<(), Self::Error>;
    fn ingress(&mut self, name: &str, bytes: &[u8]) -> Result<(), Self::Error>;
    fn launch(&mut self, name: &str) -> Result<(), Self::Error>;
    fn teardown(&mut self) -> Result<(), Self::Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkspaceError<E> {
    InvalidFile,
    AlreadyOpen,
    NotOpen,
    CleanupPending,
    DuplicateFile,
    FileLimitReached,
    AggregateTooLarge,
    Runtime(E),
    Cleanup { operation: E, cleanup: E },
}

pub struct Workspace<R: GuestRuntime> {
    pub(crate) runtime: R,
    pub(crate) active: bool,
    pub(crate) cleanup_pending: bool,
    names: Vec<String>,
    total_bytes: usize,
}

impl<R: GuestRuntime> Workspace<R> {
    pub fn new(runtime: R) -> Self {
        Self {
            runtime,
            active: false,
            cleanup_pending: false,
            names: Vec::new(),
            total_bytes: 0,
        }
    }

    pub fn open(&mut self, name: &str, bytes: &[u8]) -> Result<(), WorkspaceError<R::Error>> {
        if self.active {
            return Err(WorkspaceError::AlreadyOpen);
        }
        if !safe_basename(name) || bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
            return Err(WorkspaceError::InvalidFile);
        }

        // A failed start may have allocated guest resources; always attempt teardown.
        self.active = true;
        let operation = self
            .runtime
            .start()
            .and_then(|_| self.runtime.ingress(name, bytes))
            .and_then(|_| self.runtime.launch(name));
        if let Err(operation) = operation {
            self.cleanup_pending = true;
            return match self.close() {
                Ok(()) => Err(WorkspaceError::Runtime(operation)),
                Err(WorkspaceError::Runtime(cleanup)) => {
                    Err(WorkspaceError::Cleanup { operation, cleanup })
                }
                Err(_) => unreachable!(),
            };
        }
        self.record(name, bytes.len());
        Ok(())
    }

    pub fn admit(&mut self, name: &str, bytes: &[u8]) -> Result<(), WorkspaceError<R::Error>> {
        self.preflight_admission(name)?;
        self.validate_payload(bytes.len())?;

        let operation = self
            .runtime
            .ingress(name, bytes)
            .and_then(|_| self.runtime.launch(name));
        if let Err(operation) = operation {
            self.cleanup_pending = true;
            return match self.close() {
                Ok(()) => Err(WorkspaceError::Runtime(operation)),
                Err(WorkspaceError::Runtime(cleanup)) => {
                    Err(WorkspaceError::Cleanup { operation, cleanup })
                }
                Err(_) => unreachable!(),
            };
        }
        self.record(name, bytes.len());
        Ok(())
    }

    pub(crate) fn preflight_admission(&self, name: &str) -> Result<(), WorkspaceError<R::Error>> {
        if !self.active {
            return Err(WorkspaceError::NotOpen);
        }
        if self.cleanup_pending {
            return Err(WorkspaceError::CleanupPending);
        }
        if !safe_basename(name) {
            return Err(WorkspaceError::InvalidFile);
        }
        if self
            .names
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(name))
        {
            return Err(WorkspaceError::DuplicateFile);
        }
        if self.names.len() >= MAX_FILES {
            return Err(WorkspaceError::FileLimitReached);
        }
        Ok(())
    }

    pub(crate) fn validate_payload(
        &self,
        byte_count: usize,
    ) -> Result<(), WorkspaceError<R::Error>> {
        if byte_count == 0 || byte_count > MAX_FILE_BYTES {
            return Err(WorkspaceError::InvalidFile);
        }
        if byte_count > MAX_TOTAL_BYTES.saturating_sub(self.total_bytes) {
            return Err(WorkspaceError::AggregateTooLarge);
        }
        Ok(())
    }

    pub(crate) fn record(&mut self, name: &str, byte_count: usize) {
        self.names.push(name.to_owned());
        self.total_bytes += byte_count;
    }

    pub fn close(&mut self) -> Result<(), WorkspaceError<R::Error>> {
        if self.active {
            self.cleanup_pending = true;
            self.runtime.teardown().map_err(WorkspaceError::Runtime)?;
            self.active = false;
            self.cleanup_pending = false;
            self.names.clear();
            self.total_bytes = 0;
        }
        Ok(())
    }
}

impl<R: GuestRuntime> Drop for Workspace<R> {
    fn drop(&mut self) {
        // Failure cannot be reported here; the adapter's OS-level fallback owns cleanup.
        let _ = self.close();
    }
}

#[cfg(test)]
#[path = "../../../tests/workspace-unit/workspace_tests.rs"]
mod tests;
