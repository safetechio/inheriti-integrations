import type { GuardRequest, GuardResponse } from '../../shared/messages.js';
import type { GuardActivityEntry, GuardSettings } from '../../shared/guard-contract.js';
import { el, required } from './dom.js';

function sendGuard(request: GuardRequest): Promise<GuardResponse> { return chrome.runtime.sendMessage(request) as Promise<GuardResponse>; }

export function initializeGuardPanel(onSecureLogoff: () => void): void {
  const guardEnabled = required<HTMLInputElement>('guard-enabled');
  const guardSensitiveApi = required<HTMLInputElement>('guard-sensitive-api');
  const guardClipboard = required<HTMLInputElement>('guard-clipboard');
  const guardIdleLock = required<HTMLInputElement>('guard-idle-lock');
  const guardIdleMinutes = required<HTMLInputElement>('guard-idle-minutes');
  const guardDownloadTrap = required<HTMLInputElement>('guard-download-trap');
  const guardHeaderStatus = required('guard-header-status');
  const guardLiveStatus = required('guard-live-status');
  const activityList = required<HTMLUListElement>('activity-list');
  const migrationNotice = required<HTMLElement>('migration-notice');

  function renderGuard(settings: GuardSettings): void {
    guardEnabled.checked = settings.isEnabled;
    guardSensitiveApi.checked = settings.apiBlockingEnabled;
    guardClipboard.checked = settings.clipboardGuardEnabled;
    guardIdleLock.checked = settings.idleLockEnabled;
    guardIdleMinutes.value = String(settings.idleLockMinutes);
    guardIdleMinutes.disabled = !settings.idleLockEnabled;
    guardDownloadTrap.checked = settings.downloadTrapEnabled;
    guardHeaderStatus.textContent = `Protection: ${settings.isEnabled ? 'active' : 'off'}`;
    guardHeaderStatus.dataset.active = String(settings.isEnabled);
  }

  async function mutateGuard(request: GuardRequest): Promise<void> {
    guardLiveStatus.textContent = 'Updating Browser Protection…';
    const response = await sendGuard(request);
    if (response.ok && 'guard' in response) {
      renderGuard(response.guard);
      guardLiveStatus.textContent = 'Browser Protection updated.';
    } else guardLiveStatus.textContent = 'Browser Protection could not be updated.';
  }

  guardEnabled.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-protection', enabled: guardEnabled.checked }); });
  guardSensitiveApi.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-sensitive-api', enabled: guardSensitiveApi.checked }); });
  guardClipboard.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-clipboard', enabled: guardClipboard.checked }); });
  guardIdleLock.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-idle-lock', enabled: guardIdleLock.checked }); });
  guardIdleMinutes.addEventListener('change', () => {
    const minutes = Math.min(120, Math.max(1, Number.parseInt(guardIdleMinutes.value, 10) || 1));
    void mutateGuard({ type: 'guard:set-idle-minutes', minutes });
  });
  guardDownloadTrap.addEventListener('change', () => { void mutateGuard({ type: 'guard:set-download-trap', enabled: guardDownloadTrap.checked }); });

  function secureLogoff(): void {
    if (!window.confirm('Secure Logoff will end Plan Access work, close Inheriti sessions, and clear scoped session data. Continue?')) return;
    void sendGuard({ type: 'guard:secure-logoff' }).then(() => { guardLiveStatus.textContent = 'Secure Logoff complete.'; onSecureLogoff(); });
  }
  required<HTMLButtonElement>('secure-logoff').addEventListener('click', secureLogoff);
  required<HTMLButtonElement>('sign-out-all').addEventListener('click', secureLogoff);

  function activityLabel(kind: GuardActivityEntry['kind']): string {
    return ({ 'navigation-blocked': 'Navigation blocked', 'clipboard-blocked': 'Clipboard protected',
      'download-blocked': 'Download blocked', 'csp-violation': 'Page policy violation observed',
      'sensitive-api-blocked': 'Sensitive API blocked', 'idle-lock': 'Idle lock',
      'secure-logoff': 'Secure Logoff' })[kind];
  }
  function renderActivity(entries: readonly GuardActivityEntry[]): void {
    activityList.replaceChildren(...(entries.length === 0 ? [el('li', 'empty-activity', 'No protection activity yet.')] : entries.map((entry) => {
      const item = el('li', 'activity-entry');
      const heading = el('div', 'activity-entry-heading');
      heading.append(el('strong', '', activityLabel(entry.kind)), el('time', '', new Date(entry.timestamp).toLocaleString()));
      item.append(heading);
      const location = safeActivityLocation(entry.origin, entry.pathname);
      if (location !== '') item.append(el('p', '', location));
      if (entry.detail !== undefined) item.append(el('p', 'activity-detail', entry.detail));
      return item;
    })));
  }
  function safeActivityLocation(origin?: string, pathname?: string): string {
    const cleanOrigin = origin === undefined ? '' : origin.split(/[?#]/u, 1)[0]!;
    const cleanPath = pathname === undefined ? '' : pathname.split(/[?#]/u, 1)[0]!;
    return `${cleanOrigin}${cleanPath}`;
  }
  async function refreshActivity(): Promise<void> {
    const response = await sendGuard({ type: 'activity:list' });
    if (response.ok && 'activity' in response) renderActivity(response.activity);
    else renderActivity([]);
  }
  required<HTMLButtonElement>('activity-tab').addEventListener('click', () => { void refreshActivity(); });
  required<HTMLButtonElement>('clear-activity').addEventListener('click', () => { void sendGuard({ type: 'activity:clear' }).then(() => renderActivity([])); });

  const MIGRATION_NOTICE_KEY = 'inheritiguardUnifiedNoticeDismissed';
  try { migrationNotice.hidden = localStorage.getItem(MIGRATION_NOTICE_KEY) === 'true'; } catch { migrationNotice.hidden = false; }
  required<HTMLButtonElement>('dismiss-migration').addEventListener('click', () => {
    migrationNotice.hidden = true;
    try { localStorage.setItem(MIGRATION_NOTICE_KEY, 'true'); } catch { /* The notice stays dismissed for this panel lifetime. */ }
  });
  void sendGuard({ type: 'guard:get-state' }).then((response) => { if (response.ok && 'guard' in response) renderGuard(response.guard); });

}
