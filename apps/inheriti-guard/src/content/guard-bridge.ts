import { shouldReportCspViolation } from './csp-observation-policy.js';

const SETTINGS_EVENT = 'inheritiguard:settings';
const BLOCKED_EVENT = 'inheritiguard:blocked';
const bridgeNonce = crypto.randomUUID();
let protectionEnabled = false;

interface PageGuardSettings {
  protection: boolean;
  sensitiveApi: boolean;
  clipboard: boolean;
  allowPaste: boolean;
  allowRead: boolean;
}

function publish(settings: PageGuardSettings): void {
  protectionEnabled = settings.protection;
  document.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { nonce: bridgeNonce, settings } }));
}

async function refresh(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'guard-content:get-state' }) as
      { ok?: boolean; guard?: PageGuardSettings };
    if (response.ok && response.guard !== undefined) publish(response.guard);
  } catch { /* extension context was reloaded */ }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: unknown })?.type === 'inheritiguard:settings') void refresh();
});

document.addEventListener('copy', () => {
  void chrome.runtime.sendMessage({ type: 'guard-content:clipboard-copied' }).catch(() => undefined);
}, true);

// CSP remains browser/page policy. InheritiGuard only observes that a violation occurred and sends
// no directive, blocked URI, document URL, query, fragment, or report details across the boundary.
document.addEventListener('securitypolicyviolation', (event) => {
  if (shouldReportCspViolation(protectionEnabled, event)) {
    void chrome.runtime.sendMessage({ type: 'guard-content:csp-violation' }).catch(() => undefined);
  }
}, true);

document.addEventListener(BLOCKED_EVENT, (event) => {
  const kind = (event as CustomEvent<{ kind?: unknown }>).detail?.kind;
  if (kind === 'clipboard-blocked' || kind === 'sensitive-api-blocked') {
    void chrome.runtime.sendMessage({ type: 'guard-content:blocked', kind }).catch(() => undefined);
  }
});

void refresh();
