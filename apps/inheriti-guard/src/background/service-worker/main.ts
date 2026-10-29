import { collectPageSummary } from '../page-inspection.js';
import { cancelPageFieldPicker } from '../page-picker.js';
import { PendingTabContextStore } from '../pending-tab-context.js';
import { isGuardContentRequest, isGuardRequest, isOverlayRequest, isSidePanelRequest, type SidePanelRequest, type SidePanelResponse } from '../../shared/messages.js';
import { SessionStorageOperatorSessionStore } from '../session-store.js';
import { loadPlanAssets } from '../plans.js';
import { BUSINESS_DEPLOYMENTS, businessUiRpId } from '@safetech/inheriti-elements-core/browser';
import { resolveConfiguration } from '../../shared/configuration.js';
import { ChromeRevealController, isRevealDeadline } from '../reveal.js';
import { SafeKeyProPanelBridge } from '../safekey-pro-bridge.js';
import { choosePreparedCustodianInOverlay } from '../overlay-custodian-choice.js';
import { readStoredConfiguration } from '../../shared/stored-configuration.js';
import { OverlayPermissionController, secureOrigin } from '../overlay-permissions.js';
import { createAccountRuntime } from './accounts.js';
import { createAccessRuntime } from './access.js';
import { GuardController } from '../guard/controller.js';

const pendingContext = new PendingTabContextStore();
// Session-scoped, and unreachable from a content script. Never `chrome.storage.local`.
const sessions = new SessionStorageOperatorSessionStore(chrome.storage.session);
let keyOwner: 'Application' | 'Organisation' = 'Application';
const overlayPermissions = new OverlayPermissionController();
const pendingSignIns = new Set<AbortController>();
const account = createAccountRuntime({ sessions, pendingContext, overlayPermissions, pendingSignIns, localStorage: chrome.storage.local,
  getReveal: () => reveal, setKeyOwner: (owner) => { keyOwner = owner; } });
const proPanel = new SafeKeyProPanelBridge(() => { if (reveal.current().kind === 'RUNNING') reveal.cancel(); });
const reveal = new ChromeRevealController(account.core, chrome.storage.session, () => keyOwner, async (signal, batch) => {
  const configuration = resolveConfiguration(await readStoredConfiguration(chrome.storage.local, chrome.storage.session));
  if (configuration.applicationId !== undefined) return undefined;
  const deployment = (Object.keys(BUSINESS_DEPLOYMENTS) as Array<keyof typeof BUSINESS_DEPLOYMENTS>)
    .find((key) => BUSINESS_DEPLOYMENTS[key].apiUrl === configuration.apiUrl);
  if (!deployment) return undefined;
  return {
    selectCustodianDevice: () => batch
      ? choosePreparedCustodianInOverlay(batch, signal, (requestSignal) => proPanel.prepare(requestSignal))
      : proPanel.choose(signal),
    proDevice: proPanel.device(businessUiRpId(deployment)),
    finish: () => proPanel.finish(),
  };
}, { storage: chrome.storage.local, owner: async () => {
  const session = await sessions.load();
  const configuration = resolveConfiguration(await readStoredConfiguration(chrome.storage.local, chrome.storage.session));
  const organizationId = await account.selectedOrganization(configuration);
  return session?.principal.issuer && session.principal.subject && organizationId
    ? { issuer: session.principal.issuer, subject: session.principal.subject, organizationId } : undefined;
} }, async (origin) => (await overlayPermissions.state(origin)).currentEnabled);

let lifecycleLocked = false;
const guard = new GuardController({
  lock() {
    lifecycleLocked = true;
    for (const pending of pendingSignIns) pending.abort();
  },
  async secureLogoff() {
    await reveal.shutdown();
    await account.forgetHeldCore();
    try { await account.revokeAllSessions(); }
    finally { await sessions.clearAll(); }
    pendingContext.clear();
    organizationRevision += 1;
    await overlayPermissions.hideAll().catch(() => undefined);
  },
  unlock() { lifecycleLocked = false; },
}, chrome.storage.local, chrome.storage.session);

