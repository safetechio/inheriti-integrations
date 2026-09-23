import { collectPageSummary, discoverPageFields, scopePageFields, type DiscoveredPageField } from './page-inspection.js';
import { cancelPageFieldPicker, pickPageField } from './page-picker.js';
import { PendingTabContextStore } from './pending-tab-context.js';
import { isGuardContentRequest, isGuardRequest, isOverlayRequest, isSidePanelRequest, type OverlayRequest, type SidePanelResponse } from '../shared/messages.js';
import { SessionStorageOperatorSessionStore } from './session-store.js';
import { signIn } from './auth.js';
import { createCore, loadPlanAssets, loadPlans } from './plans.js';
import { BUSINESS_DEPLOYMENTS, businessUiRpId, type BrowserIntegrationCore, type BusinessOrganization } from '@safetech/inheriti-elements-core/browser';
import { resolveConfiguration, type ChromeConfiguration } from '../shared/configuration.js';
import { codeOf, type PanelState } from '../shared/plan-view.js';
import { ChromeRevealController, isRevealDeadline } from './reveal.js';
import { SafeKeyProPanelBridge } from './safekey-pro-bridge.js';
import { readBusinessOrganization, readStoredConfiguration, writeBusinessOrganization } from '../shared/stored-configuration.js';
import { suggestFieldMappings } from './field-suggestions.js';
import { pageFirstSuggestions } from './page-first-suggestions.js';
import { validateAccessBatch, type AccessBatch, type FieldMapping, type ProtectedFieldRef } from '../shared/access-contract.js';
import { OverlayPermissionController, secureOrigin } from './overlay-permissions.js';
import { GuardController } from './guard/controller.js';

const pendingContext = new PendingTabContextStore();
// Session-scoped, and unreachable from a content script. Never `chrome.storage.local`.
const sessions = new SessionStorageOperatorSessionStore(chrome.storage.session);
let keyOwner: 'Application' | 'Organisation' = 'Application';
const proPanel = new SafeKeyProPanelBridge(() => { if (reveal.current().kind === 'RUNNING') reveal.cancel(); });
const reveal = new ChromeRevealController(core, chrome.storage.session, () => keyOwner, async (signal) => {
  const configuration = resolveConfiguration(await readStoredConfiguration(chrome.storage.local, chrome.storage.session));
  if (configuration.applicationId !== undefined) return undefined;
  const deployment = (Object.keys(BUSINESS_DEPLOYMENTS) as Array<keyof typeof BUSINESS_DEPLOYMENTS>)
    .find((key) => BUSINESS_DEPLOYMENTS[key].apiUrl === configuration.apiUrl);
  if (!deployment) return undefined;
  return {
    selectCustodianDevice: () => proPanel.choose(signal),
    proDevice: proPanel.device(businessUiRpId(deployment)),
    finish: () => proPanel.finish(),
  };
});
const overlayPermissions = new OverlayPermissionController();
let lifecycleLocked = false;
const pendingSignIns = new Set<AbortController>();
const guard = new GuardController({
  lock() {
    lifecycleLocked = true;
    for (const pending of pendingSignIns) pending.abort();
  },
  async secureLogoff() {
    await reveal.shutdown();
    if (heldCore !== undefined) await heldCore.value.forgetMasterKey().catch(() => undefined);
    heldCore = undefined;
    await sessions.clear();
    pendingContext.clearDraft();
    await overlayPermissions.hideAll().catch(() => undefined);
  },
  unlock() { lifecycleLocked = false; },
}, chrome.storage.local, chrome.storage.session);

/**
 * Configuration from the options page, or from the harness when it wrote it into the session area.
 *
 * Held for the life of this worker rather than rebuilt per message. The client is where the acquired
 * Application key lives, so a fresh one for every message meant a relayed key was asked of the
 * owner's phone again on each reveal, and `forgetMasterKey` dropped a key nothing else could see. A
 * configuration change — or a sign-out, which must not leave the previous operator's key behind —
 * replaces it.
 */
let heldCore: { readonly key: string; readonly value: BrowserIntegrationCore } | undefined;
let organizationRevision = 0;
let organizationSwitching = false;

