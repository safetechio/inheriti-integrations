# Electron IPC contract

The renderer reaches the main process only through `window.inheriti`, defined in
`electron/preload.cjs`. Every channel is explicitly allowlisted; adding one means
editing both `preload.cjs` (exposure) and `main.cjs` (`ipcMain.handle`).

## Channels

| `window.inheriti`                   | IPC channel                    | Main-process behaviour                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openFiles()`                       | `vault:openFiles`              | OS file dialog (KeePass / Passbolt / K8s / Vault / dotenv / cloud filters). Returns `[{ name, path, data: number[] }]`; `[]` on cancel.                                                                                                                                                         |
| `api.request(req)`                  | `api:request`                  | Forwards a `{ method, path, query?, body?, skipCsrf? }` to the Business API via Electron `net` on an isolated session partition (`persist:inheriti-api`). Main attaches the persisted cookie jar + `x-csrf-token`; on `419/403` it refreshes CSRF once and retries. Returns `{ status, body }`. |
| `development.deliverMasterKey(req)` | `development:deliverMasterKey` | Development-only SafeKey Mobile stand-in. Accepts an organization id, active session id, one-time relay token, and RSA-encrypted Organization Key, then calls the real `master-key-relay` endpoint. Packaged builds reject the call.                                                            |
| `auth.login()`                      | `auth:login`                   | Authorization Code + PKCE in a controlled window owned by main → SafeID token exchange → Business API session cookie held by main.                                                                                                                                                              |
| `auth.logout()`                     | `auth:logout`                  | Clears the API session partition cookies + CSRF token.                                                                                                                                                                                                                                          |
| `auth.session()`                    | `auth:session`                 | `GET /user/session`; returns the non-secret session descriptor or `null`.                                                                                                                                                                                                                       |
| `socket.subscribe(req)`             | `socket:subscribe`             | Joins an allowlisted Business Socket.IO room from the authenticated main-process session.                                                                                                                                                                                                       |
| `socket.unsubscribe(req)`           | `socket:unsubscribe`           | Leaves an allowlisted Business Socket.IO room.                                                                                                                                                                                                                                                  |

## Authentication configuration

The committed `.env.dev`, `.env.stg`, and `.env.prod` files configure
`INHERITI_API_ORIGIN`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, and
`KEYCLOAK_CLIENT_ID` with the shared Business integrations interactive client
used by Inheriti Go. `WEB_APP_URL` configures the matching Business web CTA.
Environment builds validate those values and bundle the selected configuration
for the main process. Local development reads `.env.local` unless `INHERITI_ENV`
selects one of the deployed environments. Authentication uses a temporary
`http://127.0.0.1:<port>/oauth/callback` redirect.

## Rules

- Authentication tokens, cookies, and the CSRF header never cross the bridge —
  the main process holds them on the `persist:inheriti-api` session. The local
  simulator passes only its active session's short-lived relay token back to a
  dedicated development handler.
- Handlers never take a caller-supplied filesystem path — the dialog is the only
  path source.
- Handlers return plain serialisable data; no handles, streams, or Node objects.
- `api:request` rejects any method other than GET/POST/PUT/PATCH/DELETE and any
  `path` that is not an absolute API path.
- `development:deliverMasterKey` rejects packaged execution, malformed relay
  tokens, incomplete payloads, and oversized encrypted keys. It cannot select
  an arbitrary API path or attach arbitrary headers. Its relay request omits
  Business session cookies and authenticates only with the one-time relay token,
  matching SafeKey Mobile and avoiding cookie-session CSRF semantics.
- CSP permits `wasm-unsafe-eval` in every environment because the Core SDK's
  Organization Key derivation and KeePass imports use Argon2 WebAssembly.
  Arbitrary JavaScript `unsafe-eval` remains disallowed; `unsafe-inline` remains
  development-only.
- The renderer-side Business API transport is
  `src/modules/_shared/infrastructure/transport/electron-http-transport.ts`.
- Every handler is covered by an IPC contract test (input shape, output shape,
  refusal of out-of-allowlist channels).
- Every channel is registered through a `handle()` wrapper that rejects any
  `event.sender` not created by this process's own `createWindow()`.
