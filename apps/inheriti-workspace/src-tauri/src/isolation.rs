//! Adapters that keep untrusted file content outside the host process.
//!
//! `guest` is the disposable QEMU boundary used by `session`; the legacy
//! preview helper is a separate, narrower Tauri adapter.

pub mod guest;

/// Narrow, bounded decoding used by the existing preview helper.
pub mod preview {
    pub mod codec;
}