async function core(organizationId?: string) {
  const stored = await readStoredConfiguration(chrome.storage.local, chrome.storage.session);
  const configuration = resolveConfiguration(stored);
  keyOwner = configuration.applicationId === undefined ? 'Organisation' : 'Application';
  const selected = configuration.applicationId === undefined
    ? organizationId ?? await selectedOrganization(configuration)
    : undefined;
  const principal = (await sessions.load())?.principal;
  const key = JSON.stringify([configuration, selected, principal?.issuer, principal?.subject]);
  if (heldCore?.key !== key) heldCore = { key, value: createCore(configuration, sessions, undefined, selected) };
  return heldCore.value;
}

async function organizationPreference(configuration: ChromeConfiguration): Promise<string | undefined> {
  if (configuration.applicationId !== undefined) return undefined;
  const session = await sessions.load();
  if (!session?.principal.subject) return undefined;
  return JSON.stringify([configuration.issuer, configuration.environment, session.principal.subject]);
}

async function selectedOrganization(configuration: ChromeConfiguration): Promise<string | undefined> {
  const key = await organizationPreference(configuration);
  return key === undefined ? undefined : readBusinessOrganization(chrome.storage.local, key);
}

async function saveOrganization(configuration: ChromeConfiguration, organizationId?: string): Promise<void> {
  const key = await organizationPreference(configuration);
  if (key !== undefined) await writeBusinessOrganization(chrome.storage.local, key, organizationId);
}

async function businessSelection(): Promise<{ organizations: BusinessOrganization[]; organizationId: string } | PanelState | undefined> {
  const configuration = resolveConfiguration(await readStoredConfiguration(chrome.storage.local, chrome.storage.session));
  if (await organizationPreference(configuration) === undefined) return undefined;
  const discovery = createCore(configuration, sessions);
  const organizations = await discovery.listOrganizations();
  const saved = await selectedOrganization(configuration);
  if (saved && organizations.some(({ id }) => id === saved)) return { organizations, organizationId: saved };
  if (saved) await saveOrganization(configuration);
  if (!saved && organizations.length === 1) {
    await saveOrganization(configuration, organizations[0]!.id);
    return { organizations, organizationId: organizations[0]!.id };
  }
  return { kind: 'SELECT_ORGANIZATION', organizations,
    ...(saved ? { reason: 'The saved organization is no longer available.' } : {}) };
}

async function panelState(action: 'sign-in' | 'sign-out' | 'load-plans' | 'forget-master-key'): Promise<PanelState> {
  try {
    if (action === 'sign-out') {
      for (const pending of pendingSignIns) pending.abort();
      await reveal.shutdown();
      pendingContext.clearDraft();
      if (heldCore !== undefined) await heldCore.value.forgetMasterKey().catch(() => undefined);
      heldCore = undefined;
      await sessions.clear();
      await overlayPermissions.hideAll().catch(() => undefined);
      return { kind: 'SIGNED_OUT' };
    }
    if (action === 'sign-in') {
      // Keep a canceled OAuth window as the sole attempt until it settles. Otherwise an old token
      // exchange could finish after a newer sign-in and overwrite (or clear) the newer session.
      if (pendingSignIns.size > 0) return { kind: 'ERROR', code: 'login_cancelled' };
      const pending = new AbortController();
      pendingSignIns.add(pending);
      try {
        const client = await core();
        try {
          await signIn(client.auth, pending.signal);
        } catch (error) {
          return { kind: 'ERROR', code: codeOf(error, 'sign_in_failed') };
        }
        if (pending.signal.aborted) return { kind: 'SIGNED_OUT' };
        await overlayPermissions.restore();
        return await selectedPlans(client);
      } finally {
        // The token exchange may already have been in flight when logoff invalidated this attempt.
        // Clear anything it wrote after the coordinator's first session clear.
        if (pending.signal.aborted) {
          await sessions.clear();
          heldCore = undefined;
        }
        pendingSignIns.delete(pending);
      }
    }
    const client = await core();
    // The Application key is acquired once and held for the life of this worker, so a second reveal
    // never asks the owner's phone again. This gives that up, and is the only way to make the next
    // reveal acquire it from scratch. The session is untouched: this locks the key, not the operator.
    if (action === 'forget-master-key') {
      await client.forgetMasterKey();
      return await selectedPlans(client);
    }
    return await selectedPlans(client);
  } catch (error) {
    return { kind: 'ERROR', code: codeOf(error) };
  }
}

