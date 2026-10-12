# Desktop security boundary

## Renderer sandbox

`electron/main.cjs` creates every window with `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`. The renderer's only capability is
`window.inheriti`, exposed by `electron/preload.cjs` from a fixed allowlist. No
`ipcRenderer`, Node API, or unrestricted path is ever exposed.

## Content Security Policy

The main process sets a strict CSP response header on every load: `default-src
'self'`; `connect-src` limited to the configured Business API origin; no
`unsafe-eval`, no remote script. There is no `<meta>` CSP in the renderer — the
header is authoritative.

## Navigation

`will-navigate` and `setWindowOpenHandler` deny everything except the app's own
origin (dev server URL / packaged `file://`). External links are handed to the OS
browser, never opened in-app.

## DevTools

Open in development, disabled in packaged builds.

## Secret lifecycle

- Imported values and master passwords live in memory only. No `localStorage`,
  no persisted store, no logs, telemetry, crash dumps, or URLs carry them.
- Organisation Key material is released, decrypted, and held in the renderer's
  memory for the duration of one release/configure operation. Core crypto
  (`crypto.subtle`, RSA-OAEP delivery) runs in the browser-like renderer (see
  [ADR 0001](adr/0001-organization-key-boundary.md)). What must never happen,
  and is the actual boundary this app enforces, is **persistence**: the host
  supplies an in-memory-only `OrganizationKeyVault`, so the key does not survive a renderer
  reload, an app restart, or a crash, and is purged on cancel, organisation
  switch, logout, and app close.
- HTTP-only cookies and API/Keycloak tokens are held by the **main process**; the
  renderer calls a typed transport over IPC and never receives a token or cookie.
- The secure-cleanup controller (`modules/_shared`) runs best-effort buffer/temp
  wiping on source replacement, logout, cancellation, and app close.

`ImporterRuntime` installs an Importer-owned, in-memory-only
`OrganizationKeyVault` (`modules/organization/infrastructure/in-memory-organization-key-vault.ts`,
), wired to `clearAllSessions()` on logout
and as a best-effort `secureCleanup` task on app close. The vault's cleanup
contract — cancel, organisation switch, logout, app close, crash — is defined
in [ADR 0001](adr/0001-organization-key-boundary.md).

## Auth

Keycloak PKCE runs in a controlled window; the OIDC callback is owned by the main
process, which exchanges and holds the Business API session.
