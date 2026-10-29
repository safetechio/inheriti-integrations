# Guard multi-account served gate

This protocol runs the built extension, its real service worker and side panel, local SafeID, and Business API. Record the results in `apps/inheriti-guard/artifacts/served/` (ignored by Git). A Vitest worker mock or a screenshot without the API oracle below does not pass a case.

## SafeID account choice

The local SafeID realm does not honor `prompt=select_account` while a browser SSO session exists. Guard's Add account clears the configured realm's known SafeID session cookies (`KEYCLOAK_IDENTITY`, `KEYCLOAK_SESSION`, `AUTH_SESSION_ID`, `KC_AUTH_SESSION_HASH`, and `KC_RESTART`) before opening the provider sign-in form. It does not remove either saved Guard credential. This cookie reset is realm-wide browser state: another app using the same SafeID realm may need to sign in again, including when the Add account popup is canceled. The product choice is to show a warning beside Add account. Verify that warning and record the effect with a concurrently signed-in Business UI.

## Start the stack

1. Stop any other local Business E2E stack using MySQL port 4515, SafeID port 8180, Business API port 3000, or Business UI port 8081. From `bussiness/feature-e2e`, run `yarn manual --chrome`. This builds Guard for the local harness and opens headed Chromium with the extension. Keep this terminal running.
2. Sign in to the opened Business UI as the local owner fixture (A). Use the broker-aware tenant bootstrap below to create an organization shared with the local manager fixture (B). Then use Business UI to create a second organization under A and a third under B with the second organization's display name. Record all three organization IDs, not credentials.
3. Create an evidence directory under `apps/inheriti-guard/artifacts/served/`. Record the Guard and Business API commit hashes, exact command, fixture labels and organization IDs, date, browser version, and whether a SafeKey device was used. Keep screenshots and redacted service-worker/network logs there. Do not save tokens, cookies, authorization headers, refresh responses, or protected values.

`yarn manual:tenant` is currently incompatible with the broker-login Business UI: it waits for the legacy `token` cookie. Do not use its result as Guard fixture evidence.

### Broker-aware shared organization fixture

Run this in the **Business UI page** DevTools Console after A has signed in. It follows the broker session, CSRF, and `tenant-bootstrap` request used by the existing Go served test. The browser supplies its own HttpOnly broker cookie; the snippet prints only the created organization ID and status.

```js
await (async () => {
  const api = 'http://localhost:3000';
  const sessionResponse = await fetch(`${api}/user/browser-sessions/session`, { credentials: 'include' });
  if (!sessionResponse.ok) throw new Error(`Broker session: ${sessionResponse.status}`);
  const { activeSlotId, generation } = (await sessionResponse.json()).result;
  const csrfResponse = await fetch(`${api}/csrf`, { credentials: 'include' });
  if (!csrfResponse.ok) throw new Error(`CSRF: ${csrfResponse.status}`);
  const csrf = (await csrfResponse.json()).result.token;
  const result = await fetch(`${api}/test/panel/tenant-bootstrap`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrf,
      'x-browser-session-slot-id': activeSlotId,
      'x-browser-session-generation': String(generation),
    },
    body: JSON.stringify({
      key: 'business-e2e-guard-multi-account',
      mode: 'reset-and-create',
      bootstrap: {
        organization: { name: 'Guard Shared E2E' },
        members: [{ firstName: 'E2E', lastName: 'Manager', email: 'manager@business-e2e.invalid', role: 'MANAGER', invitationStatus: 'ACCEPTED' }],
        teams: [], plans: [],
      },
    }),
  });
  if (!result.ok) throw new Error(`Tenant bootstrap: ${result.status}`);
  const created = await result.json();
  console.log(JSON.stringify({ status: result.status, organizationId: created.organization?.id }));
})();
```

## Server identity oracle

For each identity check, open the extension service worker's DevTools from `chrome://extensions` and run this snippet in its Console. It reads the active session inside the trusted worker and asks Business API for the organizations authorized by that bearer. It prints only the saved SafeID subject, organization IDs, and HTTP status. Never print the storage object or response body.

```js
await (async () => {
  const stored = await chrome.storage.session.get([
    'inheriti.operatorProfiles', 'inheriti.activeOperatorProfile',
  ]);
  const profiles = JSON.parse(stored['inheriti.operatorProfiles'] ?? '[]');
  const active = profiles.find((profile) => profile.id === stored['inheriti.activeOperatorProfile']);
  if (!active?.session?.accessToken) throw new Error('No active Guard credential');
  const response = await fetch('http://localhost:3000/integrations/v1/organizations', {
    headers: {
      Authorization: `Bearer ${active.session.accessToken}`,
      'x-elements-environment': 'TEST',
    },
  });
  const body = response.ok ? await response.json() : undefined;
  const organizationIds = body?.result?.items?.map(({ id }) => id);
  console.log(JSON.stringify({
    activeSubject: active.session.principal.subject,
    organizationIds,
    status: response.status,
  }));
})();
```

Compare the server organization IDs with the recorded fixture IDs: A's unique organization must appear only under A, and B's unique organization only under B. Capture the printed result for A, B, then A again after switching. A panel label alone is insufficient evidence. If DevTools rejects the request, use the Network panel to inspect the extension's `listOrganizations` request and compare its returned organization IDs without writing the bearer to disk.

## Cases

| Case | Action and passing observation |
| --- | --- |
| Two identities | Sign in as A. Choose Add account and sign in as B. Switch A → B → A without another SafeID login. Capture each panel state and the server identity oracle after every transition. Both saved rows remain until browser exit. |
| Organization choice | Under A, switch between two authorized organizations directly. From B, choose A's company, cancel once, then confirm. The confirmation names both SafeID and company. After confirmation, the server organization oracle contains A's unique organization and the chosen organization ID is the one shown. A removed membership is denied after fresh revalidation. Same-name organizations remain distinct by account and ID. |
| Isolation | Start a reveal/autofill or page-field selection under A. Switch to B or confirm that the active operation blocks switching. After switching, the old draft, field mapping, key status, reveal result, and protected value are absent from B's panel and target page. A late response must be discarded. Repeat with a navigation to a different page before the late result. |
| Login and failure | Cancel Add account and confirm A remains server-confirmed. Re-enroll the same SafeID subject and confirm one row. Expire or revoke B's login, confirm B says Sign in again and A remains usable. An unavailable API must leave protected content hidden until a profile is confirmed again. |
| Removal | Remove B while A is active; A remains usable. Re-add B, sign out the active account, and confirm the other saved row remains. Secure Logoff clears every saved row and active key or reveal state. Verify server identity after each remaining-account activation. |
| Browser lifetime | Close **all** Chromium windows of the launched profile, then restart the launcher. `chrome.storage.session` has no profiles or active credential; device-wide site permissions and non-auth organization preferences remain. Fresh sign-in is required. |
| Trust boundary and access | Send a forged account or organization ID through the panel's runtime message API and observe rejection with unchanged active identity. Inspect panel messages and `chrome.storage.local` for absence of bearer, refresh token, master key, and protected field values. Check long account/company labels and keyboard operation of the picker and confirmation. |

For each negative case, capture the rejected API request or unchanged server identity/state, not only an error banner. Record any case that could not run as **not passed**, with its exact reason. SafeKey hardware-dependent release is a separate manual gate; do not count a simulated approval as device evidence.
