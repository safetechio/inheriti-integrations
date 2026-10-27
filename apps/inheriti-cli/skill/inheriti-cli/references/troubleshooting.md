# Pauses, errors, and safe recovery

- **Login or Organisation missing:** use browser `login` and `organizations list/use`, then retry the same safe discovery. A browser session alone is not evidence that the CLI holds a valid session.
- **Command unavailable:** inspect `inheriti help` and the build's feature flags. Do not substitute a guessed flag or switch deployment channels to make an example work.
- **Ambiguous plan or field:** list safe metadata and ask the person to choose. In a pipe, supply explicit ID and selector; interactive selection may not be available.
- **Plan creation unavailable or interrupted:** check terminal/window availability, sign-in, selected Organisation, local assistant installation, and the CLI's returned plan status. Do not move protected inputs into chat to work around the window.
- **“Claim the Organisation key” during creation:** this is a prerequisite failure before a mobile relay request starts. Complete the member's key claim in SafeKey Mobile, then retry; distinguish it from a relay that is already waiting for release.
- **Reveal pending:** report the CLI's current gate and the device or person who must act. Wait for the outcome; do not reissue a second reveal merely because an approval is slow. Denial, reconciliation, and DMS stop have distinct outcomes. `plans abort` resets an open operator access only when requested.
- **Clipboard/file issue:** inspect the reported delivery status. TTL cleanup is best effort; downloads do not overwrite and may require a protected `.inheriti` path. Never read the value back to “verify” it.
- **Automation pairing expired or workload changed:** inspect connection status and the live workload identity/revision, then start a new pairing window if still intended. Do not reuse a proof or ignore an expected-revision mismatch.
- **Grant, mapping, or deployment failed:** compare the chosen plan, responsible member, connection, field selectors, and preview. Verify safe logs and provider state; do not claim deployment from a generated launcher alone.
- **Update required:** complete the CLI's verified update, rerun in the new process, and start a new agent session if its bundled skill changed. Skill reconciliation uses local bundled files; it does not require a separate manual install step.