let organizationRevision = 0;
let organizationSwitching = false;
let activeWork = 0;
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || tab.windowId === undefined || tab.url === undefined) return;
  if (pendingContext.set(tab.id, tab.url) === undefined) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined) {
    pendingContext.invalidateForNavigation(tabId, changeInfo.url);
    reveal.cancelBatchForTab(tabId);
  }
  if (changeInfo.url !== undefined) void guard.navigation(changeInfo.url).catch(() => undefined);
  if (changeInfo.url !== undefined) void guard.refreshClipboardProtection().catch(() => undefined);
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (!reveal.ownsBatchInOtherWindow(windowId)) pendingContext.invalidateForTabChange(tabId);
  reveal.cancelBatchOnTabChange(tabId, windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingContext.invalidateTab(tabId);
  reveal.cancelBatchForTab(tabId);
  guard.forgetTab(tabId);
  void guard.refreshClipboardProtection().catch(() => undefined);
});

chrome.tabs.onCreated.addListener(() => { void guard.refreshClipboardProtection().catch(() => undefined); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (isRevealDeadline(alarm.name)) void reveal.closeAbandoned();
  void guard.handleAlarm(alarm.name).catch(() => undefined);
});

chrome.idle?.onStateChanged.addListener((state) => { void guard.idle(state).catch(() => undefined); });
chrome.downloads?.onCreated.addListener((item) => { void guard.download(item).catch(() => undefined); });
chrome.webNavigation?.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    pendingContext.invalidateForNavigation(details.tabId, details.url);
    reveal.cancelBatchForTab(details.tabId);
  }
  void guard.inlineNavigation(details).catch(() => undefined);
});

// A persisted id means a previous worker vanished with an open reveal. Plaintext was memory-only and
// is already gone, but the reveal itself is not: the gates a person is answering right now still hold
// it open. Only an expired one is closed; a live one is offered back to the panel to be resumed.
const revealRecovery = reveal.recoverAbandoned().catch(() => undefined);
const access = createAccessRuntime({ pendingContext, reveal, guard, overlayPermissions, core: account.core,
  revealRecovery, getOrganizationRevision: () => organizationRevision });
void guard.initialize().catch(() => undefined);
if ((chrome as typeof chrome & { permissions?: chrome.permissions.Permissions }).permissions !== undefined) {
  void overlayPermissions.restore();
  chrome.permissions.onRemoved.addListener((removed) => {
    pendingContext.clearDraft();
    for (const pattern of removed.origins ?? []) {
      const origin = secureOrigin(pattern);
      if (origin) reveal.cancelBatchForOrigin(origin);
    }
    void overlayPermissions.permissionRemoved(removed.origins ?? []);
  });
}