async function selectedPlans(client: BrowserIntegrationCore): Promise<PanelState> {
  if (!(await client.getAccessToken())) return { kind: 'SIGNED_OUT' };
  const selection = await businessSelection();
  if (selection && 'kind' in selection) return selection;
  if (selection && 'organizationId' in selection) {
    return { ...await loadPlans(await core(selection.organizationId)), ...selection };
  }
  return loadPlans(client);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined || tab.windowId === undefined || tab.url === undefined) return;
  if (pendingContext.set(tab.id, tab.url) === undefined) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined) pendingContext.invalidateForNavigation(tabId, changeInfo.url);
  if (changeInfo.url !== undefined) void guard.navigation(changeInfo.url).catch(() => undefined);
  if (changeInfo.url !== undefined) void guard.refreshClipboardProtection().catch(() => undefined);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  pendingContext.invalidateForTabChange(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingContext.invalidateTab(tabId);
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
  void guard.inlineNavigation(details).catch(() => undefined);
});

// A persisted id means a previous worker vanished with an open reveal. Plaintext was memory-only and
// is already gone, but the reveal itself is not: the gates a person is answering right now still hold
// it open. Only an expired one is closed; a live one is offered back to the panel to be resumed.
void reveal.recoverAbandoned();
void guard.initialize().catch(() => undefined);
if ((chrome as typeof chrome & { permissions?: chrome.permissions.Permissions }).permissions !== undefined) {
  void overlayPermissions.restore();
  chrome.permissions.onRemoved.addListener((removed) => {
    pendingContext.clearDraft();
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
    respondOverlay(message, sender).then((result) => sendResponse(revision === organizationRevision ? result : { ok: false, error: 'stale-page-context' }))
      .catch(() => sendResponse({ ok: false, error: 'stale-page-context' }));
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

  const revision = organizationRevision;
  respond(message).then((result) => sendResponse(message.type === 'select-organization' || revision === organizationRevision
    ? result : { ok: false, error: 'stale-page-context' })).catch(() => {
    sendResponse({ ok: false, error: 'no-active-tab' } satisfies SidePanelResponse);
  });
  return true;
});

async function respond(request: import('../shared/messages.js').SidePanelRequest): Promise<SidePanelResponse> {
  const type = request.type;
  if (type === 'select-organization') {
    if (typeof request.organizationId !== 'string' || !request.organizationId || request.organizationId.length > 255)
      return { ok: false, error: 'plan-request-failed' };
    organizationSwitching = true;
    try {
      const configuration = resolveConfiguration(await readStoredConfiguration(chrome.storage.local, chrome.storage.session));
      if (await organizationPreference(configuration) === undefined) return { ok: false, error: 'plan-request-failed' };
      const organizations = await createCore(configuration, sessions).listOrganizations();
      if (!organizations.some(({ id }) => id === request.organizationId)) return { ok: false, error: 'plan-request-failed' };
      organizationRevision += 1;
      await reveal.shutdown();
      pendingContext.clearDraft();
      heldCore = undefined;
      await saveOrganization(configuration, request.organizationId);
      return { ok: true, state: await panelState('load-plans') };
    } finally { organizationSwitching = false; }
  }
  if (type === 'sign-in' || type === 'sign-out' || type === 'load-plans' || type === 'forget-master-key') {
    return { ok: true, state: await panelState(type) };
  }
  if (type === 'get-reveal-state') return { ok: true, reveal: reveal.current() };
  if (type === 'cancel-reveal') return { ok: true, reveal: reveal.cancel() };
  if (type === 'resume-reveal') return { ok: true, reveal: await reveal.resume() };
  if (type === 'abort-plan-access') return { ok: true, reveal: await reveal.abortPlanAccess(request.planId) };
  if (type === 'get-overlay-permissions' || type === 'enable-overlay-current-origin'
    || type === 'disable-overlay-origin' || type === 'disable-all-overlays') {
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
  if (type === 'discard-access-workspace') {
    pendingContext.clearDraft();
    return { ok: true, discarded: true };
  }
  if (type === 'cancel-page-field-picker') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return { ok: false, error: 'stale-page-context' };
    try {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: cancelPageFieldPicker });
      return result?.result ? batchResponse(tab.id) : { ok: false, error: 'picker-canceled' };
    } catch { return { ok: false, error: 'stale-page-context' }; }
  }
  if (type === 'load-plan-assets') {
    try {
      return { ok: true, assets: await loadPlanAssets(await core(), request.planId) };
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
  if (type === 'load-access-workspace') return loadAccessWorkspace(request.planId, tab.id, context.origin);
  if (type === 'load-page-first-candidates') return loadPageFirstCandidates(tab.id, context.origin);
  if (type === 'start-page-first-picker') return startPageFirstPicker(tab.id, context.origin);
  if (type === 'select-page-first-candidate') return selectPageFirstCandidate(tab.id, context.origin, request.mapping, request.planName);
  if (type === 'set-access-mapping') return setAccessMapping(tab.id, request.mapping);
  if (type === 'remove-access-mapping') {
    const draft = pendingContext.getDraft(tab.id);
    if (draft === undefined) return { ok: false, error: 'stale-page-context' };
    return { ok: true, batch: pendingContext.updateMappings(tab.id,
      draft.mappings.filter((mapping) => mapping.protectedField.selector !== request.selector))! };
  }
  if (type === 'start-page-field-picker') return startPicker(tab.id, request.protectedField);
  if (type === 'reveal-and-autofill') return revealAndAutofill(tab.id, request.batch.identity.origin, request.batch);
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

async function respondOverlay(request: OverlayRequest, sender: chrome.runtime.MessageSender): Promise<SidePanelResponse> {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId ?? 0;
  const senderLocation = sender.tab?.url ?? sender.origin ?? sender.url;
  const origin = secureOrigin(sender.tab?.url) ?? secureOrigin(sender.origin) ?? secureOrigin(sender.url);
  if (tabId === undefined || origin === undefined
    || !await guard.allowsPlanAccess(sender.tab?.url ?? sender.url)
    || !(await overlayPermissions.state(origin)).currentEnabled) {
    return { ok: false, error: 'stale-page-context' };
  }
  // A permitted cross-origin iframe has its own authoritative origin. Do not replace the toolbar's
  // top-frame context; the worker-owned draft below carries the exact frame/origin identity.
  if (pendingContext.get(tabId) === undefined && senderLocation !== undefined) pendingContext.set(tabId, senderLocation);

  if (request.type === 'overlay-load-candidates') {
    const page = await authoritativeOverlayTarget(tabId, frameId, origin, request.target);
    if (page === undefined) return { ok: false, error: 'stale-page-context' };
    try {
      const client = await core();
      // A page must be able to say "sign in" rather than "nothing matched" when nobody is signed in.
      if (!await client.getAccessToken()) return { ok: false, error: 'signed-out' };
      const plansPage = await client.listPlans({ assetType: 'USER-PSWD' });
      const fixedPlanId = pendingContext.getDraft(tabId)?.identity.planId;
      const summaries = fixedPlanId === undefined ? plansPage.items : plansPage.items.filter(({ id }) => id === fixedPlanId);
      const plans = await Promise.all(summaries.map(async (summary) => ({
        planName: summary.name,
        protectedFields: protectedFieldsOf(await client.getPlan(summary.id) as unknown as WorkspacePlan, summary.id, origin),
      })));
      const draft = pendingContext.getDraft(tabId);
      const candidates = pageFirstSuggestions(plans, [page.target]);
      const emptyReason = summaries.length === 0
        ? fixedPlanId === undefined ? 'no-autofill-plans' : 'selected-plan-unavailable'
        : plans.every(({ protectedFields }) => protectedFields.length === 0) ? 'no-protected-fields' : 'no-matching-field';
      return { ok: true, pageTargets: [page.target], candidates,
        ...(candidates.length === 0 ? { emptyReason } : {}),
        ...(draft === undefined ? {} : { batch: { identity: draft.identity, mappings: draft.mappings } }) };
    } catch (error) {
      // An expired or rejected session is a sign-in answer too, never an empty suggestion list.
      return { ok: false, error: codeOf(error) === 'operator_reauthentication_required' ? 'signed-out' : 'access-request-failed' };
    }
  }

  if (request.type === 'overlay-discard-selection') {
    pendingContext.clearDraft();
    return { ok: true, discarded: true };
  }
  if (request.type === 'overlay-reveal-state') return { ok: true, reveal: reveal.current() };
  if (request.type === 'overlay-cancel-reveal') return { ok: true, reveal: reveal.cancel() };
  if (request.type === 'overlay-resume-reveal') return { ok: true, reveal: await reveal.resume() };

  if (request.type === 'overlay-select-candidate') {
    const page = await authoritativeOverlayTarget(tabId, frameId, origin, request.mapping.pageTarget);
    if (page === undefined || JSON.stringify(page.target) !== JSON.stringify(request.mapping.pageTarget)) {
      return { ok: false, error: 'stale-page-context' };
    }
    const draft = pendingContext.getDraft(tabId);
    if (draft !== undefined) {
      if (draft.identity.planId !== request.mapping.protectedField.planId) return { ok: false, error: 'invalid-access-batch' };
      pendingContext.setDraft({ ...draft, pageTargets: page.pageTargets });
      return setAssetMappings(tabId, { ...request.mapping, source: 'MANUAL' });
    }
    const loaded = await loadOverlayWorkspace(request.mapping.protectedField.planId, page.pageTargets);
    if (!loaded.ok || !('protectedFields' in loaded)) return loaded;
    return setAssetMappings(tabId, { ...request.mapping, source: 'MANUAL' });
  }

  // The side panel opens in the message listener itself, before this async boundary.
  if (request.type !== 'overlay-reveal-and-autofill') return { ok: false, error: 'stale-page-context' };
  const draft = pendingContext.getDraft(tabId);
  if (draft === undefined || JSON.stringify(request.batch) !== JSON.stringify({ identity: draft.identity, mappings: draft.mappings })) {
    return { ok: false, error: 'invalid-access-batch' };
  }
  return revealAndAutofill(tabId, origin, request.batch);
}

async function authoritativeOverlayTarget(
  tabId: number,
  frameId: number,
  origin: string,
  claimed: import('../shared/access-contract.js').PageFieldTarget,
) {
  // The content script cannot know Chrome-owned tab/frame ids. If a caller supplies them they must
  // match, but authority always comes from MessageSender and the content script in that exact frame.
  if ((claimed.tabId !== undefined && claimed.tabId !== tabId)
    || (claimed.frameId !== undefined && claimed.frameId !== frameId) || claimed.origin !== origin) return undefined;
  const discovered = await chrome.tabs.sendMessage(tabId, { type: 'inheriti-overlay-discover-targets' }, { frameId })
    .catch(() => undefined) as readonly Pick<DiscoveredPageField,
      'targetId' | 'origin' | 'navigationId' | 'semantic' | 'label'>[] | undefined;
  const exact = discovered?.find((target) => target.targetId === claimed.targetId && target.origin === origin
    && target.navigationId === claimed.navigationId && target.semantic === claimed.semantic && target.label === claimed.label);
  if (exact === undefined) return undefined;
  return {
    target: { ...exact, tabId, frameId },
    pageTargets: discovered!
      .filter((target) => target.origin === origin && target.navigationId === claimed.navigationId)
      .map((target) => ({ ...target, tabId, frameId })),
  };
}

interface WorkspacePlan {
  readonly assets: readonly { readonly id: string; readonly code?: string; readonly name: string;
    readonly type?: string | { readonly kind: 'UNKNOWN'; readonly raw: string }; readonly isBinary: boolean;
    readonly fieldNames: readonly string[]; readonly matchOrigins?: readonly string[] }[];
}

async function discoverWorkspacePage(tabId: number, origin: string) {
  const injections = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: discoverPageFields });
  const snapshot = injections[0]?.result;
  if (snapshot === undefined || snapshot.origin !== origin
    || snapshot.fields.some((field) => field.origin !== origin || field.navigationId !== snapshot.navigationId)) return undefined;
  return { discovered: snapshot.fields, navigationId: snapshot.navigationId,
    pageTargets: scopePageFields(snapshot.fields, tabId, 0) };
}

