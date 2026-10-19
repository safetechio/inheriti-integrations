//! Compatibility facade for the previous `workspace::*` Rust paths.
//! New code should import from `access`, `session`, or `isolation::guest`.

pub use crate::access::handoff;
#[cfg(target_os = "linux")]
pub use crate::isolation::guest::linux_qemu;
#[cfg(target_os = "macos")]
pub use crate::isolation::guest::macos_qemu;
#[cfg(target_os = "windows")]
pub use crate::isolation::guest::windows_qemu;
pub use crate::isolation::guest::{platform, qemu_spec};
pub use crate::session::{
    GuestRuntime, Workspace, WorkspaceError, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES,
};
