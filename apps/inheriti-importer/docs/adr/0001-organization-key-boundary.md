# ADR 0001 — Desktop Organization Key trust boundary

Status: **Accepted**
Date: 2026-09-03

## Context

Plan configuration needs the Organization Key in the renderer because the
ephemeral RSA-OAEP session and Core crypto use Web Crypto. Tokens and cookies
remain in Electron main and never cross the preload bridge.

## Decision

- Generate an ephemeral RSA-OAEP key pair with `@safetech/inheriti-core-sdk`.
- Open and cancel Organization Key sessions through the Importer's Business API
  transport.
- Receive encrypted delivery through the authenticated Electron socket bridge,
  decrypt it in renderer memory, and verify its passphrase verifier before use.
- Keep decrypted keys only in `InMemoryOrganizationKeyVault`. Never write them
  to IndexedDB, local storage, logs, telemetry, or URLs.
- Scope vault entries by session family, user, and organization.
- Purge keys on session replacement or expiry, organization switch, logout,
  cancellation, renderer reload, application close, and crash.
- Bind release sessions to a Plan when a specific Plan configuration initiates
  the request.
- Add no IPC channel that accepts or returns plaintext Organization Key material.

## Consequences

The plaintext key exists briefly in renderer memory during configuration, but
cannot survive the renderer process. Moving crypto out of the renderer would
require a separate non-browser execution path and a new reviewed IPC boundary.