async function loadPageFirstCandidates(tabId: number, origin: string): Promise<SidePanelResponse> {
  pendingContext.clearDraft();
  try {
    const client = await core();
    const [page, plansPage] = await Promise.all([
      discoverWorkspacePage(tabId, origin),
      client.listPlans({ assetType: 'USER-PSWD' }),
    ]);
    if (page === undefined) return { ok: false, error: 'stale-page-context' };
    const plans = await Promise.all(plansPage.items.map(async (summary) => ({
      id: summary.id, name: summary.name, plan: await client.getPlan(summary.id) as unknown as WorkspacePlan,
    })));
    const candidates = pageFirstSuggestions(plans.map(({ id, name, plan }) => ({
      planName: name, protectedFields: protectedFieldsOf(plan, id, origin),
    })), page.pageTargets);
    return { ok: true, pageTargets: page.pageTargets, candidates };
  } catch { return { ok: false, error: 'access-request-failed' }; }
}

async function startPageFirstPicker(tabId: number, origin: string): Promise<SidePanelResponse> {
  pendingContext.clearDraft();
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: pickPageField });
    const field = injection?.result;
    if (field === null) return { ok: false, error: 'picker-canceled' };
    if (field === undefined || field.origin !== origin) return { ok: false, error: 'stale-page-context' };
    const pageTarget = scopePageFields([field], tabId, 0)[0];
    if (pageTarget === undefined) return { ok: false, error: 'stale-page-context' };
    const client = await core();
    const plansPage = await client.listPlans({ assetType: 'USER-PSWD' });
    const plans = await Promise.all(plansPage.items.map(async (summary) => ({
      planName: summary.name,
      protectedFields: protectedFieldsOf(await client.getPlan(summary.id) as unknown as WorkspacePlan, summary.id, origin),
    })));
    return { ok: true, pageTargets: [pageTarget], candidates: pageFirstSuggestions(plans, [pageTarget]) };
  } catch { return { ok: false, error: 'stale-page-context' }; }
}

