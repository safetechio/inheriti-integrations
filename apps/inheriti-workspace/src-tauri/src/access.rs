//! Authorized byte handoff from the caller into a disposable session.
//!
//! The caller supplies authorization and decrypted bytes; this layer does
//! not perform decryption or decide membership policy.

pub mod handoff;
