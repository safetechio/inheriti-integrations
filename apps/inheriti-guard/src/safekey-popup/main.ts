import { connectSafeKeyProPanel } from '../side-panel/safekey-pro-bridge.js';

connectSafeKeyProPanel();
document.querySelector<HTMLElement>('#guard-version')!.textContent = `InheritiGuard ${chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version}`;
