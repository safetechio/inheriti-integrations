import type { OperatorSessionStore } from '@safetech/inheriti-elements-core';
import type { BrowserIntegrationCore, BusinessOrganization } from '@safetech/inheriti-elements-core/browser';
import { PendingTabContextStore } from '../pending-tab-context.js';
import { SessionStorageOperatorSessionStore } from '../session-store.js';
import { operatorSessionIdentity, SessionStorageKeyVault } from '../session-key-vault.js';
import { chooseAnotherSafeIdAccount, signIn } from '../auth.js';
import { createCore, loadPlans } from '../plans.js';
import { resolveConfiguration, type ChromeConfiguration } from '../../shared/configuration.js';
import { codeOf, type PanelState } from '../../shared/plan-view.js';
import type { SidePanelResponse } from '../../shared/messages.js';
import { readBusinessOrganization, readStoredConfiguration, writeBusinessOrganization } from '../../shared/stored-configuration.js';
import { OverlayPermissionController } from '../overlay-permissions.js';
import type { ChromeRevealController } from '../reveal.js';

export function createAccountRuntime(deps: {
  sessions: SessionStorageOperatorSessionStore;
  pendingContext: PendingTabContextStore;
  overlayPermissions: OverlayPermissionController;
  pendingSignIns: Set<AbortController>;
  localStorage: chrome.storage.StorageArea;
  getReveal: () => ChromeRevealController;
  setKeyOwner: (owner: 'Application' | 'Organisation') => void;
}) {
  const { sessions, pendingContext, overlayPermissions, pendingSignIns, localStorage, getReveal, setKeyOwner } = deps;
  let heldCore: { readonly key: string; readonly value: BrowserIntegrationCore } | undefined;
  const profileDiscovery = new Map<string, Promise<unknown>>();
  const emptySessions: OperatorSessionStore = {
    load: async () => undefined,
    save: async () => { throw new Error('operator_reauthentication_required'); },
    clear: async () => undefined,
  };

  async function configuredProfiles() {
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    sessions.bind(configuration);
    return (await sessions.profiles()).filter((profile) => profile.issuer === configuration.issuer
      && profile.environment === configuration.environment && profile.authorizedParty === configuration.clientId);
  }

  async function core(organizationId?: string) {
    const stored = await readStoredConfiguration(localStorage, chrome.storage.session);
    const configuration = resolveConfiguration(stored);
    sessions.bind(configuration);
    setKeyOwner(configuration.applicationId === undefined ? 'Organisation' : 'Application');
    const selected = configuration.applicationId === undefined
      ? organizationId ?? await selectedOrganization(configuration)
      : undefined;
    const activeId = (await configuredProfiles()).find((profile) => profile.active)?.id;
    const snapshot = await sessions.snapshot();
    const session = activeId === undefined ? undefined : snapshot.session;
    const principal = session?.principal;
    // The generation fences a cached Core and key vault after every account or organization change.
    const key = JSON.stringify([configuration, selected, principal?.issuer, principal?.environment, principal?.authorizedParty, principal?.subject, principal?.sessionId, snapshot.generation]);
    if (heldCore?.key !== key) {
      const vault = operatorSessionIdentity(session)
        ? new SessionStorageKeyVault(chrome.storage.session, sessions, configuration, snapshot) : undefined;
      const store = activeId === undefined ? emptySessions : await sessions.forProfile(activeId);
      if (heldCore?.key !== key) heldCore = { key, value: createCore(configuration, store, undefined, selected, vault) };
    }
    return heldCore.value;
  }

  async function discoverForProfile<T>(id: string, work: () => Promise<T>): Promise<T> {
    // Each Core owns its refresh flight; serialize clients sharing one rotating profile token.
    const previous = profileDiscovery.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    profileDiscovery.set(id, current);
    try { return await current; }
    finally { if (profileDiscovery.get(id) === current) profileDiscovery.delete(id); }
  }

  function listProfileOrganizations(id: string, configuration: ChromeConfiguration): Promise<BusinessOrganization[]> {
    return discoverForProfile(id, async () => {
      const activeId = (await configuredProfiles()).find((profile) => profile.active)?.id;
      const client = activeId === id ? await core() : createCore(configuration, await sessions.forProfile(id));
      return client.listOrganizations();
    });
  }

  async function organizationPreference(configuration: ChromeConfiguration): Promise<string | undefined> {
    if (configuration.applicationId !== undefined) return undefined;
    const session = (await configuredProfiles()).some((profile) => profile.active) ? await sessions.load() : undefined;
    if (!session?.principal.subject) return undefined;
    return JSON.stringify([configuration.issuer, configuration.environment, session.principal.subject]);
  }

  async function selectedOrganization(configuration: ChromeConfiguration): Promise<string | undefined> {
    const key = await organizationPreference(configuration);
    return key === undefined ? undefined : readBusinessOrganization(localStorage, key);
  }

  async function saveOrganization(configuration: ChromeConfiguration, organizationId?: string): Promise<void> {
    const key = await organizationPreference(configuration);
    if (key !== undefined) await writeBusinessOrganization(localStorage, key, organizationId);
  }

  async function businessSelection(): Promise<{ organizations: BusinessOrganization[]; organizationId: string } | PanelState | undefined> {
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    if (await organizationPreference(configuration) === undefined) return undefined;
    const activeId = (await configuredProfiles()).find((profile) => profile.active)?.id;
    const organizations = activeId === undefined ? await createCore(configuration, emptySessions).listOrganizations()
      : await listProfileOrganizations(activeId, configuration);
    const saved = await selectedOrganization(configuration);
    if (saved && organizations.some(({ id }) => id === saved)) return { organizations, organizationId: saved };
    if (saved) await saveOrganization(configuration);
    if (!saved && organizations.length === 1) {
      await saveOrganization(configuration, organizations[0]!.id);
      return { organizations, organizationId: organizations[0]!.id };
    }
    return { kind: 'SELECT_ORGANIZATION', organizations,
      ...(saved ? { reason: 'The saved organisation is no longer available.' } : {}) };
  }

  async function panelState(action: 'sign-in' | 'sign-out' | 'load-plans' | 'forget-master-key'): Promise<PanelState> {
    try {
      if (action === 'sign-out') {
        try { await (await core()).auth.clear(); }
        catch { /* Local sign-out still completes if revocation is unavailable. */ }
        finally { await sessions.clear(); }
        return { kind: 'SIGNED_OUT' };
      }
      if (action === 'sign-in') return authorizeAccount();
      const client = await core();
      // Remove only the selected key; the operator session and other organizations remain available.
      if (action === 'forget-master-key') {
        await client.forgetMasterKey();
        return await selectedPlans(client);
      }
      return await selectedPlans(client);
    } catch (error) {
      return { kind: 'ERROR', code: codeOf(error) };
    }
  }

  async function authorizeAccount(): Promise<PanelState> {
    // Keep a canceled OAuth window as the sole attempt until it settles. Otherwise an old token
    // exchange could finish after a newer sign-in and overwrite (or clear) the newer session.
    if (pendingSignIns.size > 0) return { kind: 'ERROR', code: 'login_cancelled' };
    const pending = new AbortController();
    pendingSignIns.add(pending);
    try {
      const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
      if (pending.signal.aborted) return { kind: 'SIGNED_OUT' };
      if ((await configuredProfiles()).length > 0) await chooseAnotherSafeIdAccount(configuration.issuer);
      if (pending.signal.aborted) return { kind: 'SIGNED_OUT' };
      const client = createCore(configuration, await sessions.beginEnrollment());
      if (pending.signal.aborted) return { kind: 'SIGNED_OUT' };
      try {
        await signIn(client.auth, pending.signal);
      } catch (error) {
        return { kind: 'ERROR', code: codeOf(error, 'sign_in_failed') };
      }
      if (pending.signal.aborted) return { kind: 'SIGNED_OUT' };
      heldCore = undefined;
      await overlayPermissions.restore();
      return await selectedPlans(await core());
    } finally {
      pendingSignIns.delete(pending);
    }
  }

  async function selectedPlans(client: BrowserIntegrationCore): Promise<PanelState> {
    if (!(await client.getAccessToken())) return { kind: 'SIGNED_OUT' };
    const selection = await businessSelection();
    if (selection && 'kind' in selection) return selection;
    if (selection && 'organizationId' in selection) {
      const selectedCore = await core(selection.organizationId);
      return { ...await loadPlans(selectedCore), ...selection,
        keyInMemory: await selectedCore.hasMasterKey({ system: 'INHERITI_BUSINESS', contextId: selection.organizationId }) };
    }
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    return { ...await loadPlans(client), keyInMemory: configuration.applicationId !== undefined
      && await client.hasMasterKey({ system: 'INHERITI_ELEMENTS', contextId: configuration.applicationId }) };
  }

  async function withAccounts(state: PanelState): Promise<PanelState> {
    const profiles = await configuredProfiles();
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    const organizationsByAccount = new Map<string, readonly { id: string; name: string }[]>();
    const emailByAccount = new Map<string, string>();
    const nameByAccount = new Map<string, string>();
    const roleByAccount = new Map<string, string>();
    const reauthentication = new Set<string>();
    await Promise.all(profiles.map(async (profile) => {
      if (profile.needsSignIn || configuration.applicationId !== undefined) return;
      try {
        const organizations = await listProfileOrganizations(profile.id, configuration);
        organizationsByAccount.set(profile.id, organizations.map(({ id, name }) => ({ id, name })));
      } catch (error) {
        const code = codeOf(error);
        if (code === 'operator_reauthentication_required') reauthentication.add(profile.id);
      }
      if (reauthentication.has(profile.id)) return;
      try {
        await discoverForProfile(profile.id, async () => {
          const session = await (await sessions.forProfile(profile.id)).load();
          if (!session?.accessToken || session.expiresAt <= Date.now()) return;
          const response = await fetch(new URL('v1/importer/profile', configuration.apiUrl), {
            headers: { Authorization: `Bearer ${session.accessToken}`, 'x-elements-environment': configuration.environment },
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) return;
          const details = (await response.json() as { result?: { firstName?: unknown; lastName?: unknown; email?: unknown } }).result;
          const email = details?.email;
          if (typeof email === 'string' && email.trim()) emailByAccount.set(profile.id, email);
          const name = [details?.firstName, details?.lastName]
            .filter((part): part is string => typeof part === 'string' && !!part.trim()).map((part) => part.trim()).join(' ');
          if (name) nameByAccount.set(profile.id, name.slice(0, 80));
        });
      } catch { /* Email is optional; account discovery remains available. */ }
      if (profile.active && state.organizationId) {
        try {
          await discoverForProfile(profile.id, async () => {
            const session = await (await sessions.forProfile(profile.id)).load();
            if (!session?.accessToken || session.expiresAt <= Date.now()) return;
            const response = await fetch(new URL('v1/organizations', configuration.apiUrl), {
              headers: { Authorization: `Bearer ${session.accessToken}`, 'x-elements-environment': configuration.environment },
              signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) return;
            const body = await response.json() as { result?: { items?: { id?: unknown; roleName?: unknown }[] } };
            const role = body.result?.items?.find((item) => item.id === state.organizationId)?.roleName;
            if (typeof role === 'string' && role.trim()) roleByAccount.set(profile.id, role.trim().slice(0, 80));
          });
        } catch { /* Role is optional; account discovery remains available. */ }
      }
    }));
    // Discovery is asynchronous; re-read profiles before returning labels to the panel.
    const current = await configuredProfiles();
    const generation = (await sessions.snapshot()).generation;
    if (current.length === 0) return { ...state, generation };
    const accounts = current.map((profile) => {
      const account = { id: profile.id, label: nameByAccount.get(profile.id) ?? profile.label, issuer: profile.issuer, environment: profile.environment,
        subject: profile.subject, expiresAt: profile.expiresAt, active: profile.active,
        needsSignIn: profile.needsSignIn || reauthentication.has(profile.id) };
      const email = account.needsSignIn ? undefined : emailByAccount.get(profile.id);
      const organizations = organizationsByAccount.get(profile.id);
      const role = roleByAccount.get(profile.id);
      return { ...account, ...(email === undefined ? {} : { email }), ...(role === undefined ? {} : { role }),
        ...(account.needsSignIn || organizations === undefined ? {} : { organizations }) };
    });
    return { ...state, accounts, generation };
  }

  async function closeAccountContext(): Promise<void> {
    // Hide page and key state before any replacement account becomes active.
    for (const pending of pendingSignIns) pending.abort();
    await getReveal().shutdown();
    pendingContext.clear();
    if (heldCore !== undefined) await heldCore.value.forgetMasterKey().catch(() => undefined);
    heldCore = undefined;
    await overlayPermissions.hideAll().catch(() => undefined);
  }

  async function verifiedOrganizations(accountId: string): Promise<BusinessOrganization[] | undefined> {
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    if (configuration.applicationId !== undefined) {
      await discoverForProfile(accountId, async () => createCore(configuration, await sessions.forProfile(accountId))
        .listPlans({ assetType: 'USER-PSWD' }));
      return undefined;
    }
    return listProfileOrganizations(accountId, configuration);
  }

  async function restorePreviousAccount(previous: string | undefined, target: string): Promise<void> {
    if (previous === undefined || previous === target) return;
    try {
      await verifiedOrganizations(previous);
      if (!await sessions.activate(previous)) return;
      heldCore = undefined;
      await overlayPermissions.restore();
    } catch { /* Keep the target sealed if the previous account cannot be verified. */ }
  }

  async function switchAccount(accountId: string, organizationId?: string): Promise<SidePanelResponse> {
    if (!accountId || accountId.length > 512 || (organizationId !== undefined && (!organizationId || organizationId.length > 255))) {
      return { ok: false, error: 'plan-request-failed' };
    }
    const profiles = await configuredProfiles();
    if (!profiles.some((profile) => profile.id === accountId)) return { ok: false, error: 'plan-request-failed' };
    const previous = profiles.find((profile) => profile.active)?.id;
    if (organizationId !== undefined && previous === accountId) return { ok: false, error: 'plan-request-failed' };
    try {
      await closeAccountContext();
      const organizations = await verifiedOrganizations(accountId);
      if (organizationId !== undefined && !organizations?.some(({ id }) => id === organizationId)) {
        return { ok: false, error: 'plan-request-failed' };
      }
      if (!await sessions.activate(accountId)) return { ok: false, error: 'plan-request-failed' };
      if (organizationId !== undefined) {
        const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
        await saveOrganization(configuration, organizationId);
      }
      const state = await selectedPlans(await core());
      if (state.kind !== 'ERROR' && state.kind !== 'SIGNED_OUT') {
        await overlayPermissions.restore();
        return { ok: true, state: await withAccounts(state) };
      }
      await restorePreviousAccount(previous, accountId);
      return { ok: true, state: await withAccounts({ kind: 'ERROR',
        code: state.kind === 'ERROR' ? state.code : 'operator_reauthentication_required' }) };
    } catch (error) {
      await restorePreviousAccount(previous, accountId);
      return { ok: true, state: await withAccounts({ kind: 'ERROR', code: codeOf(error) }) };
    }
  }
  async function removeAccount(accountId: string): Promise<SidePanelResponse> {
    if (!(await configuredProfiles()).some((profile) => profile.id === accountId)) {
      return { ok: false, error: 'plan-request-failed' };
    }
    await closeAccountContext();
    try {
      const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
      await createCore(configuration, await sessions.forProfile(accountId)).auth.clear();
    } catch { /* Removing the local account does not depend on network revocation. */ }
    finally { await sessions.remove(accountId); }
    const state = await panelState('load-plans');
    if (state.kind !== 'ERROR' && state.kind !== 'SIGNED_OUT') await overlayPermissions.restore();
    return { ok: true, state: await withAccounts(state) };
  }

  async function masterKeyStatus(): Promise<SidePanelResponse> {
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    const organizationId = configuration.applicationId === undefined ? await selectedOrganization(configuration) : undefined;
    const contextId = configuration.applicationId ?? organizationId;
    // Status reads must not construct or cache a Core while an account switch is in progress.
    let loaded = false;
    if (contextId !== undefined) {
      const snapshot = await sessions.snapshot();
      if (operatorSessionIdentity(snapshot.session) !== undefined) {
        const key = await new SessionStorageKeyVault(chrome.storage.session, sessions, configuration, snapshot).load({
          system: configuration.applicationId === undefined ? 'INHERITI_BUSINESS' : 'INHERITI_ELEMENTS', contextId,
        });
        loaded = key !== undefined;
        key?.fill(0);
      }
    }
    return { ok: true, keyStatus: { owner: configuration.applicationId === undefined ? 'Organization' : 'Application', loaded } };
  }

  async function selectOrganization(organizationId: string): Promise<SidePanelResponse> {
    if (typeof organizationId !== 'string' || !organizationId || organizationId.length > 255)
      return { ok: false, error: 'plan-request-failed' };
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    if (await organizationPreference(configuration) === undefined) return { ok: false, error: 'plan-request-failed' };
    const activeId = (await configuredProfiles()).find((profile) => profile.active)?.id;
    if (activeId === undefined) return { ok: false, error: 'plan-request-failed' };
    const organizations = await listProfileOrganizations(activeId, configuration);
    if (!organizations.some(({ id }) => id === organizationId)) return { ok: false, error: 'plan-request-failed' };
    await getReveal().shutdown();
    pendingContext.clear();
    heldCore = undefined;
    await sessions.bumpGeneration();
    await saveOrganization(configuration, organizationId);
    return { ok: true, state: await withAccounts(await panelState('load-plans')) };
  }

  async function forgetHeldCore(): Promise<void> {
    if (heldCore !== undefined) await heldCore.value.forgetMasterKey().catch(() => undefined);
    heldCore = undefined;
  }
  async function revokeAllSessions(): Promise<void> {
    const configuration = resolveConfiguration(await readStoredConfiguration(localStorage, chrome.storage.session));
    const profiles = await configuredProfiles();
    await Promise.allSettled(profiles.filter((profile) => !profile.needsSignIn).map(async (profile) => {
      const client = createCore(configuration, await sessions.forProfile(profile.id));
      await client.auth.clear();
    }));
  }
  return { core, selectedOrganization, panelState, withAccounts, closeAccountContext, switchAccount,
    removeAccount, masterKeyStatus, selectOrganization, forgetHeldCore, revokeAllSessions };
}
