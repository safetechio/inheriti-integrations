//! Local session admission rules shared by first open and later file admits.
//!
//! The limits and portable basename check run before bytes enter the guest.
//! They are not authorization decisions; see `access` for that boundary.

pub const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_FILES: usize = 16;
pub const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

pub(crate) fn safe_basename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '/' | '\\' | ':'))
        && !matches!(
            name.split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
}
