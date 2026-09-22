import { createGuardActivity, prependBoundedActivity } from './activity.js';
import { markSensitiveClipboard, clipboardDecision, isSensitiveClipboardActive } from './clipboard-policy.js';
import { guardRuleUpdate } from './dnr-policy.js';
import { shouldBlockDownload, type DownloadCandidate } from './download-policy.js';
import { idleDetectionSeconds, shouldTriggerIdleLock } from './idle-policy.js';
import { isInlineDocumentUrl, shouldTrapInlineNavigation } from './inline-navigation-policy.js';
import { isEcosystemUrl, isTrustedUrl } from './url-policy.js';
import { clampIdleMinutes, readGuardSettings, writeGuardSettings } from '../../shared/guard-storage.js';
import type { GuardActivityEntry, GuardActivityKind, GuardSettings, SensitiveClipboardState } from '../../shared/guard-contract.js';
import type { GuardContentRequest, GuardRequest, GuardResponse } from '../../shared/messages.js';

const ACTIVITY_KEY = 'inheritiguard.activity';
const CLIPBOARD_KEY = 'inheritiguard.sensitiveClipboard';
export const CLIPBOARD_EXPIRY_ALARM = 'inheritiguard.clipboard-expiry';
export const SESSION_ROOT_DOMAINS = ['inheriti.com', 'safetech.io', 'safekey.be'] as const;
export const SESSION_ORIGINS = [
  'https://inheriti.com', 'https://www.inheriti.com', 'https://app.inheriti.com',
  'https://app-stg.inheriti.com', 'https://app-dev.inheriti.com', 'https://business.inheriti.com',
  'https://business-prod.inheriti.com', 'https://business-stg.inheriti.com',
  'https://business-dev.inheriti.com', 'https://inheritichain-explorer.inheriti.com',
  'https://inheritichain-explorer-dev.inheriti.com', 'https://safetech.io',
  'https://safeid-prod.safetech.io', 'https://safeid-stg.safetech.io',
  'https://safeid-dev.safetech.io', 'https://safekey.be',
] as const;

export interface GuardLifecycle {
  lock(): void;
  secureLogoff(): Promise<void>;
  unlock(): void;
}

export class GuardController {
  private settings: GuardSettings | undefined;
  private busy = false;
  private readonly inlineNavigationGenerations = new Map<number, number>();

  public constructor(
    private readonly lifecycle: GuardLifecycle,
    private readonly local: chrome.storage.StorageArea,
    private readonly session: chrome.storage.StorageArea,
  ) {}

  public async initialize(): Promise<void> {
    this.settings = await readGuardSettings(this.local);
    await writeGuardSettings(this.local, this.settings);
    await this.applyRules();
    await this.applyIdle();
    await this.broadcast();
  }

  public async respond(request: GuardRequest): Promise<GuardResponse> {
    if (request.type === 'activity:list') return { ok: true, activity: await this.activity() };
    if (request.type === 'activity:clear') {
      await this.local.remove(ACTIVITY_KEY);
      return { ok: true, cleared: true };
    }
    if (request.type === 'guard:secure-logoff') return this.secureLogoff('secure-logoff');
    const settings = await this.getSettings();
    if (request.type === 'guard:get-state') return { ok: true, guard: settings };
    if (this.busy) return { ok: false, error: 'operation-busy' };
    if (request.type === 'guard:set-protection') settings.isEnabled = request.enabled;
    if (request.type === 'guard:set-sensitive-api') settings.apiBlockingEnabled = request.enabled;
    if (request.type === 'guard:set-clipboard') settings.clipboardGuardEnabled = request.enabled;
    if (request.type === 'guard:set-idle-lock') settings.idleLockEnabled = request.enabled;
    if (request.type === 'guard:set-idle-minutes') settings.idleLockMinutes = clampIdleMinutes(request.minutes);
    if (request.type === 'guard:set-download-trap') settings.downloadTrapEnabled = request.enabled;
    await writeGuardSettings(this.local, settings);
    this.settings = settings;
    await this.applyRules();
    await this.applyIdle();
    await this.broadcast();
    return { ok: true, guard: settings };
  }

