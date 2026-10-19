//! Authorized plaintext handoff into an already started isolated guest.
//!
//! The caller supplies authorization and decrypted bytes through a closure. Rust
//! does not decrypt here. This layer wipes its owned copy after guest ingress.

use crate::session::{safe_basename, GuestRuntime, Workspace, WorkspaceError, MAX_FILE_BYTES};
use std::sync::atomic::{compiler_fence, Ordering};

#[derive(Debug, PartialEq, Eq)]
pub enum HandoffFailure<A, R> {
    InvalidFile,
    AggregateTooLarge,
    Authorization(A),
    Runtime(R),
}

#[derive(Debug, PartialEq, Eq)]
pub enum HandoffError<A, R> {
    AlreadyOpen,
    Admission(WorkspaceError<R>),
    Failure(HandoffFailure<A, R>),
    Cleanup {
        operation: HandoffFailure<A, R>,
        cleanup: R,
    },
}

// Own the returned plaintext immediately. The caller must not keep a second copy.
struct SensitiveBytes(Vec<u8>);

impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

fn wipe(bytes: &mut [u8]) {
    // Volatile writes prevent dead-store elimination of this explicit wipe.
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

impl<R: GuestRuntime> Workspace<R> {
    /// Open one file after guest readiness, using the closure as the authorization/decryption port.
    /// The returned bytes are wiped before this method returns, including failure paths.
    pub fn open_authorized<A, F>(
        &mut self,
        name: &str,
        authorize: F,
    ) -> Result<(), HandoffError<A, R::Error>>
    where
        F: FnOnce() -> Result<Vec<u8>, A>,
    {
        if self.active {
            return Err(HandoffError::AlreadyOpen);
        }
        if !safe_basename(name) {
            return Err(HandoffError::Failure(HandoffFailure::InvalidFile));
        }

        // A start error can still leave resources behind, so every path after this
        // point attempts teardown and retains cleanup_pending if teardown fails.
        self.active = true;
        if let Err(error) = self.runtime.start() {
            return Err(self.fail_handoff(HandoffFailure::Runtime(error)));
        }

        let plaintext = match authorize() {
            Ok(bytes) => SensitiveBytes(bytes),
            Err(error) => return Err(self.fail_handoff(HandoffFailure::Authorization(error))),
        };
        if plaintext.0.is_empty() || plaintext.0.len() > MAX_FILE_BYTES {
            drop(plaintext);
            return Err(self.fail_handoff(HandoffFailure::InvalidFile));
        }

        let length = plaintext.0.len();
        let result = self
            .runtime
            .ingress(name, &plaintext.0)
            .and_then(|_| self.runtime.launch(name));
        drop(plaintext);
        if let Err(error) = result {
            return Err(self.fail_handoff(HandoffFailure::Runtime(error)));
        }
        self.record(name, length);
        Ok(())
    }

    /// Add a separately authorized file to the current guest. Admission rules run
    /// before the authorization port, so a rejected name never consumes access.
    pub fn admit_authorized<A, F>(
        &mut self,
        name: &str,
        authorize: F,
    ) -> Result<(), HandoffError<A, R::Error>>
    where
        F: FnOnce() -> Result<Vec<u8>, A>,
    {
        self.preflight_admission(name)
            .map_err(HandoffError::Admission)?;

        let plaintext = match authorize() {
            Ok(bytes) => SensitiveBytes(bytes),
            Err(error) => return Err(self.fail_handoff(HandoffFailure::Authorization(error))),
        };
        if let Err(error) = self.validate_payload(plaintext.0.len()) {
            drop(plaintext);
            let failure = match error {
                WorkspaceError::AggregateTooLarge => HandoffFailure::AggregateTooLarge,
                _ => HandoffFailure::InvalidFile,
            };
            return Err(self.fail_handoff(failure));
        }

        let length = plaintext.0.len();
        let result = self
            .runtime
            .ingress(name, &plaintext.0)
            .and_then(|_| self.runtime.launch(name));
        drop(plaintext);
        if let Err(error) = result {
            return Err(self.fail_handoff(HandoffFailure::Runtime(error)));
        }
        self.record(name, length);
        Ok(())
    }

    fn fail_handoff<A>(
        &mut self,
        operation: HandoffFailure<A, R::Error>,
    ) -> HandoffError<A, R::Error> {
        self.cleanup_pending = true;
        match self.close() {
            Ok(()) => HandoffError::Failure(operation),
            Err(WorkspaceError::Runtime(cleanup)) => HandoffError::Cleanup { operation, cleanup },
            Err(_) => unreachable!(),
        }
    }
}

#[cfg(test)]
#[path = "../../../tests/workspace-unit/handoff_tests.rs"]
mod tests;
