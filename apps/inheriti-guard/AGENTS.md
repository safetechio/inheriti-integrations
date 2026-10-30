# InheritiGuard agent guide

InheritiGuard is a Chrome MV3 extension for browser protection and Inheriti plan access. This file maps its current boundaries; `dist/` is generated output.

## Find the owning code

| Change | Start here |
| --- | --- |
| SafeID sign-in and account choice | `src/background/auth.ts` |
| Saved profiles, active pointer, token rotation | `src/background/session-store.ts` |
| Profile and generation-bound master keys | `src/background/session-key-vault.ts` |
| Message routing, lifecycle lock, tab events | `src/background/service-worker/main.ts` |
| Account and organization transitions, Core construction | `src/background/service-worker/accounts.ts` |
| Page access, mapping, and workspace operations | `src/background/service-worker/access.ts`, `workspace.ts` |
| Reveal lifecycle and autofill | `src/background/reveal/main.ts`, then its focused collaborators |
| Side-panel composition and events | `src/side-panel/main.ts` |
| Account, organization, key-status, plan, and workspace UI | Matching file in `src/side-panel/main/` |
| Runtime request validation and panel view types | `src/shared/messages.ts`, `plan-view.ts` |
| Configuration and organization preferences | `src/shared/stored-configuration.ts` |
| Browser Protection policy | `src/background/guard/` |
| Manifest, permissions, CSP, content-script worlds | `src/manifest.json`, `src/content/` |

`src/background/reveal.ts` is a compatibility re-export. The worker build entry is `service-worker/main.ts`; `scripts/build-chrome-extension.mjs` emits `dist/background/service-worker.js`. Keep the entry files focused on wiring and route behavior into the matching collaborator.

## Security and context contract

- Operator tokens and cached master keys stay in `chrome.storage.session` or worker memory. The side panel receives only non-secret view state. `chrome.storage.local` holds configuration, subject-scoped organization preferences, and device-level permissions, never credentials or protected values.
- Bind every Core, key-vault entry, reveal batch, page mapping, and in-flight result to the active profile, organization, and generation. A switch closes old work, invalidates caches and tab context, then confirms the target's session and membership before protected content renders.
- Validate runtime messages and sender context at the worker boundary. Content scripts and pages cannot choose a profile or organization, and panel/message responses cannot carry tokens or reveal plaintext. Authorized autofill writes plaintext only into the verified target field.
- Add account clears known SafeID browser session cookies for the configured realm so the provider can show its login form. This affects browser SSO for other apps in that realm. Saved Guard credentials remain independent.
- Keep reveal recovery and relay persistence metadata-only. Preserve cancellation on navigation, account switch, organization change, and Secure Logoff.

## Changes and checks

Start with the owning module and its callers. Update `shared/messages.ts` and its validation tests for a new request; update `shared/plan-view.ts` and panel tests for a new view field. Prefer a focused collaborator over adding more logic to `service-worker/main.ts`, `reveal/main.ts`, or `side-panel/main.ts`. Add short comments only where the reason is not apparent from the code.

From this folder, run:

```bash
../../node_modules/.bin/vitest run --root .
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node ../../scripts/verify-boundaries.mjs .
node ../../scripts/verify-chrome-security.mjs .
INHERITI_BUILD_DEPLOYMENT=local node ../../scripts/build-chrome-extension.mjs
git diff --check
```

The Integrations workspace declares pnpm; the commands above use its installed binaries without changing the lockfile. `tests/served/README.md` describes the real extension, SafeID, and Business API browser checks. Unit mocks do not prove browser account switching, restart behavior, or SafeKey hardware approval.