  public async respondContent(request: GuardContentRequest, sender: chrome.runtime.MessageSender) {
    const settings = await this.getSettings();
    const senderUrl = sender.url ?? sender.tab?.url;
    if (request.type === 'guard-content:get-state') {
      const clipboard = await this.clipboardState();
      const sessionOpen = await this.ecosystemSessionOpen();
      return { ok: true, guard: {
        protection: settings.isEnabled,
        sensitiveApi: settings.isEnabled && settings.apiBlockingEnabled && !isTrustedUrl(senderUrl),
        clipboard: settings.clipboardGuardEnabled,
        ...clipboardDecision({ ...(senderUrl === undefined ? {} : { senderUrl }),
          guardEnabled: settings.clipboardGuardEnabled,
          ecosystemSessionOpen: sessionOpen, ...(clipboard === undefined ? {} : { state: clipboard }), now: Date.now() }),
      } };
    }
    if (request.type === 'guard-content:clipboard-copied') {
      if (settings.clipboardGuardEnabled && isEcosystemUrl(senderUrl)) {
        const marker = markSensitiveClipboard(Date.now());
        await this.session.set({ [CLIPBOARD_KEY]: marker });
        await chrome.alarms.create(CLIPBOARD_EXPIRY_ALARM, { when: marker.expiresAt });
        await this.refreshClipboardProtection();
      }
      return { ok: true };
    }
    if (request.type === 'guard-content:csp-violation') {
      if (settings.isEnabled) {
        await this.record('csp-violation', senderUrl, true);
        await this.notify('csp-violation');
      }
      return { ok: true };
    }
    await this.record(request.kind, senderUrl);
    await this.notify(request.kind);
    return { ok: true };
  }

