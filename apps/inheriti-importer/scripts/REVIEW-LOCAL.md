# Real local Importer review

With the existing Business harness API on `business.localhost:3400` and the existing Vite renderer on `127.0.0.1:5173`, run from `apps/inheriti-importer`:

```bash
pnpm review:local -- --output /home/javier/Projects/SafeTech/Inheriti/tasks/importer-improvements/evidence/real-electron/latest --keep-open
```

The command launches the actual Electron main process, preload, and React app with an isolated temporary profile. It signs in with real SafeID and Business API calls, uses the native file selection path to load `keepass-demo-vault.kdbx`, checks the locked, wrong-password, canceled, successfully unlocked, and Step 2 states, and saves screenshots plus `provenance.json`. It also resizes that same Electron window to 1440×1000, 1280×800, and 980×680 while the floating unlock panel is open, saving screenshots and measured control positions in `unlock-geometry.json`. The checks confirm that the source card does not grow, the panel remains aligned to its Unlock button and inside the viewport, and the eye stays centered inside the password input. A real scroll is attempted at 980×680; if the single-source page cannot scroll, the geometry file marks repositioning as unverified. `--keep-open` leaves this same Electron window visible for manual inspection until you close it. Without that flag, the command closes its window after capture. `--manual` opens the real app and waits for you to drive the flow yourself, without automated sign-in or import; its provenance marks both as unverified.

After reaching the real Step 2, it opens the Notes source-field picker on the first reviewed asset and saves `06-real-source-chips.png` plus `source-chips.json` with chip bounds and selected states. It checks compact wrapping and closes a mapped picker by pressing Enter on the already selected source, leaving the mapping unchanged.

The runner uses the app's ignored `.env.local` issuer/API settings. Headless Chrome opens the real OIDC URL from Electron; its existing Business UI `owner.json` browser cookies may be used, and an actual login form uses the ignored Business E2E owner credentials. Neither cookies nor credentials are copied into Electron. Failed authentication or parsing stops the run; no fallback screen or data is generated. The only interception is Electron's OS browser opener for automated OIDC and the native file picker for the public test KDBX. No separate backend, Vite server, or harness service is started or stopped.