async function selectPageFirstCandidate(tabId: number, origin: string, mapping: FieldMapping, planName: string): Promise<SidePanelResponse> {
  const loaded = await loadAccessWorkspace(mapping.protectedField.planId, tabId, origin);
  if (!loaded.ok || !('protectedFields' in loaded)) return loaded;
  const selected = setAssetMappings(tabId, { ...mapping, source: 'MANUAL' });
  if (!selected.ok || !('batch' in selected)) return selected;
  return { ...loaded, batch: selected.batch, planName } as SidePanelResponse;
}

async function loadAccessWorkspace(planId: string, tabId: number, origin: string): Promise<SidePanelResponse> {
  const revision = organizationRevision;
  const existing = pendingContext.getDraft(tabId);
  if (existing !== undefined && existing.identity.planId === planId) {
    return {
      ok: true,
      protectedFields: existing.protectedFields,
      pageTargets: existing.pageTargets,
      suggestions: [],
      batch: { identity: existing.identity, mappings: existing.mappings },
    };
  }
  pendingContext.clearDraft();
  try {
    const [plan, page] = await Promise.all([
      (await core()).getPlan(planId) as unknown as Promise<WorkspacePlan>,
      discoverWorkspacePage(tabId, origin),
    ]);
    if (page === undefined) return { ok: false, error: 'stale-page-context' };
    const protectedFields = protectedFieldsOf(plan, planId, origin);
    const pageTargets = page.pageTargets;
    const suggested = suggestFieldMappings({ planId, protectedFields, pageFields: suggestionFields(page.discovered, pageTargets) });
    if (!suggested.accepted) return { ok: false, error: 'access-request-failed' };
    const suggestedIds = suggested.suggestions.map(({ mapping }) => mapping.pageTarget.targetId);
    const orderedTargets = [...pageTargets].sort((left, right) => {
      const leftIndex = suggestedIds.indexOf(left.targetId);
      const rightIndex = suggestedIds.indexOf(right.targetId);
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
    });
    if (revision !== organizationRevision) return { ok: false, error: 'stale-page-context' };
    pendingContext.setDraft({
      identity: { planId, tabId, frameId: 0, origin, navigationId: page.navigationId }, protectedFields, pageTargets: orderedTargets, mappings: [],
    });
    return { ok: true, protectedFields, pageTargets: orderedTargets, suggestions: suggested.suggestions };
  } catch { return { ok: false, error: 'access-request-failed' }; }
}

