//! Disposable guest isolation and platform-specific QEMU transports.
//!
//! Adapters receive bounded bytes from `session`/`access` and must keep host
//! paths, clipboard, and network out of the guest. This module does not decide
//! whether a member is authorized.

pub mod adapter_cache;
pub mod adapter_registry;
#[cfg(target_os = "linux")]
pub mod linux_qemu;
#[cfg(target_os = "macos")]
pub mod macos_qemu;
pub mod platform;
pub mod qemu_spec;
#[cfg(target_os = "windows")]
pub mod windows_qemu;
