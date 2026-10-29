# Electron IPC contract

The renderer reaches the main process through `window.inheriti` in
`electron/preload.cjs`. Every handler is registered through the trusted-sender
check in `electron/lib/ipc-guard.cjs`.

| Bridge method | IPC channel | Behavior |
| --- | --- | --- |
| `openFiles()` | `vault:openFiles` | Opens the OS file picker and returns selected files. |
| `api.request(req)` | `api:request` | Sends an allowlisted `/integrations/v1/` request. Main adds the active Business operator bearer token, environment, and selected organization header. |
| `auth.login()` / `auth.add()` | `auth:login` / `auth:add` | Runs SafeID authorization code with PKCE, exchanges it for a Business operator session, and stores it by account. Adding an account keeps the current account active. |
| `auth.accounts()` / `auth.destinations()` | `auth:accounts` / `auth:destinations` | Returns non-secret saved account and organization choices. |
| `auth.activate(key)` | `auth:activate` | Confirms the saved operator session and switches the active account. |
| `auth.remove(key)` / `auth.logout()` / `auth.logoutAll()` | Matching `auth:*` channels | Clears local credentials and attempts Business family revocation. |
| `auth.cancel()` | `auth:cancel` | Aborts a pending browser authorization. |
| `auth.session()` | `auth:session` | Confirms the active operator session and returns only `sessionFamilyId`, local `userId`, and `expiresAt`. |
| `socket.subscribe(req)` / `socket.unsubscribe(req)` / `socket.reconnect()` | Matching `socket:*` channels | Uses a fresh Business access token for Socket.IO authentication and fences events across account changes. |
| `updates.check()` / `updates.install(id)` | Matching `update:*` channels | Uses bearer-only integration build routes. |
| `development.deliverMasterKey(req)` | `development:deliverMasterKey` | Development-only key relay. Uses the one-time relay token on the integration relay route, separate from the operator token. |

The checked-out integration core supplies the Business interactive client ID.
The committed `.env.dev`, `.env.stg`, and `.env.prod` files provide
`INHERITI_API_ORIGIN`, `SAFEID_URL`, `SAFEID_REALM`, and `WEB_APP_URL`.
Authentication uses a temporary loopback `/oauth/callback` URL.

Operator tokens stay in the main process. Session files use Electron
`safeStorage` when protected storage is available. If protected storage is
unavailable, sessions stay in memory and require sign-in after restart. The
renderer can pass a short-lived relay token only to the dedicated development
handler. API requests accept only `/integrations/v1/` paths; the relay handler
accepts only the matching relay route.

The file picker is the only source of filesystem paths for the vault handler.
IPC values are serializable, and the content security policy permits
`wasm-unsafe-eval` for Organization Key derivation and KeePass imports.