  public async navigation(url: string): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.isEnabled || isTrustedUrl(url)) return;
    const site = `${new URL(url).origin}${new URL(url).pathname}`;
    settings.blockedSites = [site, ...settings.blockedSites.filter((entry) => entry !== site)].slice(0, 100);
    await writeGuardSettings(this.local, settings);
    await this.record('navigation-blocked', url);
  }

  /** Guard navigation policy wins before Plan Access inspects or writes to an existing tab. */
  public async allowsPlanAccess(url: string | undefined): Promise<boolean> {
    const settings = await this.getSettings();
    return !settings.isEnabled || isTrustedUrl(url);
  }

  public async download(item: DownloadCandidate & { id: number }): Promise<void> {
    const settings = await this.getSettings();
    if (!shouldBlockDownload(item, settings.downloadTrapEnabled)) return;
    await chrome.downloads.cancel(item.id);
    await chrome.downloads.erase({ id: item.id });
    await this.record('download-blocked', item.finalUrl ?? item.url);
    await this.notify('download-blocked');
  }

  /** Called synchronously at webNavigation ingress; every top-frame event invalidates older work. */
  public inlineNavigation(details: Pick<chrome.webNavigation.WebNavigationBaseCallbackDetails,
    'tabId' | 'frameId' | 'url'>): Promise<void> {
    if (details.frameId !== 0) return Promise.resolve();
    const generation = (this.inlineNavigationGenerations.get(details.tabId) ?? 0) + 1;
    this.inlineNavigationGenerations.set(details.tabId, generation);
    return this.handleInlineNavigation(details, generation);
  }

  public forgetTab(tabId: number): void { this.inlineNavigationGenerations.delete(tabId); }

  private async handleInlineNavigation(details: Pick<chrome.webNavigation.WebNavigationBaseCallbackDetails,
    'tabId' | 'frameId' | 'url'>, generation: number): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.downloadTrapEnabled || !isInlineDocumentUrl(details.url)) return;
    const tab = await chrome.tabs.get(details.tabId);
    const opener = tab.openerTabId === undefined ? undefined : await chrome.tabs.get(tab.openerTabId).catch(() => undefined);
    if (!shouldTrapInlineNavigation({ enabled: settings.downloadTrapEnabled, frameId: details.frameId,
      destination: details.url, ...(tab.url === undefined ? {} : { currentTabUrl: tab.url }),
      ...(opener?.url === undefined ? {} : { openerTabUrl: opener.url }) })) return;
    if (this.inlineNavigationGenerations.get(details.tabId) !== generation) return;
    await chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('blocked/index.html') });
    await this.record('download-blocked');
    await this.notify('download-blocked');
  }

  public async idle(state: 'active' | 'idle' | 'locked'): Promise<void> {
    const settings = await this.getSettings();
    if (shouldTriggerIdleLock({ enabled: settings.idleLockEnabled, browserState: state,
      ecosystemSessionOpen: await this.ecosystemSessionOpen() })) await this.secureLogoff('idle-lock');
  }

  public async handleAlarm(name: string): Promise<void> {
    if (name !== CLIPBOARD_EXPIRY_ALARM) return;
    await this.session.remove(CLIPBOARD_KEY);
    await this.refreshClipboardProtection();
  }

  /** Re-evaluates sender-specific clipboard decisions in every already-open page. */
  public async refreshClipboardProtection(): Promise<void> { await this.broadcast(); }

  private async secureLogoff(kind: 'idle-lock' | 'secure-logoff'): Promise<GuardResponse> {
    if (this.busy) return { ok: false, error: 'operation-busy' };
    this.busy = true;
    this.lifecycle.lock();
    try {
      await this.lifecycle.secureLogoff();
      const tabs = await chrome.tabs.query({});
      const ids = tabs.filter((tab) => tab.id !== undefined && isEcosystemUrl(tab.url)).map((tab) => tab.id!);
      if (ids.length > 0) await chrome.tabs.remove(ids);
      await this.clearEcosystemData();
      await this.session.remove(CLIPBOARD_KEY);
      await chrome.alarms.clear(CLIPBOARD_EXPIRY_ALARM);
      const settings = await this.getSettings();
      settings.apiBlockingEnabled = false;
      await writeGuardSettings(this.local, settings);
      await this.broadcast();
      await this.record(kind);
      await this.notify(kind);
      return { ok: true, guard: await this.getSettings() };
    } catch { return { ok: false, error: 'guard-operation-failed' }; }
    finally { this.lifecycle.unlock(); this.busy = false; }
  }

  private async clearEcosystemData(): Promise<void> {
    const failures: unknown[] = [];
    for (const domain of SESSION_ROOT_DOMAINS) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        const removals = await Promise.allSettled(cookies.map((cookie) => chrome.cookies.remove({
          url: cookieUrl(cookie), name: cookie.name,
          ...(cookie.storeId === undefined ? {} : { storeId: cookie.storeId }),
        })));
        for (const removal of removals) if (removal.status === 'rejected') failures.push(removal.reason);
      } catch (error) { failures.push(error); }
    }
    try {
      await chrome.browsingData.remove({ origins: [...SESSION_ORIGINS] }, { cookies: true,
        localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true });
    } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new AggregateError(failures, 'Ecosystem data cleanup was incomplete.');
  }

  private async getSettings(): Promise<GuardSettings> {
    return this.settings ??= await readGuardSettings(this.local);
  }

  private async activity(): Promise<GuardActivityEntry[]> {
    const result = await this.local.get(ACTIVITY_KEY);
    const value = result[ACTIVITY_KEY];
    return Array.isArray(value) ? value as GuardActivityEntry[] : [];
  }

  private async record(kind: GuardActivityKind, url?: string, originOnly = false): Promise<void> {
    const entries = await this.activity();
    await this.local.set({ [ACTIVITY_KEY]: prependBoundedActivity(entries,
      createGuardActivity({ kind, url, originOnly })) });
  }

  private async clipboardState(): Promise<SensitiveClipboardState | undefined> {
    const result = await this.session.get(CLIPBOARD_KEY);
    const state = result[CLIPBOARD_KEY] as SensitiveClipboardState | undefined;
    if (!isSensitiveClipboardActive(state, Date.now())) {
      if (state !== undefined) await this.session.remove(CLIPBOARD_KEY);
      return undefined;
    }
    return state;
  }

  private async ecosystemSessionOpen(): Promise<boolean> {
    return (await chrome.tabs.query({})).some((tab) => isEcosystemUrl(tab.url));
  }

  private async applyRules(): Promise<void> {
    const settings = await this.getSettings();
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const update = guardRuleUpdate(settings.isEnabled, existing,
      chrome.runtime.getURL('blocked/index.html'), chrome.runtime.id);
    await chrome.declarativeNetRequest.updateDynamicRules(update as chrome.declarativeNetRequest.UpdateRuleOptions);
  }

  private async applyIdle(): Promise<void> {
    const settings = await this.getSettings();
    chrome.idle.setDetectionInterval(idleDetectionSeconds(settings.idleLockMinutes));
  }

  private async broadcast(): Promise<void> {
    const settings = await this.getSettings();
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] :
      chrome.tabs.sendMessage(tab.id, { type: 'inheritiguard:settings', settings: {
        protection: settings.isEnabled, sensitiveApi: settings.apiBlockingEnabled,
        clipboard: settings.clipboardGuardEnabled,
      } }).catch(() => undefined)));
  }

  private async notify(kind: GuardActivityKind): Promise<void> {
    const messages: Record<GuardActivityKind, string> = {
      'navigation-blocked': 'A navigation to an untrusted site was blocked.',
      'clipboard-blocked': 'A protected clipboard operation was blocked.',
      'download-blocked': 'A risky download was blocked.',
      'csp-violation': 'A page security policy violation was observed.',
      'sensitive-api-blocked': 'A sensitive browser API was blocked.',
      'idle-lock': 'Inheriti sessions were cleared after inactivity.',
      'secure-logoff': 'Inheriti sessions and scoped site data were cleared.',
    };
    await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png',
      title: 'InheritiGuard', message: messages[kind] }).catch(() => undefined);
  }
}

export function cookieUrl(cookie: Pick<chrome.cookies.Cookie, 'domain' | 'path' | 'secure'>): string {
  return `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./u, '')}${cookie.path || '/'}`;
}
