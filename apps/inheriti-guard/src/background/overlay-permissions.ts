const SCRIPT_PREFIX = 'inheriti-elements-overlay-';
const SCRIPT_FILE = 'content/overlay.js';

export interface OverlayPermissionState {
  readonly currentOrigin?: string;
  readonly currentEnabled: boolean;
  readonly enabledOrigins: readonly string[];
}

/** Owns optional exact-origin access and nothing about reveal or mapping state. */
export class OverlayPermissionController {
  private readonly authorizedThisWorker = new Set<string>();
  public async state(currentUrl?: string): Promise<OverlayPermissionState> {
    const currentOrigin = secureOrigin(currentUrl);
    const enabledOrigins = await this.enabledOrigins();
    return {
      ...(currentOrigin === undefined ? {} : { currentOrigin }),
      currentEnabled: currentOrigin !== undefined && enabledOrigins.includes(currentOrigin),
      enabledOrigins,
    };
  }

  public async enable(currentUrl: string): Promise<OverlayPermissionState> {
    const origin = secureOrigin(currentUrl);
    if (origin === undefined) return this.state(currentUrl);
    // The actual request must run directly in the side panel's click handler so Chrome retains
    // user activation. The worker only accepts and reconciles a grant Chrome already owns.
    const granted = await chrome.permissions.contains({ origins: [patternOf(origin)] });
    if (granted) { this.authorizedThisWorker.add(origin); await this.register(origin); }
    return this.state(currentUrl);
  }

  public async disable(origin: string, currentUrl?: string): Promise<OverlayPermissionState> {
    const secure = secureOrigin(origin);
    if (secure !== undefined) {
      await this.teardown(secure);
      await this.unregister(secure);
      this.authorizedThisWorker.delete(secure);
      // A required broad host grant cannot be removed as an optional exact grant.
      await chrome.permissions.remove({ origins: [patternOf(secure)] }).catch(() => undefined);
    }
    return this.state(currentUrl);
  }

  public async disableAll(currentUrl?: string): Promise<OverlayPermissionState> {
    const origins = await this.enabledOrigins();
    await Promise.all(origins.map((origin) => this.teardown(origin)));
    await this.unregisterAll();
    this.authorizedThisWorker.clear();
    await Promise.all(origins.map((origin) =>
      chrome.permissions.remove({ origins: [patternOf(origin)] }).catch(() => undefined)));
    return this.state(currentUrl);
  }

  /**
   * Reconciles registrations with Chrome's permission store after worker/browser restart.
   *
   * Registrations persist across sessions, so this drops the ones whose permission is gone and adds
   * the ones that are missing. It must never re-register what is already there: every registration
   * injects the overlay again, and a worker wakes often enough to stack one instance per wake.
   */
  public async restore(): Promise<void> {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const granted = await chrome.permissions.getAll();
    const exactGrants = (granted.origins ?? []).map(originFromPattern)
      .filter((one): one is string => one !== undefined);
    const registeredOrigins = registered.filter(({ id }) => id.startsWith(SCRIPT_PREFIX))
      .flatMap(({ matches }) => matches ?? []).map(originFromPattern)
      .filter((one): one is string => one !== undefined);
    // Before Guard's broad host grant, exact optional grants were authority. Afterwards the
    // persisted exact registrations are authority because <all_urls> must not enable overlays.
    const origins = [...new Set([...this.authorizedThisWorker,
      ...(exactGrants.length > 0 ? exactGrants : registeredOrigins)])].sort();
    const wanted = new Set(origins.map((origin) => registrationId(origin)));
    const stale = registered.map(({ id }) => id).filter((id) => id.startsWith(SCRIPT_PREFIX) && !wanted.has(id));
    if (stale.length > 0) await chrome.scripting.unregisterContentScripts({ ids: stale });
    await Promise.all(origins.map((origin) => this.register(origin)));
  }

  /** Removes live UI on sign-out without silently revoking the operator's browser permission. */
  public async hideAll(): Promise<void> {
    const origins = await this.enabledOrigins();
    await Promise.all(origins.map((origin) => this.teardown(origin)));
    await this.unregisterAll();
  }

  public async permissionRemoved(patterns: readonly string[]): Promise<void> {
    const origins = patterns.map(originFromPattern).filter((one): one is string => one !== undefined);
    await Promise.all(origins.map(async (origin) => {
      await this.teardown(origin);
      await this.unregister(origin);
      this.authorizedThisWorker.delete(origin);
    }));
  }

  private async enabledOrigins(): Promise<string[]> {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const granted = await chrome.permissions.getAll();
    // A persisted, worker-owned overlay registration is exact-origin authorization. Broad Guard
    // host access is deliberately never consulted here.
    return [...new Set([...this.authorizedThisWorker,
      ...(granted.origins ?? []).map(originFromPattern).filter((one): one is string => one !== undefined),
      ...registered.filter(({ id }) => id.startsWith(SCRIPT_PREFIX))
      .flatMap(({ matches }) => matches ?? [])
      .map(originFromPattern).filter((one): one is string => one !== undefined)])].sort();
  }

  private async register(origin: string): Promise<void> {
    const id = registrationId(origin);
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (registered.length > 0) return;
    await chrome.scripting.registerContentScripts([{
      id,
      matches: [patternOf(origin)],
      js: [SCRIPT_FILE],
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    }]);
    const tabs = await chrome.tabs.query({ url: [patternOf(origin)] });
    await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [
      chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: [SCRIPT_FILE] }).catch(() => undefined),
    ]));
  }

  private async unregister(origin: string): Promise<void> {
    const id = registrationId(origin);
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    if (registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }

  private async unregisterAll(): Promise<void> {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered.map(({ id }) => id).filter((id) => id.startsWith(SCRIPT_PREFIX));
    if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
  }

  private async teardown(origin: string): Promise<void> {
    const tabs = await chrome.tabs.query({ url: [patternOf(origin)] });
    await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [
      chrome.tabs.sendMessage(tab.id, { type: 'inheriti-overlay-teardown' }).catch(() => undefined),
    ]));
  }
}

export function secureOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' ? url.origin : undefined;
  } catch { return undefined; }
}

export function patternOf(origin: string): string { return `${secureOrigin(origin) ?? 'invalid:'}/*`; }

function originFromPattern(pattern: string): string | undefined {
  if (!pattern.startsWith('https://') || !pattern.endsWith('/*') || pattern.slice(8, -2).includes('*')) return undefined;
  return secureOrigin(pattern.slice(0, -2));
}

function registrationId(origin: string): string {
  let hash = 2166136261;
  for (const character of origin) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${SCRIPT_PREFIX}${(hash >>> 0).toString(16)}`;
}