chrome.runtime.onConnect.addListener((port) => proPanel.attach(port));

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  // Opening the side panel spends the page's user gesture, which does not survive an await. It is
  // answered here, before anything asynchronous, and shows only this extension's own UI.
  if ((message as { type?: unknown })?.type === 'overlay-open-side-panel') {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) { sendResponse({ ok: false, error: 'stale-page-context' }); return false; }
    chrome.sidePanel.open({ windowId }).catch(() => undefined);
    sendResponse({ ok: true, discarded: true });
    return false;
  }
  if (isOverlayRequest(message)) {
    if (lifecycleLocked || organizationSwitching) { sendResponse({ ok: false, error: 'operation-busy' }); return false; }
    const revision = organizationRevision;
    activeWork += 1;
    access.respondOverlay(message, sender).then((result) => {
      const response = revision === organizationRevision ? result : { ok: false, error: 'stale-page-context' };
      activeWork -= 1;
      sendResponse(response);
    }, () => { activeWork -= 1; sendResponse({ ok: false, error: 'stale-page-context' }); });
    return true;
  }
  if (isGuardContentRequest(message)) {
    if (sender.tab === undefined) return false;
    guard.respondContent(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'invalid-request' }));
    return true;
  }
  if (isGuardRequest(message)) {
    if (sender.tab !== undefined) return false;
    guard.respond(message).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'guard-operation-failed' }));
    return true;
  }
  if (!isSidePanelRequest(message) || sender.tab !== undefined) return false;
  if (lifecycleLocked || organizationSwitching) { sendResponse({ ok: false, error: 'operation-busy' }); return false; }

  const transition = ['select-organization', 'select-account-organization', 'switch-account',
    'remove-account', 'sign-in', 'sign-out'].includes(message.type);
  // Key status is a token-free read; its stale response is fenced by the revision below.
  const tracksOldAccountWork = !transition && message.type !== 'get-master-key-status';
  // A context change must wait for reads and fills that still belong to the old account.
  if (transition && activeWork > 0) { sendResponse({ ok: false, error: 'operation-busy' }); return false; }
  if (transition) { organizationSwitching = true; organizationRevision += 1; }
  if (tracksOldAccountWork) activeWork += 1;
  const revision = organizationRevision;
  const pending = respond(message, revision);
  pending.then((result) => {
    const response = revision === organizationRevision ? result : { ok: false, error: 'stale-page-context' };
    if (transition) organizationSwitching = false;
    if (tracksOldAccountWork) activeWork -= 1;
    sendResponse(response);
  }, () => {
    if (transition) organizationSwitching = false;
    if (tracksOldAccountWork) activeWork -= 1;
    sendResponse({ ok: false, error: 'no-active-tab' } satisfies SidePanelResponse);
  });
  return true;
});