/** Builds the same worker-owned workspace as the panel, scoped to the content script's exact frame. */
async function loadOverlayWorkspace(
  planId: string,
  pageTargets: readonly import('../shared/access-contract.js').PageFieldTarget[],
): Promise<SidePanelResponse> {
  const target = pageTargets[0];
  if (target === undefined) return { ok: false, error: 'stale-page-context' };
  const { tabId, frameId, origin, navigationId } = target;
  const revision = organizationRevision;
  const existing = pendingContext.getDraft(tabId);
  if (existing !== undefined && existing.identity.planId === planId && existing.identity.origin === origin
    && existing.identity.frameId === frameId) {
    return {
      ok: true,
      protectedFields: existing.protectedFields,
      pageTargets: existing.pageTargets,
      suggestions: [],
      batch: { identity: existing.identity, mappings: existing.mappings },
    };
  }
  pendingContext.clearDraft();
  try {
    const plan = await (await core()).getPlan(planId) as unknown as WorkspacePlan;
    const protectedFields = protectedFieldsOf(plan, planId, origin);
    if (revision !== organizationRevision) return { ok: false, error: 'stale-page-context' };
    pendingContext.setDraft({
      identity: { planId, tabId, frameId, origin, navigationId }, protectedFields, pageTargets, mappings: [],
    });
    return { ok: true, protectedFields, pageTargets, suggestions: [] };
  } catch { return { ok: false, error: 'access-request-failed' }; }
}

