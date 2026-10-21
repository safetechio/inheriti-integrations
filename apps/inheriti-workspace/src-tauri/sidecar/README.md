# Workspace Node host

The host is the transport adapter between the desktop UI and the shared Inheriti® SDK. It does not isolate opened content.

- `main.ts` and `protocol.ts`: launch the host and validate UI requests.
- `session/`: authenticate the operator, select an organization, and keep the credential in the OS keyring. `workspace-session.ts` coordinates one file opening at a time.
- `access/`: read a bounded `.inheriti` file, apply the preview policy in `policy.ts`, and invoke the Client SDK for inspection and opening. The SDK owns authorization and decryption; the host zeroes its temporary byte buffers.

The top-level `session.ts`, `session-store.ts`, and `oauth-callback.ts` preserve existing import paths. Native isolation and protected viewing belong to the Rust workspace and guest runtime, not this Node host.
