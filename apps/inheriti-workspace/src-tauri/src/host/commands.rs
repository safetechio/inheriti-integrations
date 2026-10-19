//! Tauri command adapters, grouped by user-facing responsibility.
//! Business rules stay in the access, session, and isolation modules.

mod file;
mod operator;
mod preview;
mod window;

pub use file::*;
pub use operator::*;
pub use preview::*;
pub use window::*;