function protectedFieldsOf(plan: WorkspacePlan, planId: string, origin: string): readonly ProtectedFieldRef[] {
  const allowed = new Set(['username', 'email', 'password']);
  return plan.assets.flatMap((asset) => asset.isBinary ? [] : asset.fieldNames
    .filter((fieldName): fieldName is ProtectedFieldRef['fieldName'] => allowed.has(fieldName))
    .map((fieldName) => ({ planId, assetId: asset.id, assetCode: asset.code ?? asset.id, assetName: asset.name,
      assetType: typeof asset.type === 'string' ? asset.type : asset.type?.raw ?? '', fieldName,
      selector: `${asset.code ?? asset.id}.${fieldName}`, matchesOrigin: asset.matchOrigins?.includes(origin) ?? false })))
    .sort((left, right) => Number(right.matchesOrigin) - Number(left.matchesOrigin) || left.selector.localeCompare(right.selector));
}

function suggestionFields(discovered: readonly DiscoveredPageField[], targets: ReturnType<typeof scopePageFields>) {
  const targetsById = new Map(targets.map((target) => [target.targetId, target]));
  return discovered.map((field) => ({ target: targetsById.get(field.targetId)!, autocomplete: field.autocomplete,
    inputType: field.inputType, accessibleLabel: field.label, name: field.name, elementId: field.elementId }));
}

function setAccessMapping(tabId: number, mapping: FieldMapping): SidePanelResponse {
  const draft = pendingContext.getDraft(tabId);
  if (draft === undefined) return { ok: false, error: 'stale-page-context' };
  if (!sameProtectedField(draft.protectedFields, mapping.protectedField) || !samePageTarget(draft.pageTargets, mapping.pageTarget)
    || mapping.protectedField.fieldName !== mapping.pageTarget.semantic) return { ok: false, error: 'invalid-access-batch' };
  const mappings = draft.mappings.filter((current) => current.protectedField.selector !== mapping.protectedField.selector
    && current.pageTarget.targetId !== mapping.pageTarget.targetId);
  const batch = { identity: draft.identity, mappings: [...mappings, mapping] } satisfies AccessBatch;
  if (!validateAccessBatch(batch).valid) return { ok: false, error: 'invalid-access-batch' };
  pendingContext.updateMappings(tabId, batch.mappings);
  return { ok: true, batch };
}