async function respond(request: SidePanelRequest, admittedRevision: number): Promise<SidePanelResponse> {
  const type = request.type;
  // An older panel must not act on a profile selected by another panel.
  if (type !== 'load-plans' && request.expectedGeneration !== undefined
    && request.expectedGeneration !== (await sessions.snapshot()).generation) {
    return { ok: false, error: 'stale-page-context' };
  }
  if (admittedRevision !== organizationRevision || lifecycleLocked) return { ok: false, error: 'stale-page-context' };
  if (type === 'switch-account' || type === 'select-account-organization') {
    return account.switchAccount(request.accountId, type === 'select-account-organization' ? request.organizationId : undefined);
  }
  if (type === 'remove-account') return account.removeAccount(request.accountId);
  if (type === 'get-master-key-status') return account.masterKeyStatus();
  if (type === 'select-organization') return account.selectOrganization(request.organizationId);
  if (type === 'sign-in' || type === 'sign-out') {
    await account.closeAccountContext();
    if (admittedRevision !== organizationRevision || lifecycleLocked) return { ok: false, error: 'stale-page-context' };
    return { ok: true, state: await account.withAccounts(await account.panelState(type)) };
  }
  if (type === 'load-plans' || type === 'forget-master-key') {
    return { ok: true, state: await account.withAccounts(await account.panelState(type)) };
  }
  if (type === 'get-reveal-state') return { ok: true, reveal: reveal.current() };
  if (type === 'cancel-reveal') return { ok: true, reveal: reveal.cancel() };
  if (type === 'resume-reveal') return { ok: true, reveal: await reveal.resume() };
  if (type === 'abort-plan-access') return { ok: true, reveal: await reveal.abortPlanAccess(request.planId) };
  if (type === 'get-overlay-permissions' || type === 'enable-overlay-current-origin'
    || type === 'disable-overlay-origin' || type === 'disable-all-overlays') {
    return respondOverlayPermissions(request);
  }
  if (type === 'discard-access-workspace') {
    pendingContext.clearDraft();
    return { ok: true, discarded: true };
  }
  if (type === 'cancel-page-field-picker') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return { ok: false, error: 'stale-page-context' };
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: cancelPageFieldPicker });
      return result?.result ? access.batchResponse(tab.id) : { ok: false, error: 'picker-canceled' };
    } catch { return { ok: false, error: 'stale-page-context' }; }
  }
  if (type === 'load-plan-assets') {
    try {
      return { ok: true, assets: await loadPlanAssets(await account.core(), request.planId) };
    } catch {
      return { ok: false, error: 'plan-request-failed' };
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return { ok: false, error: 'no-active-tab' };
  if (type !== 'get-active-context' && !await guard.allowsPlanAccess(tab.url)) {
    return { ok: false, error: 'guard-denied' };
  }

  // Chrome can reopen a remembered side panel from its own side-panel button without firing
  // action.onClicked. Resolve that legitimate panel entry from the currently active tab as well.
  const context = pendingContext.get(tab.id) ?? pendingContext.set(tab.id, tab.url);
  if (context === undefined) return { ok: false, error: 'stale-tab-context' };
  if (type === 'get-active-context') return { ok: true, context: { origin: context.origin } };
  if (type === 'load-access-workspace') return access.loadAccessWorkspace(request.planId, tab.id, context.origin);
  if (type === 'load-page-first-candidates') return access.loadPageFirstCandidates(tab.id, context.origin);
  if (type === 'start-page-first-picker') return access.startPageFirstPicker(tab.id, context.origin);
  if (type === 'select-page-first-candidate') return access.selectPageFirstCandidate(tab.id, context.origin, request.mapping, request.planName);
  if (type === 'set-access-mapping') return access.setAccessMapping(tab.id, request.mapping);
  if (type === 'remove-access-mapping') {
    const draft = pendingContext.getDraft(tab.id);
    if (draft === undefined) return { ok: false, error: 'stale-page-context' };
    return { ok: true, batch: pendingContext.updateMappings(tab.id,
      draft.mappings.filter((mapping) => mapping.protectedField.selector !== request.selector))! };
  }
  if (type === 'start-page-field-picker') return access.startPicker(tab.id, request.protectedField);
  if (type === 'reveal-and-autofill') return access.revealAndAutofill(tab.id, request.batch.identity.origin, request.batch);
  if (type === 'load-reveal-fields') {
    try {
      return { ok: true, reveal: await reveal.fields(request.planId, context.origin) };
    } catch {
      return { ok: false, error: 'plan-request-failed' };
    }
  }
  if (type === 'fill-field') {
    return { ok: true, reveal: await reveal.fill({
      planId: request.planId,
      selector: request.selector,
      origin: context.origin,
      tabId: tab.id,
    }) };
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageSummary,
  });
  const summary = injection?.result;
  if (summary === undefined || summary.origin !== context.origin) return { ok: false, error: 'unsupported-page' };
  return { ok: true, summary };
}

async function respondOverlayPermissions(request: Extract<SidePanelRequest, { type:
  'get-overlay-permissions' | 'enable-overlay-current-origin' | 'disable-overlay-origin' | 'disable-all-overlays' }>): Promise<SidePanelResponse> {
  const type = request.type;
  if (type === 'disable-overlay-origin') reveal.cancelBatchForOrigin(request.origin);
  if (type === 'disable-all-overlays') reveal.cancelActiveBatch();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tab?.url;
  const overlay = type === 'enable-overlay-current-origin' && currentUrl !== undefined
    ? await overlayPermissions.enable(currentUrl)
    : type === 'disable-overlay-origin'
      ? await overlayPermissions.disable(request.origin, currentUrl)
      : type === 'disable-all-overlays'
        ? await overlayPermissions.disableAll(currentUrl)
        : await overlayPermissions.state(currentUrl);
  if ((type === 'disable-overlay-origin' && secureOrigin(currentUrl) === secureOrigin(request.origin))
    || type === 'disable-all-overlays') pendingContext.clearDraft();
  return { ok: true, overlay };
}