function setAssetMappings(tabId: number, selected: FieldMapping): SidePanelResponse {
  const draft = pendingContext.getDraft(tabId);
  if (draft === undefined || !sameProtectedField(draft.protectedFields, selected.protectedField)
    || !samePageTarget(draft.pageTargets, selected.pageTarget)
    || selected.protectedField.fieldName !== selected.pageTarget.semantic) return { ok: false, error: 'invalid-access-batch' };
  const siblings = draft.protectedFields
    .filter((field) => field.assetId === selected.protectedField.assetId && field.selector !== selected.protectedField.selector)
    .flatMap((field): FieldMapping[] => {
      const targets = draft.pageTargets.filter((target) => target.semantic === field.fieldName
        && target.targetId !== selected.pageTarget.targetId);
      return targets.length === 1 ? [{ protectedField: field, pageTarget: targets[0]!, source: 'SUGGESTED' }] : [];
    });
  const batch = { identity: draft.identity, mappings: [selected, ...siblings] } satisfies AccessBatch;
  if (!validateAccessBatch(batch).valid) return { ok: false, error: 'invalid-access-batch' };
  pendingContext.updateMappings(tabId, batch.mappings);
  return { ok: true, batch };
}

async function startPicker(tabId: number, protectedField: ProtectedFieldRef): Promise<SidePanelResponse> {
  const revision = organizationRevision;
  const draft = pendingContext.getDraft(tabId);
  if (draft === undefined || !sameProtectedField(draft.protectedFields, protectedField)) return { ok: false, error: 'invalid-access-batch' };
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [draft.identity.frameId] }, func: pickPageField });
    const field = injection?.result;
    if (field === null) return { ok: false, error: 'picker-canceled' };
    if (field === undefined || field.origin !== draft.identity.origin || field.navigationId !== draft.identity.navigationId) {
      pendingContext.clearDraft();
      return { ok: false, error: 'stale-page-context' };
    }
    if (revision !== organizationRevision) return { ok: false, error: 'stale-page-context' };
    const target = scopePageFields([field], tabId, draft.identity.frameId)[0]!;
    const knownTarget = draft.pageTargets.find((candidate) => candidate.targetId === target.targetId);
    if (knownTarget === undefined) pendingContext.setDraft({ ...draft, pageTargets: [...draft.pageTargets, target] });
    return setAccessMapping(tabId, { protectedField, pageTarget: target, source: 'MANUAL' });
  } catch { return { ok: false, error: 'stale-page-context' }; }
}

async function revealAndAutofill(tabId: number, origin: string, batch: AccessBatch): Promise<SidePanelResponse> {
  const draft = pendingContext.getDraft(tabId);
  if (draft === undefined || origin !== draft.identity.origin || !sameBatch(batch, draft.identity, draft.mappings)
    || !validateAccessBatch(batch).valid || batch.mappings.some((mapping) => mapping.protectedField.planId !== draft.identity.planId)) {
    return { ok: false, error: 'invalid-access-batch' };
  }
  try { return { ok: true, results: await reveal.fillBatch(batch) }; }
  catch (error) { return { ok: false, error: stableAccessError(error) }; }
  finally { pendingContext.clearDraft(); }
}

function batchResponse(tabId: number): SidePanelResponse {
  const draft = pendingContext.getDraft(tabId);
  return draft === undefined ? { ok: false, error: 'stale-page-context' }
    : { ok: true, batch: { identity: draft.identity, mappings: draft.mappings } };
}

function sameProtectedField(fields: readonly ProtectedFieldRef[], field: ProtectedFieldRef): boolean {
  return fields.some((candidate) => JSON.stringify(candidate) === JSON.stringify(field));
}
function samePageTarget(targets: readonly import('../shared/access-contract.js').PageFieldTarget[], target: import('../shared/access-contract.js').PageFieldTarget): boolean {
  return targets.some((candidate) => JSON.stringify(candidate) === JSON.stringify(target));
}
function sameBatch(batch: AccessBatch, identity: AccessBatch['identity'], mappings: readonly FieldMapping[]): boolean {
  return JSON.stringify(batch) === JSON.stringify({ identity, mappings });
}
function stableAccessError(error: unknown): 'invalid-access-batch' | 'access-request-failed' {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'invalid-access-batch'
    ? 'invalid-access-batch' : 'access-request-failed';
}
